import http from "node:http";
import https from "node:https";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { State } from "./types.js";
import { matchApi } from "./matcher.js";
const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function createProxy(
  req: FastifyRequest,
  res: FastifyReply,
  state: State,
) {
  const p = state.packages.find((x) => x.id === state.currentPackageId);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const api = p?.apis
    .filter((a) => a.enabled !== false)
    .sort((a, b) => b.priority - a.priority)
    .find((a) =>
      matchApi(a, { method: req.method, url, headers: req.headers }),
    );
  const activeSceneId = api?.activeScenarioId || api?.scenarios[0]?.id;
  const scene = api?.scenarios.find((s) => s.id === activeSceneId);
  if (scene) {
    await sleep(scene.delayMs || 0);
    return res
      .code(scene.status)
      .type("application/json; charset=utf-8")
      .send(JSON.stringify(scene.responseBody));
  }
  if (!p?.targetBaseUrl)
    return res
      .code(502)
      .send({ error: "未命中 Mock，且当前 Package 未配置真实服务器" });
  const target = new URL(req.url, p.targetBaseUrl);
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(
      ([k]) => !hop.has(k.toLowerCase()) && k.toLowerCase() !== "host",
    ),
  );
  await new Promise<void>((resolve) => {
    const handleResponse = (r: http.IncomingMessage) => {
      res.raw.statusCode = r.statusCode || 502;
      for (const [k, v] of Object.entries(r.headers))
        if (v !== undefined && !hop.has(k.toLowerCase()))
          res.raw.setHeader(k, v as string | string[]);
      r.pipe(res.raw);
      r.on("end", resolve);
    };
    const options = { method: req.method, headers };
    const upstream =
      target.protocol === "https:"
        ? https.request(target, options, handleResponse)
        : http.request(target, options, handleResponse);
    upstream.on("error", (e) => {
      if (!res.sent)
        res.code(502).send({ error: "Proxy failed", detail: e.message });
      resolve();
    });
    req.raw.pipe(upstream);
  });
}
