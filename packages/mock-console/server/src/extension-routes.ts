import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ExtensionRuntimeRequest } from "../../shared/types.js";
import { MockConfigService } from "./config-service.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";

const MAX_URL_LENGTH = 8 * 1024;
const MAX_METHOD_LENGTH = 32;
const MAX_HEADER_NAME_LENGTH = 256;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;
const MAX_HEADERS = 128;

export function registerExtensionRoutes(app: FastifyInstance, service: MockConfigService) {
  app.post("/__mock_extension/resolve", async (req, reply) => {
    try {
      const request = parseRequest(req);
      return resolveExtensionRequest(service.getState(), request);
    } catch (error) {
      return sendInvalidRequest(reply, error);
    }
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
