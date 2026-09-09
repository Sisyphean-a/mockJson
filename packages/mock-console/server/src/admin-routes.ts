import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MockConfigService, NotFoundError } from "./config-service.js";
import { RequestLogStore } from "./request-logs.js";

type Body = Record<string, unknown>;

export function registerAdminRoutes(
  app: FastifyInstance,
  service: MockConfigService,
  logs: RequestLogStore,
) {
  app.get("/__mock_admin/state", async () => service.getState());
  app.get("/__mock_admin/logs", async (req, reply) => {
    const etag = logs.etag();
    reply.header("etag", etag).header("cache-control", "no-cache");
    if (matchesEtag(req.headers["if-none-match"], etag)) return reply.code(304).send();
    const since = querySince(req);
    return since ? logs.listSince(since) : { logs: logs.list() };
  });
  app.delete("/__mock_admin/logs", async () => {
    logs.clear();
    return { success: true };
  });
  app.get("/__mock_admin/packages", async () => service.getPackages());

  app.post("/__mock_admin/packages", async (req, reply) => {
    try {
      const packageConfig = await service.createPackage(body(req));
      return reply.code(201).send(packageConfig);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/__mock_admin/packages/:id", async (req, reply) => {
    try {
      return await service.updatePackage(routeId(req, "id"), body(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/__mock_admin/packages/:id", async (req, reply) => {
    try {
      return await service.deletePackage(routeId(req, "id"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/__mock_admin/current-package/:id", async (req, reply) => {
    try {
      return await service.switchPackage(routeId(req, "id"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/__mock_admin/packages/:id/apis", async (req, reply) => {
    try {
      return service.getPackageApis(routeId(req, "id"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/__mock_admin/packages/:packageId/apis", async (req, reply) => {
    try {
      const api = await service.createApi(routeId(req, "packageId"), body(req));
      return reply.code(201).send(api);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/__mock_admin/packages/:packageId/apis/order", async (req, reply) => {
    try {
      return await service.reorderApis(routeId(req, "packageId"), body(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/__mock_admin/apis/:id", async (req, reply) => {
    try {
      return await service.updateApi(routeId(req, "id"), body(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/__mock_admin/apis/:id", async (req, reply) => {
    try {
      return await service.deleteApi(routeId(req, "id"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/__mock_admin/apis/:id/scenarios", async (req, reply) => {
    try {
      const scenario = await service.createScenario(routeId(req, "id"), body(req));
      return reply.code(201).send(scenario);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/__mock_admin/apis/:id/scenarios/order", async (req, reply) => {
    try {
      return await service.reorderScenarios(routeId(req, "id"), body(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.patch("/__mock_admin/scenarios/:id", async (req, reply) => {
    try {
      return await service.updateScenario(routeId(req, "id"), body(req));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/__mock_admin/scenarios/:id", async (req, reply) => {
    try {
      return await service.deleteScenario(routeId(req, "id"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/__mock_admin/apis/:apiId/activate/:scenarioId", async (req, reply) => {
    try {
      return await service.activateScenario(routeId(req, "apiId"), routeId(req, "scenarioId"));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete("/__mock_admin/apis/:apiId/active-scenario", async (req, reply) => {
    try {
      return await service.deactivateScenario(routeId(req, "apiId"));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function body(req: FastifyRequest): Body {
  return (req.body || {}) as Body;
}

function routeId(req: FastifyRequest, key: string) {
  return (req.params as Record<string, string>)[key];
}

function querySince(req: FastifyRequest) {
  if (!req.query || typeof req.query !== "object" || Array.isArray(req.query)) return undefined;
  const since = (req.query as Record<string, unknown>).since;
  return typeof since === "string" && since ? since : undefined;
}

function sendError(reply: FastifyReply, error: unknown) {
  const status = error instanceof NotFoundError ? 404 : 400;
  return reply.code(status).send({ error: error instanceof Error ? error.message : "请求参数不正确" });
}

function matchesEtag(value: string | string[] | undefined, etag: string) {
  if (!value) return false;
  const header = Array.isArray(value) ? value.join(",") : value;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}
