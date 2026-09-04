import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createProxy } from "./proxy.js";
import { JsonFileRepository } from "./storage.js";
import { resolveStateFile } from "./state-path.js";
import { MockConfigService } from "./config-service.js";
import { registerAdminRoutes } from "./admin-routes.js";

const port = Number(process.env.PORT || 22333);
const host = process.env.HOST || "0.0.0.0";
const projectRoot = resolve(import.meta.dirname, "../../..");
const distRoot = resolve(projectRoot, "dist");
const repository = new JsonFileRepository(resolveStateFile());
const config = new MockConfigService(repository);
const app = Fastify({ logger: true });
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function requestChannel(req: FastifyRequest) {
  if (req.url.startsWith("/__mock_admin/")) return "admin";
  if (req.url.startsWith("/__mock_ui/") || (req.url === "/" && String(req.headers.accept || "").includes("text/html")))
    return "ui";
  return "proxy";
}

await config.initialize();
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

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
      channel: requestChannel(req),
      method: req.method,
      url: req.url,
      host: req.headers.host,
      apiName: req.headers.apiname,
    },
    "request received",
  );
});

const hasDist = existsSync(distRoot);
if (hasDist)
  await app.register(staticPlugin, { root: distRoot, prefix: "/__mock_ui/", index: false });

registerAdminRoutes(app, config);

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/__mock_admin/")) return reply.code(404).send({ error: "管理接口不存在" });
  return createProxy(req, reply, config.getState());
});

if (hasDist) {
  app.get("/", async (req, reply) => {
    if (String(req.headers.accept || "").includes("text/html"))
      return reply.header("cache-control", "no-store").sendFile("index.html");
    return createProxy(req, reply, config.getState());
  });
}

await app.listen({ port, host });
console.log(`Mock Console started\nAdmin UI: http://127.0.0.1:${port}`);
