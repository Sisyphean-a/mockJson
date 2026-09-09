import {
  MAX_REQUEST_LOGS,
  type LogicalApi,
  type MatchRule,
  type PackageConfig,
  type RealService,
  type RequestLog,
  type RequestLogsDeltaResponse,
  type RequestLogsResponse,
  type Scenario,
  type State,
} from "../../shared/types";
import { createRuntimeEndpoints, type RuntimeEndpoints } from "./runtime-endpoints";

export type { LogicalApi, MatchRule, PackageConfig, RealService, RequestLog, RequestLogsDeltaResponse, RequestLogsResponse, Scenario, State };
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
  private logsCache: RequestLogsResponse = { logs: [] };
  private logsEtag: string | undefined;

  constructor(
    private readonly endpoints: RuntimeEndpoints = createRuntimeEndpoints(),
    private readonly transport: AdminTransport = browserTransport,
  ) {}

  async getState() {
    return this.request<State>("/__mock_admin/state");
  }

  async getLogs() {
    const cached = Boolean(this.logsEtag);
    const path = cached
      ? `/__mock_admin/logs?since=${encodeURIComponent(this.logsEtag!)}`
      : "/__mock_admin/logs";
    const options: RequestInit = this.logsEtag ? { headers: { "if-none-match": this.logsEtag } } : {};
    const response = await this.send(path, options);
    if (response.status === 304) return this.logsCache;

    const result = await this.readResponse<RequestLogsResponse | RequestLogsDeltaResponse>(response);
    if (!cached || !("reset" in result) || result.reset) {
      this.logsCache = { logs: result.logs };
    } else {
      this.logsCache = {
        logs: [...result.logs, ...this.logsCache.logs].slice(0, MAX_REQUEST_LOGS),
      };
    }
    this.logsEtag = response.headers.get("etag") || undefined;
    return this.logsCache;
  }

  async clearLogs() {
    const result = await this.request<{ success: true }>("/__mock_admin/logs", { method: "DELETE" });
    this.logsCache = { logs: [] };
    this.logsEtag = undefined;
    return result;
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

  async createRealService(packageId: string, input: { name: string; baseUrl?: string }) {
    return this.request<RealService>(`/__mock_admin/packages/${packageId}/real-services`, json("POST", input));
  }

  async updateRealService(id: string, input: Partial<Pick<RealService, "name" | "baseUrl">>) {
    return this.request<RealService>(`/__mock_admin/real-services/${id}`, json("PATCH", input));
  }

  async deleteRealService(id: string) {
    return this.request<{ success: true; activeRealServiceId: string | null }>(`/__mock_admin/real-services/${id}`, { method: "DELETE" });
  }

  async activateRealService(packageId: string, serviceId: string) {
    return this.request<{ success: true; activeRealServiceId: string }>(`/__mock_admin/packages/${packageId}/active-real-service/${serviceId}`, { method: "POST" });
  }

  async deletePackage(id: string) {
    return this.request<{ success: true; currentPackageId: string | null }>(`/__mock_admin/packages/${id}`, { method: "DELETE" });
  }

  async createApi(packageId: string, name: string) {
    return this.request<LogicalApi>(`/__mock_admin/packages/${packageId}/apis`, json("POST", { name }));
  }

  async reorderApis(packageId: string, ids: string[]) {
    return this.request<LogicalApi[]>(`/__mock_admin/packages/${packageId}/apis/order`, json("PUT", { ids }));
  }

  async updateApi(id: string, input: Partial<Pick<LogicalApi, "name" | "enabled" | "priority" | "matchMode" | "matchRules">>) {
    return this.request<LogicalApi>(`/__mock_admin/apis/${id}`, json("PATCH", input));
  }

  async deleteApi(id: string) {
    return this.request<{ success: true }>(`/__mock_admin/apis/${id}`, { method: "DELETE" });
  }

  async reorderScenarios(apiId: string, ids: string[]) {
    return this.request<Scenario[]>(`/__mock_admin/apis/${apiId}/scenarios/order`, json("PUT", { ids }));
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

  private async send(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    return this.transport.send(this.endpoints.adminUrl(path), { ...options, headers });
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    return this.readResponse<T>(await this.send(path, options));
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let message = `管理服务返回 ${response.status}`;
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return (response.status === 204 ? null : await response.json()) as T;
  }
}

function json(method: "POST" | "PATCH" | "PUT", body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}
