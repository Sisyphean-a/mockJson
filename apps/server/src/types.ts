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
export type PackageConfig = {
  id: string;
  name: string;
  targetBaseUrl: string;
  apis: LogicalApi[];
};
export type State = {
  currentPackageId: string | null;
  packages: PackageConfig[];
};
