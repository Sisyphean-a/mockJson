import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { createProxy } from "./proxy.js";
import { JsonFileRepository } from "./storage.js";
import type { State, PackageConfig, LogicalApi, Scenario } from "./types.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const port = Number(process.env.PORT || 22333),
  host = process.env.HOST || "0.0.0.0";
const repo = new JsonFileRepository(resolve("data/mock-data.json"));
const app = Fastify({ logger: true });
await app.register(cors);
app.addHook("onRequest", async (req) => {
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
if (existsSync(resolve("dist")))
  await app.register(staticPlugin, { root: resolve("dist"), prefix: "/" });
let state = await repo.read();
for (const p of state.packages)
  for (const api of p.apis)
    if (!api.activeScenarioId && api.scenarios.length)
      api.activeScenarioId = api.scenarios[0].id;
if (!state.currentPackageId && state.packages[0])
  state.currentPackageId = state.packages[0].id;
const save = async () => repo.write(state);
function pkg(id: string) {
  return state.packages.find((p) => p.id === id);
}
app.get("/__mock_admin/state", async () => state);
app.get("/__mock_admin/packages", async () => state.packages);
app.post("/__mock_admin/packages", async (req, res) => {
  const b = req.body as Partial<PackageConfig>;
  const p = {
    id: randomUUID(),
    name: b.name || "未命名测试包",
    targetBaseUrl: b.targetBaseUrl || "",
    apis: [],
  };
  state.packages.push(p);
  if (!state.currentPackageId) state.currentPackageId = p.id;
  await save();
  return res.code(201).send(p);
});
app.patch("/__mock_admin/packages/:id", async (req, res) => {
  const p = pkg((req.params as any).id);
  if (!p) return res.code(404).send({ error: "Package not found" });
  if (req.body && typeof (req.body as any).targetBaseUrl === "string") {
    const targetBaseUrl = (req.body as any).targetBaseUrl.trim();
    if (targetBaseUrl) {
      try {
        const parsed = new URL(targetBaseUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        return res
          .code(400)
          .send({ error: "targetBaseUrl 必须是 http:// 或 https:// 地址" });
      }
    }
  }
  Object.assign(p, req.body);
  await save();
  return p;
});
app.delete("/__mock_admin/packages/:id", async (req, res) => {
  state.packages = state.packages.filter(
    (p) => p.id !== (req.params as any).id,
  );
  if (state.currentPackageId === (req.params as any).id)
    state.currentPackageId = state.packages[0]?.id || null;
  await save();
  return { success: true };
});
app.post("/__mock_admin/current-package/:id", async (req, res) => {
  if (!pkg((req.params as any).id))
    return res.code(404).send({ error: "Package not found" });
  state.currentPackageId = (req.params as any).id;
  await save();
  return { success: true, currentPackageId: state.currentPackageId };
});
app.get("/__mock_admin/packages/:id/apis", async (req, res) => {
  const p = pkg((req.params as any).id);
  return p ? p.apis : res.code(404).send({ error: "Package not found" });
});
app.post("/__mock_admin/packages/:packageId/apis", async (req, res) => {
  const p = pkg((req.params as any).packageId);
  if (!p) return res.code(404).send({ error: "Package not found" });
  const b = req.body as Partial<LogicalApi>;
  const api = {
    id: randomUUID(),
    name: b.name || "未命名接口",
    enabled: true,
    priority: Math.max(0, ...p.apis.map((a) => a.priority)) + 10,
    matchMode: "AND" as const,
    matchRules: b.matchRules || [],
    activeScenarioId: null,
    scenarios: [],
  };
  p.apis.push(api);
  await save();
  return res.code(201).send(api);
});
function findApi(id: string) {
  for (const p of state.packages) {
    const a = p.apis.find((x) => x.id === id);
    if (a) return [p, a] as const;
  }
  return null;
}
app.patch("/__mock_admin/apis/:id", async (req, res) => {
  const found = findApi((req.params as any).id);
  if (!found) return res.code(404).send({ error: "API not found" });
  Object.assign(found[1], req.body);
  await save();
  return found[1];
});
app.delete("/__mock_admin/apis/:id", async (req, res) => {
  const found = findApi((req.params as any).id);
  if (!found) return res.code(404).send({ error: "API not found" });
  found[0].apis = found[0].apis.filter((a) => a.id !== found[1].id);
  await save();
  return { success: true };
});
app.post("/__mock_admin/apis/:id/scenarios", async (req, res) => {
  const found = findApi((req.params as any).id);
  if (!found) return res.code(404).send({ error: "API not found" });
  const b = req.body as Partial<Scenario>;
  let body = b.responseBody ?? {};
  if (typeof body === "string")
    try {
      body = JSON.parse(body);
    } catch {
      return res.code(400).send({ error: "responseBody must be valid JSON" });
    }
  const s = {
    id: randomUUID(),
    name: b.name || "新场景",
    status: b.status || 200,
    delayMs: Math.min(30000, Math.max(0, b.delayMs || 0)),
    responseBody: body,
    color: b.color || "blue",
  };
  found[1].scenarios.push(s);
  if ((b as any).activate !== false || !found[1].activeScenarioId)
    found[1].activeScenarioId = s.id;
  await save();
  return res.code(201).send(s);
});
app.patch("/__mock_admin/scenarios/:id", async (req, res) => {
  for (const p of state.packages)
    for (const a of p.apis) {
      const s = a.scenarios.find((x) => x.id === (req.params as any).id);
      if (s) {
        const b = req.body as any;
        if (b.responseBody !== undefined) {
          try {
            s.responseBody =
              typeof b.responseBody === "string"
                ? JSON.parse(b.responseBody)
                : b.responseBody;
          } catch {
            return res
              .code(400)
              .send({ error: "responseBody must be valid JSON" });
          }
        }
        Object.assign(s, b);
        await save();
        return s;
      }
    }
  return res.code(404).send({ error: "Scenario not found" });
});
app.post("/__mock_admin/apis/:apiId/activate/:scenarioId", async (req, res) => {
  const found = findApi((req.params as any).apiId);
  if (
    !found ||
    !found[1].scenarios.some((s) => s.id === (req.params as any).scenarioId)
  )
    return res.code(404).send({ error: "Scenario not found" });
  found[1].activeScenarioId = (req.params as any).scenarioId;
  await save();
  return { success: true, activeScenarioId: found[1].activeScenarioId };
});
app.setNotFoundHandler((req, res) => createProxy(req, res, state));
app
  .listen({ port, host })
  .then(() =>
    console.log(`Mock Console started\nAdmin UI: http://127.0.0.1:${port}`),
  );
