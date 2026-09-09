import { randomUUID } from "node:crypto";
import type {
  LogicalApi,
  MatchRule,
  PackageConfig,
  PersistedPackageConfig,
  PersistedState,
  RealService,
  Scenario,
  State,
} from "../../shared/types.js";
import {
  parseJsonBody,
  validTarget,
  validateDelay,
  validateMatchRules,
  validateName,
  validateStatus,
} from "./validation.js";

export interface StateRepository {
  read(): Promise<PersistedState>;
  write(state: State, serializedState?: string): Promise<void>;
}

export class NotFoundError extends Error {}

export class MockConfigService {
  private state: State | null = null;
  private persistedSnapshot: string | null = null;

  constructor(private readonly repository: StateRepository) {}

  async initialize() {
    this.state = normalizeState(await this.repository.read());
    this.persistedSnapshot = JSON.stringify(this.state, null, 2);
  }

  getState(): State {
    if (!this.state) throw new Error("配置服务尚未初始化");
    return this.state;
  }

  getPackages() {
    return this.getState().packages;
  }

  getPackageApis(id: string) {
    return this.requirePackage(id).apis;
  }

  async reorderApis(packageId: string, input: { ids?: unknown }) {
    const packageConfig = this.requirePackage(packageId);
    packageConfig.apis = reorderByIds(packageConfig.apis, input.ids, "接口");
    await this.save();
    return packageConfig.apis;
  }

  async reorderScenarios(apiId: string, input: { ids?: unknown }) {
    const api = this.requireApi(apiId).api;
    api.scenarios = reorderByIds(api.scenarios, input.ids, "场景");
    await this.save();
    return api.scenarios;
  }

  async switchPackage(id: string) {
    const state = this.getState();
    this.requirePackage(id);
    state.currentPackageId = id;
    await this.save();
    return { success: true, currentPackageId: id };
  }

  async createPackage(input: { name?: unknown; targetBaseUrl?: unknown }) {
    const state = this.getState();
    const targetBaseUrl = validTarget(input.targetBaseUrl);
    const realServices = targetBaseUrl ? [newRealService("默认服务", targetBaseUrl)] : [];
    const created: PackageConfig = {
      id: randomUUID(),
      name: validateName(input.name, "Package"),
      realServices,
      activeRealServiceId: realServices[0]?.id || null,
      apis: [],
    };
    state.packages.push(created);
    if (!state.currentPackageId) state.currentPackageId = created.id;
    await this.save();
    return created;
  }

  async updatePackage(id: string, input: { name?: unknown; targetBaseUrl?: unknown }) {
    const packageConfig = this.requirePackage(id);
    if (input.name !== undefined) packageConfig.name = validateName(input.name, "Package");
    if (input.targetBaseUrl !== undefined) {
      const targetBaseUrl = validTarget(input.targetBaseUrl);
      const active = findActiveRealService(packageConfig);
      if (active) active.baseUrl = targetBaseUrl;
      else if (targetBaseUrl) {
        const service = newRealService("默认服务", targetBaseUrl);
        packageConfig.realServices = [...packageConfig.realServices, service];
        packageConfig.activeRealServiceId = service.id;
      }
    }
    await this.save();
    return packageConfig;
  }

  async createRealService(packageId: string, input: { name?: unknown; baseUrl?: unknown }) {
    const packageConfig = this.requirePackage(packageId);
    const service = newRealService(validateName(input.name, "真实服务"), validTarget(input.baseUrl));
    packageConfig.realServices = [...packageConfig.realServices, service];
    if (!packageConfig.activeRealServiceId) packageConfig.activeRealServiceId = service.id;
    await this.save();
    return service;
  }

  async updateRealService(id: string, input: { name?: unknown; baseUrl?: unknown }) {
    const found = this.requireRealService(id);
    if (input.name !== undefined) found.service.name = validateName(input.name, "真实服务");
    if (input.baseUrl !== undefined) found.service.baseUrl = validTarget(input.baseUrl);
    await this.save();
    return found.service;
  }

  async deleteRealService(id: string) {
    const found = this.requireRealService(id);
    const wasActive = found.packageConfig.activeRealServiceId === found.service.id;
    found.packageConfig.realServices = found.packageConfig.realServices.filter((item) => item.id !== found.service.id);
    if (wasActive) found.packageConfig.activeRealServiceId = found.packageConfig.realServices[0]?.id || null;
    await this.save();
    return { success: true, activeRealServiceId: found.packageConfig.activeRealServiceId };
  }

