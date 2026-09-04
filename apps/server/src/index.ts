import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { createProxy } from "./proxy.js";
import { JsonFileRepository } from "./storage.js";
import { resolveStateFile } from "./state-path.js";
import type { State, PackageConfig, LogicalApi, Scenario, MatchRule } from "./types.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  parseJsonBody,
  validateDelay,
  validateMatchRules,
  validateName,
  validateStatus,
} from "./validation.js";

const port = Number(process.env.PORT || 22333);
const host = process.env.HOST || "0.0.0.0";
const repo = new JsonFileRepository(resolveStateFile());
const app = Fastify({ logger: true });
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      return cb(null, true);
    cb(null, false);
  },
});
app.addHook("onRequest", async (req, reply) => {
  if (req.url.startsWith("/__mock_admin/") && !loopback.has(req.ip))
    return reply.code(403).send({ error: "管理接口只允许本机访问" });
  app.log.info(
    {
      method: req.method,
      url: req.url,
      host: req.headers.host,
      apiName: req.headers.apiname,
    },
    "mock request received",
  );
});
const hasDist = existsSync(resolve("dist"));
if (hasDist)
  await app.register(staticPlugin, { root: resolve("dist"), prefix: "/__mock_ui/", index: false });

let state: State = await repo.read();
if (hasDist)
  app.get("/", async (req, reply) => {
    if (String(req.headers.accept || "").includes("text/html")) return reply.sendFile("index.html");
    return createProxy(req, reply, state);
  });
for (const p of state.packages)
  for (const api of p.apis) {
    if (!api.activeScenarioId || !api.scenarios.some((s) => s.id === api.activeScenarioId))
      api.activeScenarioId = api.scenarios[0]?.id || null;
  }
if (state.currentPackageId && !state.packages.some((p) => p.id === state.currentPackageId))
  state.currentPackageId = state.packages[0]?.id || null;
if (!state.currentPackageId && state.packages[0]) state.currentPackageId = state.packages[0].id;
let persistedState = structuredClone(state);
const save = async () => {
  try {
    await repo.write(state);
    persistedState = structuredClone(state);
  } catch (error) {
    state = structuredClone(persistedState);
    throw error;
  }
};
function pkg(id: string) { return state.packages.find((p) => p.id === id); }
function body(req: FastifyRequest) { return (req.body || {}) as Record<string, unknown>; }
function routeId(req: FastifyRequest, key: string) { return (req.params as Record<string, string>)[key]; }
function findApi(id: string) {
  for (const p of state.packages) {
    const a = p.apis.find((x) => x.id === id);
    if (a) return [p, a] as const;
  }
  return null;
}
function findScenario(id: string) {
  for (const p of state.packages)
    for (const a of p.apis) {
      const s = a.scenarios.find((x) => x.id === id);
      if (s) return [p, a, s] as const;
    }
  return null;
}
function validTarget(value: unknown) {
  const target = typeof value === "string" ? value.trim() : "";
  if (!target) return "";
  const parsed = new URL(target);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("targetBaseUrl 必须是 http:// 或 https:// 地址");
  return target;
}
function sendBadRequest(reply: any, error: unknown) {
  return reply.code(400).send({ error: error instanceof Error ? error.message : "请求参数不正确" });
}

