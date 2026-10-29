import { randomUUID } from "node:crypto";
import { apiControlRevision, controlledApi, inspectApiControls } from "./api-control.js";
import type { ExtensionControlCommand, ExtensionControlRequest, ExtensionCaptureInput } from "@mock-json/extension-contract";
import { scenarioReferences, selectionFor, validateSelection } from "../../shared/response-selection.js";
import type {
  LogicalApi,
  CaptureSaveResult,
  SaveCaptureInput,
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
  validateScenarioResponse,
} from "./validation.js";

export interface StateRepository {
  read(): Promise<PersistedState>;
  write(state: State, serializedState?: string): Promise<void>;
}

export class NotFoundError extends Error {}
export class InvalidCaptureError extends Error {}
export class InvalidControlError extends Error {}

export class MockConfigService {
  private state: State | null = null;
  private persistedSnapshot: string | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.then(async () => {
      try {
        return await operation();
      } catch (error) {
        // Guarantee: 校验和写入失败都恢复已提交配置，不能把半份变更留给后续请求。
        if (this.state && this.persistedSnapshot !== null) {
          const persisted = JSON.parse(this.persistedSnapshot) as State;
          this.state.packages = persisted.packages;
          this.state.currentPackageId = persisted.currentPackageId;
        }
        throw error;
      }
    });
    // Failure: 调用方仍收到 pending 的失败；队列仅解除拒绝状态，让后续修改可以重试。
    this.mutationQueue = pending.catch(() => {});
    return pending;
  }

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
    return this.enqueue(async () => {
      const packageConfig = this.requirePackage(packageId);
      packageConfig.apis = reorderByIds(packageConfig.apis, input.ids, "接口");
      await this.save();
      return packageConfig.apis;
    });
  }

  async reorderScenarios(apiId: string, input: { ids?: unknown }) {
    return this.enqueue(async () => {
      const api = this.requireApi(apiId).api;
      api.scenarios = reorderByIds(api.scenarios, input.ids, "场景");
      await this.save();
      return api.scenarios;
    });
  }

  async switchPackage(id: string) {
    return this.enqueue(async () => {
      const state = this.getState();
      this.requirePackage(id);
      state.currentPackageId = id;
      await this.save();
      return { success: true, currentPackageId: id };
    });
  }

  async createPackage(input: { name?: unknown; targetBaseUrl?: unknown }) {
    return this.enqueue(async () => {
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
    });
  }

  async updatePackage(id: string, input: { name?: unknown; targetBaseUrl?: unknown }) {
    return this.enqueue(async () => {
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
    });
  }

  async createRealService(packageId: string, input: { name?: unknown; baseUrl?: unknown }) {
    return this.enqueue(async () => {
      const packageConfig = this.requirePackage(packageId);
      const service = newRealService(validateName(input.name, "真实服务"), validTarget(input.baseUrl));
      packageConfig.realServices = [...packageConfig.realServices, service];
      if (!packageConfig.activeRealServiceId) packageConfig.activeRealServiceId = service.id;
      await this.save();
      return service;
    });
  }

  async updateRealService(id: string, input: { name?: unknown; baseUrl?: unknown }) {
    return this.enqueue(async () => {
      const found = this.requireRealService(id);
      if (input.name !== undefined) found.service.name = validateName(input.name, "真实服务");
      if (input.baseUrl !== undefined) found.service.baseUrl = validTarget(input.baseUrl);
      await this.save();
      return found.service;
    });
  }

  async deleteRealService(id: string) {
    return this.enqueue(async () => {
      const found = this.requireRealService(id);
      const wasActive = found.packageConfig.activeRealServiceId === found.service.id;
      found.packageConfig.realServices = found.packageConfig.realServices.filter((item) => item.id !== found.service.id);
      if (wasActive) found.packageConfig.activeRealServiceId = found.packageConfig.realServices[0]?.id || null;
      await this.save();
      return { success: true, activeRealServiceId: found.packageConfig.activeRealServiceId };
    });
  }

  async activateRealService(packageId: string, serviceId: string) {
    return this.enqueue(async () => {
      const packageConfig = this.requirePackage(packageId);
      if (!packageConfig.realServices.some((item) => item.id === serviceId)) throw new NotFoundError("Real service not found");
      packageConfig.activeRealServiceId = serviceId;
      await this.save();
      return { success: true, activeRealServiceId: serviceId };
    });
  }

  async deletePackage(id: string) {
    return this.enqueue(async () => {
      const state = this.getState();
      this.requirePackage(id);
      state.packages = state.packages.filter((item) => item.id !== id);
      if (state.currentPackageId === id) state.currentPackageId = state.packages[0]?.id || null;
      await this.save();
      return { success: true, currentPackageId: state.currentPackageId };
    });
  }

  async createApi(packageId: string, input: { name?: unknown }) {
    return this.enqueue(async () => {
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
    });
  }

  inspectRequestControls(request: ExtensionControlRequest) {
    return inspectApiControls(this.getState(), request);
  }

  async applyRequestControl(input: ExtensionControlCommand) {
    return this.enqueue(async () => {
      const state = this.getState();
      if (input.packageId !== state.currentPackageId)
        throw Object.assign(new Error("当前测试包已切换，请重新读取配置"), { statusCode: 409 });
      const pkg = state.packages.find((p) => p.id === input.packageId);
      const api = pkg?.apis.find((a) => a.id === input.apiId);
      if (!api || apiControlRevision(api) !== input.revision)
        throw Object.assign(new Error("接口配置已变化，请重新读取后操作"), { statusCode: 409 });
      const candidate = structuredClone(state);
      const target = candidate.packages.find((p) => p.id === input.packageId)!.apis.find((a) => a.id === input.apiId)!;
      if (input.action === "pass") target.passthrough = true;
      else if (input.action === "mock") {
        const reason = controlledApi(api).mockUnavailableReason;
        if (reason) throw new InvalidControlError(reason);
        target.passthrough = false;
      } else if (input.action === "scenario") {
        const scenario = target.scenarios.find((s) => s.id === input.scenarioId);
        if (!scenario || scenario.status < 200 || scenario.status > 599) throw new InvalidControlError("响应场景不存在或浏览器不支持其状态码");
        target.activeScenarioId = scenario.id;
        if (target.responseSelection) target.responseSelection.mode = "fixed";
        target.passthrough = false;
      } else throw new InvalidControlError("未知的接口操作");
      target.enabled = true;
      // Guarantee: 先写候选配置再发布；作用于当前测试包，不改变匹配规则、优先级和条件分支草稿。
      const serialized = JSON.stringify(candidate, null, 2);
      await this.repository.write(candidate, serialized);
      this.state = candidate;
      this.persistedSnapshot = serialized;
      return controlledApi(target);
    });
  }

  async updateApi(id: string, input: {
    name?: unknown;
    enabled?: unknown;
    priority?: unknown;
    matchMode?: unknown;
    matchRules?: unknown;
  }) {
    return this.enqueue(async () => {
      const found = this.requireApi(id);
      // Rule: 先换代 API 数组，即使后续校验失败也不会复用旧的排序缓存。
      found.packageConfig.apis = [...found.packageConfig.apis];
      const api = found.api;
      if (input.name !== undefined) api.name = validateName(input.name, "接口");
      if (input.enabled !== undefined) {
        if (typeof input.enabled !== "boolean") throw new Error("enabled 必须是布尔值");
        api.enabled = input.enabled;
        if (api.passthrough) api.passthrough = false;
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
    });
  }

  async saveResponseSelection(id: string, input: { selection?: unknown; activeScenarioId?: unknown }) {
    return this.enqueue(async () => {
      const { api } = this.requireApi(id);
      validateSelection(input.selection, api.scenarios.map((s) => s.id));
      const activeId = input.activeScenarioId;
      if (activeId !== null && (typeof activeId !== "string" || !api.scenarios.some((s) => s.id === activeId)))
        throw new Error("固定响应场景不存在");
      const selection = structuredClone(input.selection);
      // Guarantee: 先持久化候选快照，成功后才发布到运行态；失败不改变原配置。
      const candidate = structuredClone(this.getState());
      const target = candidate.packages.flatMap((p) => p.apis).find((a) => a.id === id)!;
      target.responseSelection = selection;
      target.activeScenarioId = activeId as string | null;
      if (target.passthrough) target.passthrough = false;
      const serialized = JSON.stringify(candidate, null, 2);
      await this.repository.write(candidate, serialized);
      api.responseSelection = selection;
      api.activeScenarioId = target.activeScenarioId;
      if (api.passthrough) api.passthrough = false;
      this.persistedSnapshot = serialized;
      return api;
    });
  }

  async moveApi(id: string, input: { packageId?: unknown }) {
    return this.enqueue(async () => {
      const found = this.requireApi(id);
      if (typeof input.packageId !== "string" || !input.packageId) throw new Error("请选择目标测试包");
      const destination = this.requirePackage(input.packageId);
      if (destination.id === found.packageConfig.id) throw new Error("接口已经在该测试包中");
      found.packageConfig.apis = found.packageConfig.apis.filter((item) => item.id !== id);
      destination.apis = [...destination.apis, found.api];
      await this.save();
      return found.api;
    });
  }

  async deleteApi(id: string) {
    return this.enqueue(async () => {
      const found = this.requireApi(id);
      found.packageConfig.apis = found.packageConfig.apis.filter((item) => item.id !== found.api.id);
      await this.save();
      return { success: true };
    });
  }

  async createScenario(apiId: string, input: {
    name?: unknown;
    status?: unknown;
    delayMs?: unknown;
    responseBody?: unknown;
    color?: unknown;
    responseType?: unknown;
    fieldPaths?: unknown;
    activate?: unknown;
  }) {
    return this.enqueue(async () => {
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
      validateScenarioResponse(input.responseType, input.fieldPaths, scenario.status, scenario.responseBody);
      if (input.responseType !== undefined) scenario.responseType = input.responseType as Scenario["responseType"];
      if (input.fieldPaths !== undefined) scenario.fieldPaths = input.fieldPaths as string[];
      api.scenarios.push(scenario);
      if (shouldActivate) {
        api.activeScenarioId = scenario.id;
        if (api.passthrough) api.passthrough = false;
      }
      await this.save();
      return scenario;
    });
  }

  async saveCapturedScenario(capture: ExtensionCaptureInput, input: SaveCaptureInput): Promise<CaptureSaveResult> {
    return this.enqueue(async () => {
      if (input.packageId !== this.getState().currentPackageId)
        throw new InvalidCaptureError("当前测试包已变化，请刷新页面确认保存目标");
      if (typeof input.activate !== "boolean") throw new InvalidCaptureError("请选择是否启用场景");
      const candidate = structuredClone(this.getState());
      const pkg = candidate.packages.find((p) => p.id === input.packageId);
      if (!pkg) throw new NotFoundError("测试包不存在");
      let api = input.apiId ? pkg.apis.find((a) => a.id === input.apiId) : undefined;
      if (input.apiId && !api) throw new NotFoundError("目标接口不存在或已移至其他测试包");
      if (input.activate && api?.responseSelection?.mode === "conditional")
        throw new InvalidCaptureError("目标接口使用条件分支，请仅保存后在响应规则中选择该场景");
      let scene: Scenario;
      try {
        const status = validateStatus(input.status);
        if (status < 200) throw new Error("浏览器 Mock 仅支持 200–599 状态码");
        if (typeof input.responseBody !== "string") throw new Error("响应内容必须是 JSON 文本");
        scene = {
          id: randomUUID(), name: validateName(input.scenarioName, "场景"), status,
          delayMs: validateDelay(input.delayMs), responseBody: parseJsonBody(input.responseBody), color: "blue",
        };
        if (!api) validateName(input.apiName, "接口");
      } catch (error) {
        throw new InvalidCaptureError(error instanceof Error ? error.message : "场景参数无效");
      }
      if (!api) {
        const url = new URL(capture.request.url);
        api = {
          id: randomUUID(), name: validateName(input.apiName, "接口"), enabled: true,
          priority: Math.max(0, ...pkg.apis.map((a) => a.priority)) + 10,
          matchMode: "AND",
          matchRules: [
            { id: randomUUID(), source: "method", field: "method", operator: "equals", value: capture.request.method },
            { id: randomUUID(), source: "url", field: "host", operator: "equals", value: url.host },
            { id: randomUUID(), source: "url", field: "path", operator: "equals", value: url.pathname },
          ],
          activeScenarioId: null, scenarios: [],
        };
        pkg.apis.push(api);
      }
      api.scenarios.push(scene);
      if (input.activate) { api.enabled = true; api.activeScenarioId = scene.id; if (api.passthrough) api.passthrough = false; }
      // Guarantee: 接口、规则、场景一起提交；写盘成功前不改变正在生效的配置。
      const serialized = JSON.stringify(candidate, null, 2);
      await this.repository.write(candidate, serialized);
      this.state = candidate;
      this.persistedSnapshot = serialized;
      return { packageId: pkg.id, apiId: api.id, scenarioId: scene.id, activated: input.activate };
    });
  }

  async updateScenario(id: string, input: {
    name?: unknown;
    status?: unknown;
    delayMs?: unknown;
    responseBody?: unknown;
    color?: unknown;
    responseType?: unknown;
    fieldPaths?: unknown;
  }) {
    return this.enqueue(async () => {
      const scenario = this.requireScenario(id).scenario;
      if (input.name !== undefined) scenario.name = validateName(input.name, "场景");
      if (input.status !== undefined) scenario.status = validateStatus(input.status);
      if (input.delayMs !== undefined) scenario.delayMs = validateDelay(input.delayMs);
      if (input.color !== undefined) {
        if (typeof input.color !== "string") throw new Error("场景颜色格式不正确");
        scenario.color = input.color;
      }
      if (input.responseBody !== undefined) scenario.responseBody = parseJsonBody(input.responseBody);
      const responseType = input.responseType === undefined ? scenario.responseType : input.responseType;
      const fieldPaths = input.fieldPaths === undefined ? scenario.fieldPaths : input.fieldPaths;
      validateScenarioResponse(responseType, fieldPaths, scenario.status, scenario.responseBody);
      if (input.responseType !== undefined) scenario.responseType = input.responseType as Scenario["responseType"];
      if (input.fieldPaths !== undefined) scenario.fieldPaths = input.fieldPaths as string[];
      await this.save();
      return scenario;
    });
  }

  async deleteScenario(id: string) {
    return this.enqueue(async () => {
      const found = this.requireScenario(id);
      const references = found.api.responseSelection ? scenarioReferences(selectionFor(found.api), id) : [];
      if (references.length) throw new Error(`场景「${found.scenario.name}」被 ${references.join("、")} 引用，请先解除或替换引用`);
      found.api.scenarios = found.api.scenarios.filter((item) => item.id !== found.scenario.id);
      if (found.api.activeScenarioId === found.scenario.id) found.api.activeScenarioId = null;
      await this.save();
      return { success: true, activeScenarioId: found.api.activeScenarioId };
    });
  }

  async activateScenario(apiId: string, scenarioId: string) {
    return this.enqueue(async () => {
      const api = this.requireApi(apiId).api;
      if (!api.scenarios.some((item) => item.id === scenarioId)) throw new NotFoundError("Scenario not found");
      api.activeScenarioId = scenarioId;
      if (api.passthrough) api.passthrough = false;
      await this.save();
      return { success: true, activeScenarioId: scenarioId };
    });
  }

  async deactivateScenario(apiId: string) {
    return this.enqueue(async () => {
      const api = this.requireApi(apiId).api;
      api.activeScenarioId = null;
      await this.save();
      return { success: true, activeScenarioId: null };
    });
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
    const serializedState = JSON.stringify(state, null, 2);
    await this.repository.write(state, serializedState);
    // Rule: 常驻已提交快照，失败恢复由变更队列统一负责，避免长期保留整份对象副本。
    this.persistedSnapshot = serializedState;
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
