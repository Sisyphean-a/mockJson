import type { ExtensionPassReason } from "@mock-json/extension-contract";

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

export type Scenario = {
  id: string;
  name: string;
  status: number;
  delayMs: number;
  responseBody: unknown;
  color?: string;
};

export type LogicalApi = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "AND" | "OR";
  matchRules: MatchRule[];
  activeScenarioId: string | null;
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
  response: RequestLogResponse;
  error?: string;
};

export type RequestLogsResponse = {
  logs: RequestLog[];
};

export type RequestLogsDeltaResponse = RequestLogsResponse & {
  reset: boolean;
};
