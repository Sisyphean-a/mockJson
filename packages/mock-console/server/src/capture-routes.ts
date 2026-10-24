import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ExtensionCaptureInput } from "@mock-json/extension-contract";
import type { CaptureDraft, CaptureSaveResult, SaveCaptureInput } from "../../shared/types.js";
import { InvalidCaptureError, MockConfigService, NotFoundError } from "./config-service.js";

const lifetimeMs = 15 * 60_000;
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function registerCaptureRoutes(app: FastifyInstance, service: MockConfigService, now = Date.now) {
  const drafts = new Map<string, CaptureDraft>();
  const pending = new Map<string, Promise<CaptureSaveResult>>();
  function expire() {
    for (const [id, draft] of drafts) if (draft.expiresAt <= now()) drafts.delete(id);
  }
  // Effect: 草稿只驻留内存，定时清除响应原文；不写配置或请求日志。
  const timer = setInterval(expire, 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); drafts.clear(); });

  function get(id: string) {
    expire();
    const draft = drafts.get(id);
    if (!draft) throw Object.assign(new Error("响应草稿已过期或服务已重启，请从扩展重新发送"), { statusCode: 410 });
    return draft;
  }

  const options = {
    onRequest: async (req: FastifyRequest) => {
      const origin = req.headers.origin;
      if (!loopback.has(req.ip) || (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
          !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)))
        throw Object.assign(new Error("响应交接只允许本机控制台或浏览器扩展访问"), { statusCode: 403 });
      if (req.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""))
        throw Object.assign(new Error("响应交接必须使用 application/json"), { statusCode: 415 });
    },
  };

  app.post("/__mock_extension/captures", options, async (req, reply) => {
    try {
      const input = parseCapture(req.body);
      expire();
      const id = randomUUID();
      const draft: CaptureDraft = { ...input, id, expiresAt: now() + lifetimeMs };
      drafts.set(id, draft);
      return reply.code(201).header("cache-control", "no-store").send({ id, expiresAt: draft.expiresAt });
    } catch (error) { return invalid(reply, error); }
  });

  app.get<{ Params: { id: string } }>("/__mock_admin/captures/:id", options, async (req, reply) => {
    return reply.header("cache-control", "no-store").send(get(req.params.id));
  });

  app.post<{ Params: { id: string } }>("/__mock_admin/captures/:id/save", options, async (req, reply) => {
    const draft = get(req.params.id);
    reply.header("cache-control", "no-store");
    if (draft.saved) return draft.saved;
    // Guarantee: 同一草稿的并发提交和网络重试只创建一次，写盘失败仍可重试。
    let operation = pending.get(draft.id);
    if (!operation) {
      operation = (async () => {
        if (!isRecord(req.body)) throw new InvalidCaptureError("保存参数必须是对象");
        const result = await service.saveCapturedScenario(draft, req.body as SaveCaptureInput);
        draft.saved = result;
        return result;
      })();
      pending.set(draft.id, operation);
    }
    try { return await operation; }
    catch (error) {
      if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
      if (error instanceof InvalidCaptureError)
        return invalid(reply, error);
      throw error;
    } finally { pending.delete(draft.id); }
  });
}

function parseCapture(value: unknown): ExtensionCaptureInput {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.response)) throw new Error("响应快照格式无效");
  const { url, method } = value.request;
  const { status, body } = value.response;
  if (typeof url !== "string" || url.length > 8192 || !["http:", "https:"].includes(new URL(url).protocol))
    throw new Error("请求 URL 无效");
  if (typeof method !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Z-]{1,32}$/.test(method)) throw new Error("请求 Method 无效");
  if (!Number.isInteger(status) || Number(status) < 200 || Number(status) > 599) throw new Error("浏览器 Mock 仅支持 200–599 状态码");
  if (typeof body !== "string" || body.length > 64 * 1024) throw new Error("仅支持现有预览范围内的完整 JSON 响应");
  JSON.parse(body);
  return { request: { url, method }, response: { status: Number(status), body } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(reply: import("fastify").FastifyReply, error: unknown) {
  return reply.code(400).send({ error: error instanceof Error ? error.message : "响应草稿无效" });
}