  async activateRealService(packageId: string, serviceId: string) {
    const packageConfig = this.requirePackage(packageId);
    if (!packageConfig.realServices.some((item) => item.id === serviceId)) throw new NotFoundError("Real service not found");
    packageConfig.activeRealServiceId = serviceId;
    await this.save();
    return { success: true, activeRealServiceId: serviceId };
  }

  async deletePackage(id: string) {
    const state = this.getState();
    this.requirePackage(id);
    state.packages = state.packages.filter((item) => item.id !== id);
    if (state.currentPackageId === id) state.currentPackageId = state.packages[0]?.id || null;
    await this.save();
    return { success: true, currentPackageId: state.currentPackageId };
  }

  async createApi(packageId: string, input: { name?: unknown }) {
    const packageConfig = this.requirePackage(packageId);
    const api: LogicalApi = {
      id: randomUUID(),
      name: validateName(input.name, "接口"),
      enabled: true,
      priority: Math.max(0, ...packageConfig.apis.map((item) => item.priority)) + 10,
      matchMode: "OR",
      matchRules: [],
      activeScenarioId: null,
      scenarios: [],
    };
    packageConfig.apis = [...packageConfig.apis, api];
    await this.save();
    return api;
  }

  async updateApi(id: string, input: {
    name?: unknown;
    enabled?: unknown;
    priority?: unknown;
    matchMode?: unknown;
    matchRules?: unknown;
  }) {
    const found = this.requireApi(id);
    // Rule: 先换代 API 数组，即使后续校验失败也不会复用旧的排序缓存。
    found.packageConfig.apis = [...found.packageConfig.apis];
    const api = found.api;
    if (input.name !== undefined) api.name = validateName(input.name, "接口");
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
      api.enabled = input.enabled;
    }
    if (input.priority !== undefined) {
      if (!Number.isInteger(input.priority) || Number(input.priority) < 0)
        throw new Error("优先级必须是非负整数");
      api.priority = Number(input.priority);
    }
    if (input.matchMode !== undefined) {
      if (input.matchMode !== "AND" && input.matchMode !== "OR") throw new Error("规则关系必须是 AND 或 OR");
      api.matchMode = input.matchMode;
    }
    if (input.matchRules !== undefined) api.matchRules = validateMatchRules(input.matchRules) as MatchRule[];
    await this.save();
    return api;
  }

  async deleteApi(id: string) {
    const found = this.requireApi(id);
    found.packageConfig.apis = found.packageConfig.apis.filter((item) => item.id !== found.api.id);
    await this.save();
    return { success: true };
  }

  async createScenario(apiId: string, input: {
    name?: unknown;
    status?: unknown;
    delayMs?: unknown;
    responseBody?: unknown;
    color?: unknown;
    activate?: unknown;
  }) {
    const api = this.requireApi(apiId).api;
    const shouldActivate = input.activate === true || (input.activate === undefined && api.scenarios.length === 0);
    const scenario: Scenario = {
      id: randomUUID(),
      name: validateName(input.name, "场景"),
      status: validateStatus(input.status),
      delayMs: validateDelay(input.delayMs),
      responseBody: parseJsonBody(input.responseBody === undefined ? {} : input.responseBody),
      color: typeof input.color === "string" ? input.color : "blue",
    };
    api.scenarios.push(scenario);
    if (shouldActivate) api.activeScenarioId = scenario.id;
    await this.save();
    return scenario;
  }

  async updateScenario(id: string, input: {
    name?: unknown;
    status?: unknown;
    delayMs?: unknown;
    responseBody?: unknown;
    color?: unknown;
  }) {
    const scenario = this.requireScenario(id).scenario;
    if (input.name !== undefined) scenario.name = validateName(input.name, "场景");
    if (input.status !== undefined) scenario.status = validateStatus(input.status);
    if (input.delayMs !== undefined) scenario.delayMs = validateDelay(input.delayMs);
    if (input.color !== undefined) {
      if (typeof input.color !== "string") throw new Error("场景颜色格式不正确");
      scenario.color = input.color;
    }
    if (input.responseBody !== undefined) scenario.responseBody = parseJsonBody(input.responseBody);
    await this.save();
    return scenario;
  }

  async deleteScenario(id: string) {
    const found = this.requireScenario(id);
    found.api.scenarios = found.api.scenarios.filter((item) => item.id !== found.scenario.id);
    if (found.api.activeScenarioId === found.scenario.id) found.api.activeScenarioId = null;
    await this.save();
    return { success: true, activeScenarioId: found.api.activeScenarioId };
  }

  async activateScenario(apiId: string, scenarioId: string) {
    const api = this.requireApi(apiId).api;
    if (!api.scenarios.some((item) => item.id === scenarioId)) throw new NotFoundError("Scenario not found");
    api.activeScenarioId = scenarioId;
    await this.save();
    return { success: true, activeScenarioId: scenarioId };
  }

  async deactivateScenario(apiId: string) {
    const api = this.requireApi(apiId).api;
    api.activeScenarioId = null;
    await this.save();
    return { success: true, activeScenarioId: null };
  }

  private requirePackage(id: string) {
    const packageConfig = this.getState().packages.find((item) => item.id === id);
    if (!packageConfig) throw new NotFoundError("Package not found");
    return packageConfig;
  }

  private requireApi(id: string) {
    for (const packageConfig of this.getState().packages) {
      const api = packageConfig.apis.find((item) => item.id === id);
      if (api) return { packageConfig, api };
    }
    throw new NotFoundError("API not found");
  }

  private requireRealService(id: string) {
    for (const packageConfig of this.getState().packages) {
      const service = packageConfig.realServices.find((item) => item.id === id);
      if (service) return { packageConfig, service };
    }
    throw new NotFoundError("Real service not found");
  }

  private requireScenario(id: string) {
    for (const packageConfig of this.getState().packages) {
      for (const api of packageConfig.apis) {
        const scenario = api.scenarios.find((item) => item.id === id);
        if (scenario) return { packageConfig, api, scenario };
      }
    }
    throw new NotFoundError("Scenario not found");
  }

  private async save() {
    const state = this.getState();
    try {
      const serializedState = JSON.stringify(state, null, 2);
      await this.repository.write(state, serializedState);
      // Rule: 常驻序列化快照，只有写入失败时才解析回滚，避免长期保留整份对象副本。
      this.persistedSnapshot = serializedState;
    } catch (error) {
      const persisted = this.persistedSnapshot === null
        ? { currentPackageId: null, packages: [] }
        : JSON.parse(this.persistedSnapshot) as State;
      state.packages = persisted.packages;
      state.currentPackageId = persisted.currentPackageId;
      throw error;
    }
  }
}

