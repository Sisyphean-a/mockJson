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

export type LogicalApi = {
  id: string;
  name: string;
  enabled: boolean;
  passthrough?: boolean;
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
  apis: LogicalApi[];
};

export type LegacyPackageConfig = {
  id: string;
  name: string;
  targetBaseUrl: string;
  apis: LogicalApi[];
};

export type PersistedPackageConfig = PackageConfig | LegacyPackageConfig;

export type State = {
  currentPackageId: string | null;
  packages: PackageConfig[];
};

export type PersistedState = {
  currentPackageId: string | null;
  packages: PersistedPackageConfig[];
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
