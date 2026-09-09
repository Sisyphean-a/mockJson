import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ExtensionRuntimeRequest } from "@mock-json/extension-contract";
import type { RequestLogOutcome } from "../../shared/types.js";
import { MockConfigService } from "./config-service.js";
import { emptyLogResponse, RequestLogStore, textLogResponse } from "./request-logs.js";
import { resolveExtension, type ExtensionResolution } from "./runtime-resolver.js";

const MAX_URL_LENGTH = 8 * 1024;
const MAX_METHOD_LENGTH = 32;
const MAX_HEADER_NAME_LENGTH = 256;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;
const MAX_HEADERS = 128;

export function registerExtensionRoutes(app: FastifyInstance, service: MockConfigService, logs?: RequestLogStore) {
  app.get("/__mock_extension/status", async () => ({
    online: true,
    hasPackage: service.getState().currentPackageId !== null,
  }));

  app.post("/__mock_extension/resolve", async (req, reply) => {
    const startedAt = Date.now();
    try {
      const request = parseRequest(req);
      const resolution = resolveExtension(service.getState(), request);
      recordExtensionDecision(logs, request, resolution, startedAt);
      return resolution.response;
    } catch (error) {
      return sendInvalidRequest(reply, error);
    }
  });
}

function recordExtensionDecision(
  logs: RequestLogStore | undefined,
  request: ExtensionRuntimeRequest,
  resolution: ExtensionResolution,
  startedAt: number,
) {
  if (!logs) return;
  const response = resolution.response;
  const outcome: RequestLogOutcome = response.action === "mock"
    ? "mocked"
    : response.reason === "unmatched"
      ? "unmatched"
      : response.reason === "invalid-request"
        ? "error"
        : "passed";
  const responseBody = response.action === "mock"
    ? textLogResponse(response.headers["content-type"] || null, response.body)
    : emptyLogResponse(null);

  logs.record({
    source: "extension",
    timestamp: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAt),
    packageId: resolution.packageConfig?.id || null,
    packageName: resolution.packageConfig?.name || null,
    method: request.method,
    host: new URL(request.url).host,
    url: request.url,
    outcome,
    ...(response.action === "pass" && response.reason ? { passReason: response.reason } : {}),
    apiId: resolution.api?.id || null,
    apiName: resolution.api?.name || null,
    scenarioId: resolution.scenario?.id || null,
    scenarioName: resolution.scenario?.name || null,
    status: response.action === "mock" ? response.status : 0,
    response: responseBody,
  });
}

function parseRequest(req: FastifyRequest): ExtensionRuntimeRequest {
  const value = parseBody(req.body);
  if (!isRecord(value)) throw new Error("请求描述必须是对象");

  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url || url.length > MAX_URL_LENGTH) throw new Error("请求 URL 无效");
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error("请求 URL 协议不受支持");

  const method = typeof value.method === "string" ? value.method.trim().toUpperCase() : "";
  if (!method || method.length > MAX_METHOD_LENGTH) throw new Error("请求 Method 无效");

  if (!isRecord(value.headers)) throw new Error("请求 Headers 无效");
  const headers: Record<string, string> = {};
  const entries = Object.entries(value.headers);
  if (entries.length > MAX_HEADERS) throw new Error("请求 Headers 数量过多");
  let headerBytes = 0;
  for (const [name, headerValue] of entries) {
    if (!name || name.length > MAX_HEADER_NAME_LENGTH || typeof headerValue !== "string" || headerValue.length > MAX_HEADER_VALUE_LENGTH)
      throw new Error("请求 Headers 无效");
    headerBytes += Buffer.byteLength(name) + Buffer.byteLength(headerValue);
    if (headerBytes > 64 * 1024) throw new Error("请求 Headers 总长度过大");
    headers[name] = headerValue;
  }

  return { url, method, headers };
}

function parseBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8"));
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendInvalidRequest(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "请求描述无效";
  return reply.code(400).send({ error: message });
}
