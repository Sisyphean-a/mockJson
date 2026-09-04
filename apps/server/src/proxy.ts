import http from "node:http";
import https from "node:https";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { State } from "./types.js";
import { matchApi } from "./matcher.js";

const hop = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function activeScenario(api: State["packages"][number]["apis"][number]) {
  return api.scenarios.find((s) => s.id === api.activeScenarioId) || api.scenarios[0];
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

export async function createProxy(req: FastifyRequest, res: FastifyReply, state: State) {
  const p = state.packages.find((x) => x.id === state.currentPackageId);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const api = p?.apis
    .filter((a) => a.enabled !== false && a.scenarios.length > 0)
    .slice()
    .sort((a, b) => b.priority - a.priority)
    .find((a) => matchApi(a, { method: req.method, url, headers: req.headers }));
  const scene = api && activeScenario(api);
  if (scene) {
    await sleep(scene.delayMs);
    return res
      .code(scene.status)
      .type("application/json; charset=utf-8")
      .send(JSON.stringify(scene.responseBody));
  }
  if (!p?.targetBaseUrl)
    return res.code(502).send({ error: "未命中 Mock，且当前 Package 未配置真实服务器" });

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

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const handleResponse = (upstreamResponse: http.IncomingMessage) => {
      res.raw.statusCode = upstreamResponse.statusCode || 502;
      for (const [key, value] of Object.entries(upstreamResponse.headers))
        if (value !== undefined && !hop.has(key.toLowerCase())) res.raw.setHeader(key, value);
      upstreamResponse.pipe(res.raw);
      upstreamResponse.on("end", finish);
      upstreamResponse.on("error", finish);
    };
    const options = { method: req.method, headers, timeout: 30000 };
    const upstream = target.protocol === "https:"
      ? https.request(target, options, handleResponse)
      : http.request(target, options, handleResponse);
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", (error) => {
      if (!res.sent && !res.raw.headersSent) res.code(502).send({ error: "Proxy failed", detail: error.message });
      finish();
    });
    req.raw.on("aborted", () => upstream.destroy(new Error("client aborted")));
    if (payload !== undefined) upstream.end(payload);
    else req.raw.pipe(upstream);
  });
}
