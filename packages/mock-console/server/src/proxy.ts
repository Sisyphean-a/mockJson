import http from "node:http";
import https from "node:https";
import { Transform } from "node:stream";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RequestLogOutcome, RequestLogResponse, State } from "../../shared/types.js";
import { selectMatchingApi } from "./runtime-resolver.js";
import { RequestLogStore } from "./request-logs.js";

const hop = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ProxyOptions = { streamRequestBody?: boolean };

export function hasRequestBody(req: Pick<FastifyRequest, "headers">) {
  if (req.headers["transfer-encoding"] !== undefined) return true;
  const contentLength = req.headers["content-length"];
  const value = Array.isArray(contentLength) ? contentLength[0] : contentLength;
  const length = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(length) && length > 0;
}

function consumeRequestBody(req: FastifyRequest) {
  if (req.raw.readableEnded) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      req.raw.removeListener("end", finish);
      req.raw.removeListener("aborted", finish);
      req.raw.removeListener("error", finish);
      resolve();
    };
    req.raw.once("end", finish);
    req.raw.once("aborted", finish);
    req.raw.once("error", finish);
    req.raw.resume();
  });
}

function targetUrl(requestUrl: string, baseUrl: string) {
  const request = new URL(requestUrl, "http://mock.local");
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  const requestPath = request.pathname.replace(/^\//, "");
  base.pathname = `${basePath}/${requestPath}`.replace(/\/+/g, "/");
  base.search = request.search;
  return base;
}

const MAX_LOG_BODY_BYTES = 32 * 1024;

function headerText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.join(", ");
  return value || null;
}

function isTextualContentType(contentType: string | null) {
  return !contentType || contentType.startsWith("text/") || /json|xml|javascript|graphql|x-www-form-urlencoded/i.test(contentType);
}

function utf8Preview(body: string, maxBytes: number, byteLength: number) {
  if (byteLength <= maxBytes) return body;

  // Rule: 只按需编码预览前缀，避免为整份大响应额外分配 UTF-8 Buffer。
  let low = 0;
  let high = Math.min(body.length, maxBytes) + 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (Buffer.byteLength(body.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle;
  }
  if (
    low < body.length &&
    low > 0 &&
    body.charCodeAt(low - 1) >= 0xd800 &&
    body.charCodeAt(low - 1) <= 0xdbff &&
    body.charCodeAt(low) >= 0xdc00 &&
    body.charCodeAt(low) <= 0xdfff
  ) low -= 1;
  return Buffer.from(body.slice(0, low)).toString("utf8");
}

function textResponse(contentType: string | null, body: string): RequestLogResponse {
  const byteLength = Buffer.byteLength(body);
  return {
    contentType,
    body: utf8Preview(body, MAX_LOG_BODY_BYTES, byteLength),
    byteLength,
    truncated: byteLength > MAX_LOG_BODY_BYTES,
  };
}

function emptyResponse(contentType: string | null): RequestLogResponse {
  return { contentType, body: "", byteLength: 0, truncated: false };
}

function copyReplyHeaders(res: FastifyReply) {
  for (const [key, value] of Object.entries(res.getHeaders()))
    if (value !== undefined) res.raw.setHeader(key, value);
}

function sendRaw(res: FastifyReply, status: number, contentType: string, body: string) {
  copyReplyHeaders(res);
  res.hijack();
  res.raw.statusCode = status;
  res.raw.setHeader("content-type", contentType);
  res.raw.end(body);
  return res;
}

function createResponseCollector(captureBody: boolean) {
  let byteLength = 0;
  let capturedBytes = 0;
  let truncated = false;
  const chunks: Buffer[] | undefined = captureBody ? [] : undefined;

  return {
    collect(chunk: Buffer | string) {
      const chunkLength = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      byteLength += chunkLength;
      if (chunks && capturedBytes < MAX_LOG_BODY_BYTES) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const captured = bytes.subarray(0, MAX_LOG_BODY_BYTES - capturedBytes);
        // Rule: 只保留预览字节，避免小切片继续持有巨大的上游 Buffer。
        chunks.push(Buffer.from(captured));
        capturedBytes += captured.length;
      }
      if (byteLength > MAX_LOG_BODY_BYTES) truncated = true;
    },
    preview(contentType: string | null, contentEncoding: string | null): RequestLogResponse {
      if (!chunks || (contentEncoding && contentEncoding.toLowerCase() !== "identity") || !isTextualContentType(contentType))
        return { contentType, body: null, byteLength, truncated };
      return {
        contentType,
        body: Buffer.concat(chunks).toString("utf8"),
        byteLength,
        truncated,
      };
    },
  };
}

