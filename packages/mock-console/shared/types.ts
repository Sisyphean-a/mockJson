import type { ExtensionCaptureInput, ExtensionCaptureTicket, ExtensionPassReason, ExtensionRuntimeRequest } from "@mock-json/extension-contract";

export type CaptureSaveResult = { packageId: string; apiId: string; scenarioId: string; activated: boolean };
export type CaptureDraft = ExtensionCaptureInput & ExtensionCaptureTicket & { saved?: CaptureSaveResult };
export type SaveCaptureInput = {
  packageId: string;
  apiId?: string;
  apiName: string;
  scenarioName: string;
  status: number;
  delayMs: number;
  responseBody: string;
  activate: boolean;
};

export type MatchSource = "header" | "url" | "method";
export type MatchOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "exists"
  | "notExists";

export type MatchRule = {
  id: string;
  source: MatchSource;
  field: string;
  operator: MatchOperator;
  value: string;
};

export type { ScenarioResponseType } from "@mock-json/extension-contract";

export type Scenario = {
  id: string;
  name: string;
  status: number;
  delayMs: number;
  responseBody: unknown;
  responseType?: import("@mock-json/extension-contract").ScenarioResponseType;
  fieldPaths?: string[];
  color?: string;
};

export type ResponseCondition = {
  id: string;
  source: "header" | "body";
  field: string;
  operator: "equals" | "notEquals" | "contains" | "exists" | "notExists" | "gt" | "gte" | "lt" | "lte";
  value: string | number | boolean | null;
};

export type ResponseBranch = {
  id: string;
  name: string;
  matchMode: "AND" | "OR";
  conditions: ResponseCondition[];
  scenarioId: string;
};

export type ResponseSelection = {
  mode: "fixed" | "conditional";
  branches: ResponseBranch[];
  fallback: { enabled: boolean; scenarioId: string | null };
};

export type ApiGroup = {
  id: string;
  name: string;
};

export type LogicalApi = {
  id: string;
  name: string;
  enabled: boolean;
  passthrough?: boolean;
  // Rule: 归档只影响侧栏可见性，不参与匹配、优先级与响应选择；旧配置缺省为未归档。
  archived?: boolean;
  groupId?: string | null;
  priority: number;
  matchMode: "AND" | "OR";
  matchRules: MatchRule[];
  activeScenarioId: string | null;
  responseSelection?: ResponseSelection;
  scenarios: Scenario[];
};

export type RealService = {
  id: string;
  name: string;
  baseUrl: string;
};

export type PackageConfig = {
  id: string;
  name: string;
  realServices: RealService[];
  activeRealServiceId: string | null;
  // Rule: apiGroups 顺序是分组展示顺序；接口分组只是侧栏分类，不参与运行时匹配。
  apiGroups: ApiGroup[];
  apis: LogicalApi[];
};

export type LegacyPackageConfig = {
  id: string;
  name: string;
  targetBaseUrl: string;
  apis: LogicalApi[];
};

export type PersistedPackageConfig = PackageConfig | LegacyPackageConfig;

export type GlobalDelayMode = "off" | "fixed" | "random";

// Rule: 全局延迟覆盖所有接口的场景延迟；关闭时恢复各场景自己的延迟。
export type GlobalDelay = {
  mode: GlobalDelayMode;
  fixedMs: number;
  minMs: number;
  maxMs: number;
};

export const DEFAULT_GLOBAL_DELAY: GlobalDelay = {
  mode: "off",
  fixedMs: 500,
  minMs: 200,
  maxMs: 800,
};

export type State = {
  currentPackageId: string | null;
  packages: PackageConfig[];
  globalDelay?: GlobalDelay;
};

export type PersistedState = {
  currentPackageId: string | null;
  packages: PersistedPackageConfig[];
  globalDelay?: GlobalDelay;
};

export const MAX_REQUEST_LOGS = 200;

export type RequestLogSource = "proxy" | "extension";
export type RequestLogOutcome = "mocked" | "forwarded" | "unmatched" | "passed" | "error";

export type RequestLogResponse = {
  contentType: string | null;
  body: string | null;
  byteLength: number;
  truncated: boolean;
};

export type RequestLog = {
  id: string;
  source: RequestLogSource;
  timestamp: string;
  durationMs: number;
  packageId: string | null;
  packageName: string | null;
  method: string;
  host: string | null;
  url: string;
  outcome: RequestLogOutcome;
  passReason?: ExtensionPassReason;
  apiId: string | null;
  apiName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
  status: number;
  request: {
    headers: Record<string, string>;
    body: RequestLogResponse & { unavailableReason?: ExtensionRuntimeRequest["bodyUnavailable"] };
  };
  response: RequestLogResponse;
  error?: string;
};

export type RequestLogsResponse = {
  logs: RequestLog[];
};

export type RequestLogsDeltaResponse = RequestLogsResponse & {
  reset: boolean;
};