function reorderByIds<T extends { id: string }>(items: T[], value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== items.length || value.some((id) => typeof id !== "string"))
    throw new Error(`${label}排序 ID 无效`);

  const ids = value as string[];
  const knownIds = new Set(items.map((item) => item.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => !knownIds.has(id)))
    throw new Error(`${label}排序必须包含全部且唯一的 ID`);

  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)!);
}

function newRealService(name: string, baseUrl: string): RealService {
  return { id: randomUUID(), name, baseUrl };
}

function findActiveRealService(packageConfig: PackageConfig) {
  return packageConfig.realServices.find((item) => item.id === packageConfig.activeRealServiceId);
}

function normalizePackage(packageConfig: PersistedPackageConfig): PackageConfig {
  if ("realServices" in packageConfig) {
    const active = packageConfig.realServices.find((item) => item.id === packageConfig.activeRealServiceId);
    return {
      ...packageConfig,
      realServices: [...packageConfig.realServices],
      activeRealServiceId: active?.id || packageConfig.realServices[0]?.id || null,
    };
  }

  // Rule: 旧版单地址配置只在读取时转换，首次保存其他改动时才落成新结构。
  const targetBaseUrl = validTarget(packageConfig.targetBaseUrl);
  const realServices = targetBaseUrl ? [newRealService("默认服务", targetBaseUrl)] : [];
  return {
    id: packageConfig.id,
    name: packageConfig.name,
    realServices,
    activeRealServiceId: realServices[0]?.id || null,
    apis: packageConfig.apis,
  };
}

function normalizeState(state: PersistedState): State {
  const normalized: State = {
    currentPackageId: state.currentPackageId,
    packages: state.packages.map(normalizePackage),
  };
  for (const packageConfig of normalized.packages) {
    for (const api of packageConfig.apis) {
      if (api.activeScenarioId && !api.scenarios.some((scenario) => scenario.id === api.activeScenarioId))
        api.activeScenarioId = null;
    }
  }
  if (normalized.currentPackageId && !normalized.packages.some((item) => item.id === normalized.currentPackageId))
    normalized.currentPackageId = normalized.packages[0]?.id || null;
  if (!normalized.currentPackageId && normalized.packages[0]) normalized.currentPackageId = normalized.packages[0].id;
  return normalized;
}
