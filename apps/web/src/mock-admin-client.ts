import type { LogicalApi, MatchRule, PackageConfig, Scenario, State } from "../../shared/types";
import { createRuntimeEndpoints, type RuntimeEndpoints } from "./runtime-endpoints";

export type { LogicalApi, MatchRule, PackageConfig, Scenario, State };
export type Api = LogicalApi;
export type Pkg = PackageConfig;
export type Scene = Scenario;

export interface AdminTransport {
  // Failure: 连接层失败抛出 AdminTransportError；实现错误原样暴露。
  send(input: string, init: RequestInit): Promise<Response>;
}

export class AdminTransportError extends Error {
  constructor(readonly url: string, cause: unknown) {
    const detail = cause instanceof Error && cause.message ? `：${cause.message}` : "";
    super(`无法连接 Mock 服务（${url}）${detail}，请检查服务是否运行后重试`, { cause });
    this.name = "AdminTransportError";
  }
}

export function createBrowserTransport(browser: Pick<typeof globalThis, "fetch"> = globalThis): AdminTransport {
  return {
    async send(input, init) {
      try {
        return await browser.fetch(input, init);
      } catch (cause) {
        throw new AdminTransportError(input, cause);
      }
    },
  };
}

const browserTransport = createBrowserTransport();

export class MockAdminClient {
  constructor(
    private readonly endpoints: RuntimeEndpoints = createRuntimeEndpoints(),
    private readonly transport: AdminTransport = browserTransport,
  ) {}

  async getState() {
    return this.request<State>("/__mock_admin/state");
  }

  async switchPackage(id: string) {
    return this.request<{ success: true; currentPackageId: string }>(`/__mock_admin/current-package/${id}`, { method: "POST" });
  }

  async createPackage(input: { name: string; targetBaseUrl?: string }) {
    return this.request<PackageConfig>("/__mock_admin/packages", json("POST", input));
  }

  async updatePackage(id: string, input: { name?: string; targetBaseUrl?: string }) {
    return this.request<PackageConfig>(`/__mock_admin/packages/${id}`, json("PATCH", input));
  }

  async deletePackage(id: string) {
    return this.request<{ success: true; currentPackageId: string | null }>(`/__mock_admin/packages/${id}`, { method: "DELETE" });
  }

  async createApi(packageId: string, name: string) {
    return this.request<LogicalApi>(`/__mock_admin/packages/${packageId}/apis`, json("POST", { name }));
  }

  async updateApi(id: string, input: Partial<Pick<LogicalApi, "name" | "enabled" | "priority" | "matchMode" | "matchRules">>) {
    return this.request<LogicalApi>(`/__mock_admin/apis/${id}`, json("PATCH", input));
  }

  async deleteApi(id: string) {
    return this.request<{ success: true }>(`/__mock_admin/apis/${id}`, { method: "DELETE" });
  }

  async createScenario(apiId: string, input: {
    name: string;
    status?: number;
    delayMs?: number;
    responseBody?: unknown;
    color?: string;
    activate?: boolean;
  }) {
    return this.request<Scenario>(`/__mock_admin/apis/${apiId}/scenarios`, json("POST", input));
  }

  async updateScenario(id: string, input: Partial<Pick<Scenario, "name" | "status" | "delayMs" | "responseBody" | "color">>) {
    return this.request<Scenario>(`/__mock_admin/scenarios/${id}`, json("PATCH", input));
  }

  async deleteScenario(id: string) {
    return this.request<{ success: true; activeScenarioId: string | null }>(`/__mock_admin/scenarios/${id}`, { method: "DELETE" });
  }

  async activateScenario(apiId: string, scenarioId: string) {
    return this.request<{ success: true; activeScenarioId: string }>(`/__mock_admin/apis/${apiId}/activate/${scenarioId}`, { method: "POST" });
  }

  async deactivateScenario(apiId: string) {
    return this.request<{ success: true; activeScenarioId: null }>(`/__mock_admin/apis/${apiId}/active-scenario`, { method: "DELETE" });
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.transport.send(this.endpoints.adminUrl(path), { ...options, headers });
    if (!response.ok) {
      let message = `管理服务返回 ${response.status}`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return (response.status === 204 ? null : await response.json()) as T;
  }
}

function json(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
