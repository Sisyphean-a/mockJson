import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MockConfigService, NotFoundError } from "./config-service.js";

type Body = Record<string, unknown>;

export function registerAdminRoutes(app: FastifyInstance, service: MockConfigService) {
  app.get("/__mock_admin/state", async () => service.getState());
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

function sendError(reply: FastifyReply, error: unknown) {
  const status = error instanceof NotFoundError ? 404 : 400;
  return reply.code(status).send({ error: error instanceof Error ? error.message : "请求参数不正确" });
}
