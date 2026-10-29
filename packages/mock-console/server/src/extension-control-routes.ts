import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ExtensionControlCommand } from "@mock-json/extension-contract";
import { InvalidControlError, MockConfigService } from "./config-service.js";
import { parseRuntimeRequest } from "./extension-routes.js";

const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function registerExtensionControlRoutes(app: FastifyInstance, service: MockConfigService) {
  const options = {
    onRequest: async (req: FastifyRequest) => {
      const origin = req.headers.origin;
      if (!loopback.has(req.ip) || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
          !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)))
        throw Object.assign(new Error("接口操作只允许本机控制台或浏览器扩展访问"), { statusCode: 403 });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
        throw Object.assign(new Error("接口操作必须使用 application/json"), { statusCode: 415 });
    },
  };
  app.post("/__mock_extension/controls/inspect", options, async (req, reply) => {
    reply.header("cache-control", "no-store");
    try {
      const request = parseRuntimeRequest(req.body);
      return service.inspectRequestControls({ url: request.url, method: request.method, headers: request.headers });
    } catch (error) { return reply.code(400).send({ error: message(error) }); }
  });
  app.post("/__mock_extension/controls/apply", options, async (req, reply) => {
    reply.header("cache-control", "no-store");
    let input: ExtensionControlCommand;
    try { input = parseCommand(req.body); }
    catch (error) { return reply.code(400).send({ error: message(error) }); }
    try { return await service.applyRequestControl(input); }
    catch (error) {
      if (error instanceof Error && "statusCode" in error && error.statusCode === 409)
        return reply.code(409).send({ error: error.message });
      if (error instanceof InvalidControlError)
        return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
}

function parseCommand(value: unknown): ExtensionControlCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("接口操作参数无效");
  const v = value as Record<string, unknown>;
  if (typeof v.packageId !== "string" || !v.packageId || typeof v.apiId !== "string" || !v.apiId ||
      typeof v.revision !== "string" || !/^[a-f0-9]{64}$/.test(v.revision)) throw new Error("接口操作目标无效，请重新读取配置");
  if (v.action !== "mock" && v.action !== "pass" && v.action !== "scenario") throw new Error("未知的接口操作");
  if (v.action === "scenario" && (typeof v.scenarioId !== "string" || !v.scenarioId)) throw new Error("请选择响应场景");
  return { packageId: v.packageId, apiId: v.apiId, revision: v.revision,
    ...(v.action === "scenario" ? { action: "scenario", scenarioId: v.scenarioId as string } : { action: v.action }) };
}
function message(error: unknown) { return error instanceof Error ? error.message : "接口操作参数无效"; }