export async function createProxy(
  req: FastifyRequest,
  res: FastifyReply,
  state: State,
  logs?: RequestLogStore,
  options: ProxyOptions = {},
) {
  const startedAt = Date.now();
  const streamRequestBody = options.streamRequestBody === true;
  const p = state.packages.find((x) => x.id === state.currentPackageId);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const selected = selectMatchingApi(p?.apis, { method: req.method, url, headers: req.headers });
  const api = selected?.api;
  const scene = selected?.scenario;
  const record = (
    outcome: RequestLogOutcome,
    status: number,
    response: RequestLogResponse,
    error?: string,
  ) => {
    logs?.record({
      timestamp: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      packageId: p?.id || null,
      packageName: p?.name || null,
      method: req.method,
      host: headerText(req.headers.host),
      url: req.url,
      outcome,
      apiId: api?.id || null,
      apiName: api?.name || null,
      scenarioId: scene?.id || null,
      scenarioName: scene?.name || null,
      status,
      response,
      ...(error ? { error } : {}),
    });
  };

  if (scene) {
    if (streamRequestBody) await consumeRequestBody(req);
    await sleep(scene.delayMs);
    const body = JSON.stringify(scene.responseBody);
    record("mocked", scene.status, textResponse("application/json; charset=utf-8", body || ""));
    return streamRequestBody
      ? sendRaw(res, scene.status, "application/json; charset=utf-8", body)
      : res.code(scene.status).type("application/json; charset=utf-8").send(body);
  }
  if (!p?.targetBaseUrl) {
    if (streamRequestBody) await consumeRequestBody(req);
    const body = { error: "未命中 Mock，且当前 Package 未配置真实服务器" };
    const serialized = JSON.stringify(body);
    record("unmatched", 502, textResponse("application/json; charset=utf-8", serialized));
    return streamRequestBody
      ? sendRaw(res, 502, "application/json; charset=utf-8", serialized)
      : res.code(502).send(body);
  }

  const target = targetUrl(req.url, p.targetBaseUrl);
  const headers: Record<string, string | string[] | undefined> = Object.fromEntries(
    Object.entries(req.headers).filter(
      ([key]) => !hop.has(key.toLowerCase()) && key.toLowerCase() !== "host",
    ),
  );
  let payload: string | Buffer | undefined;
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) payload = req.body;
    else if (typeof req.body === "string") payload = req.body;
    else payload = JSON.stringify(req.body);
    if (payload !== undefined) headers["content-length"] = String(Buffer.byteLength(payload));
  }

  if (streamRequestBody) {
    res.hijack();
    copyReplyHeaders(res);
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    let recorded = false;
    let responseStatus = 502;
    let responseContentType: string | null = null;
    let responseContentEncoding: string | null = null;
    let responseCollector: ReturnType<typeof createResponseCollector> | undefined;
    let cleanupClientDisconnect = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanupClientDisconnect();
      resolve();
    };
    const recordOnce = (
      outcome: RequestLogOutcome,
      status: number,
      response: RequestLogResponse,
      error?: string,
    ) => {
      if (recorded) return;
      recorded = true;
      record(outcome, status, response, error);
    };
    const handleResponse = (upstreamResponse: http.IncomingMessage) => {
      responseStatus = upstreamResponse.statusCode || 502;
      responseContentType = headerText(upstreamResponse.headers["content-type"]);
      responseContentEncoding = headerText(upstreamResponse.headers["content-encoding"]);
      const captureBody = (!responseContentEncoding || responseContentEncoding.toLowerCase() === "identity") && isTextualContentType(responseContentType);
      responseCollector = createResponseCollector(captureBody);
      const tee = captureBody
        ? new Transform({
            transform(chunk, _encoding, callback) {
              responseCollector?.collect(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              callback(null, chunk);
            },
          })
        : undefined;
      tee?.on("error", (error) => {
        recordOnce("error", responseStatus, responseCollector?.preview(responseContentType, responseContentEncoding) || emptyResponse(responseContentType), error.message);
        finish();
      });
      upstreamResponse.on("end", () => {
        recordOnce("forwarded", responseStatus, responseCollector?.preview(responseContentType, responseContentEncoding) || emptyResponse(responseContentType));
        finish();
      });
      upstreamResponse.on("error", (error) => {
        recordOnce("error", responseStatus, responseCollector?.preview(responseContentType, responseContentEncoding) || emptyResponse(responseContentType), error.message);
        finish();
      });
      res.raw.statusCode = responseStatus;
      for (const [key, value] of Object.entries(upstreamResponse.headers))
        if (value !== undefined && !hop.has(key.toLowerCase())) res.raw.setHeader(key, value);
      if (tee) {
        upstreamResponse.pipe(tee).pipe(res.raw);
      } else {
        upstreamResponse.on("data", (chunk) => responseCollector?.collect(chunk));
        upstreamResponse.pipe(res.raw);
      }
    };
    const options = { method: req.method, headers, timeout: 30000 };
    const upstream = target.protocol === "https:"
      ? https.request(target, options, handleResponse)
      : http.request(target, options, handleResponse);
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    const abortClientRequest = () => upstream.destroy(new Error("client aborted"));
    const onClientDisconnect = () => {
      if (!res.raw.writableEnded) abortClientRequest();
    };
    const clientSocket = req.raw.socket;
    req.raw.on("aborted", abortClientRequest);
    clientSocket?.once("close", onClientDisconnect);
    res.raw.once("close", onClientDisconnect);
    cleanupClientDisconnect = () => {
      req.raw.removeListener("aborted", abortClientRequest);
      clientSocket?.removeListener("close", onClientDisconnect);
      res.raw.removeListener("close", onClientDisconnect);
    };
    upstream.on("error", (error) => {
      const body = { error: "Proxy failed", detail: error.message };
      const serialized = JSON.stringify(body);
      if (streamRequestBody && !res.raw.headersSent && !res.raw.writableEnded && !res.raw.destroyed) {
        res.raw.statusCode = 502;
        res.raw.setHeader("content-type", "application/json; charset=utf-8");
        res.raw.end(serialized);
        recordOnce("error", 502, textResponse("application/json; charset=utf-8", serialized), error.message);
      } else if (!streamRequestBody && !res.sent && !res.raw.headersSent) {
        res.code(502).send(body);
        recordOnce("error", 502, textResponse("application/json; charset=utf-8", serialized), error.message);
      } else {
        recordOnce("error", responseStatus, responseCollector?.preview(responseContentType, responseContentEncoding) || emptyResponse(responseContentType), error.message);
      }
      finish();
    });
    if (payload !== undefined) upstream.end(payload);
    else req.raw.pipe(upstream);
  });
}