app.get("/__mock_admin/state", async () => state);
app.get("/__mock_admin/packages", async () => state.packages);
app.post("/__mock_admin/packages", async (req, reply) => {
  try {
    const b = body(req);
    const p: PackageConfig = {
      id: randomUUID(),
      name: validateName(b.name, "Package"),
      targetBaseUrl: validTarget(b.targetBaseUrl),
      apis: [],
    };
    state.packages.push(p);
    if (!state.currentPackageId) state.currentPackageId = p.id;
    await save();
    return reply.code(201).send(p);
  } catch (error) { return sendBadRequest(reply, error); }
});
app.patch("/__mock_admin/packages/:id", async (req, reply) => {
  const p = pkg(routeId(req, "id"));
  if (!p) return reply.code(404).send({ error: "Package not found" });
  try {
    const b = body(req);
    if (b.name !== undefined) p.name = validateName(b.name, "Package");
    if (b.targetBaseUrl !== undefined) p.targetBaseUrl = validTarget(b.targetBaseUrl);
    await save();
    return p;
  } catch (error) { return sendBadRequest(reply, error); }
});
app.delete("/__mock_admin/packages/:id", async (req, reply) => {
  const id = routeId(req, "id");
  if (!pkg(id)) return reply.code(404).send({ error: "Package not found" });
  state.packages = state.packages.filter((p) => p.id !== id);
  if (state.currentPackageId === id) state.currentPackageId = state.packages[0]?.id || null;
  await save();
  return { success: true, currentPackageId: state.currentPackageId };
});
app.post("/__mock_admin/current-package/:id", async (req, reply) => {
  const id = routeId(req, "id");
  if (!pkg(id)) return reply.code(404).send({ error: "Package not found" });
  state.currentPackageId = id;
  await save();
  return { success: true, currentPackageId: id };
});
app.get("/__mock_admin/packages/:id/apis", async (req, reply) => {
  const p = pkg(routeId(req, "id"));
  return p ? p.apis : reply.code(404).send({ error: "Package not found" });
});
app.post("/__mock_admin/packages/:packageId/apis", async (req, reply) => {
  const p = pkg(routeId(req, "packageId"));
  if (!p) return reply.code(404).send({ error: "Package not found" });
  try {
    const b = body(req);
    const api: LogicalApi = {
      id: randomUUID(),
      name: validateName(b.name, "接口"),
      enabled: false,
      priority: Math.max(0, ...p.apis.map((a) => a.priority)) + 10,
      matchMode: "AND",
      matchRules: [],
      activeScenarioId: null,
      scenarios: [],
    };
    p.apis.push(api);
    await save();
    return reply.code(201).send(api);
  } catch (error) { return sendBadRequest(reply, error); }
});
app.patch("/__mock_admin/apis/:id", async (req, reply) => {
  const found = findApi(routeId(req, "id"));
  if (!found) return reply.code(404).send({ error: "API not found" });
  try {
    const b = body(req);
    if (b.name !== undefined) found[1].name = validateName(b.name, "接口");
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
      found[1].enabled = b.enabled;
    }
    if (b.priority !== undefined) {
      if (!Number.isInteger(b.priority) || Number(b.priority) < 0) throw new Error("优先级必须是非负整数");
      found[1].priority = Number(b.priority);
    }
    if (b.matchMode !== undefined) {
      if (b.matchMode !== "AND" && b.matchMode !== "OR") throw new Error("规则关系必须是 AND 或 OR");
      found[1].matchMode = b.matchMode;
    }
    if (b.matchRules !== undefined) found[1].matchRules = validateMatchRules(b.matchRules) as MatchRule[];
    await save();
    return found[1];
  } catch (error) { return sendBadRequest(reply, error); }
});
app.delete("/__mock_admin/apis/:id", async (req, reply) => {
  const found = findApi(routeId(req, "id"));
  if (!found) return reply.code(404).send({ error: "API not found" });
  found[0].apis = found[0].apis.filter((a) => a.id !== found[1].id);
  await save();
  return { success: true };
});
app.post("/__mock_admin/apis/:id/scenarios", async (req, reply) => {
  const found = findApi(routeId(req, "id"));
  if (!found) return reply.code(404).send({ error: "API not found" });
  try {
    const b = body(req);
    const s: Scenario = {
      id: randomUUID(),
      name: validateName(b.name, "场景"),
      status: validateStatus(b.status),
      delayMs: validateDelay(b.delayMs),
      responseBody: parseJsonBody(b.responseBody === undefined ? {} : b.responseBody),
      color: typeof b.color === "string" ? b.color : "blue",
    };
    found[1].scenarios.push(s);
    if (b.activate !== false || !found[1].activeScenarioId) found[1].activeScenarioId = s.id;
    await save();
    return reply.code(201).send(s);
  } catch (error) { return sendBadRequest(reply, error); }
});
app.patch("/__mock_admin/scenarios/:id", async (req, reply) => {
  const found = findScenario(routeId(req, "id"));
  if (!found) return reply.code(404).send({ error: "Scenario not found" });
  try {
    const b = body(req);
    if (b.name !== undefined) found[2].name = validateName(b.name, "场景");
    if (b.status !== undefined) found[2].status = validateStatus(b.status);
    if (b.delayMs !== undefined) found[2].delayMs = validateDelay(b.delayMs);
    if (b.color !== undefined) {
      if (typeof b.color !== "string") throw new Error("场景颜色格式不正确");
      found[2].color = b.color;
    }
    if (b.responseBody !== undefined) found[2].responseBody = parseJsonBody(b.responseBody);
    await save();
    return found[2];
  } catch (error) { return sendBadRequest(reply, error); }
});
app.delete("/__mock_admin/scenarios/:id", async (req, reply) => {
  const found = findScenario(routeId(req, "id"));
  if (!found) return reply.code(404).send({ error: "Scenario not found" });
  found[1].scenarios = found[1].scenarios.filter((s) => s.id !== found[2].id);
  if (found[1].activeScenarioId === found[2].id) found[1].activeScenarioId = found[1].scenarios[0]?.id || null;
  await save();
  return { success: true, activeScenarioId: found[1].activeScenarioId };
});
app.post("/__mock_admin/apis/:apiId/activate/:scenarioId", async (req, reply) => {
  const found = findApi(routeId(req, "apiId"));
  if (!found || !found[1].scenarios.some((s) => s.id === routeId(req, "scenarioId")))
    return reply.code(404).send({ error: "Scenario not found" });
  found[1].activeScenarioId = routeId(req, "scenarioId");
  await save();
  return { success: true, activeScenarioId: found[1].activeScenarioId };
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/__mock_admin/")) return reply.code(404).send({ error: "管理接口不存在" });
  return createProxy(req, reply, state);
});
await app.listen({ port, host });
console.log(`Mock Console started\nAdmin UI: http://127.0.0.1:${port}`);
