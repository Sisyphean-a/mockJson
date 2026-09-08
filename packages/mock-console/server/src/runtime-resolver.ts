import type {
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
  LogicalApi,
  State,
} from "../../shared/types.js";
import { matchApi, type MatchContext } from "./matcher.js";

type ActiveApi = State["packages"][number]["apis"][number];

type RankedApisCache = {
  inputs: LogicalApi[];
  priorities: number[];
  ranked: LogicalApi[];
};

const rankedApisCache = new WeakMap<LogicalApi[], RankedApisCache>();

function rankedApis(apis: LogicalApi[]) {
  const cached = rankedApisCache.get(apis);
  if (
    cached &&
    cached.inputs.length === apis.length &&
    cached.inputs.every((api, index) => api === apis[index] && api.priority === cached.priorities[index])
  ) return cached.ranked;

  const ranked = apis
    .map((api, index) => ({ api, index }))
    .sort((left, right) => right.api.priority - left.api.priority || left.index - right.index)
    .map(({ api }) => api);
  rankedApisCache.set(apis, { inputs: apis.slice(), priorities: apis.map((api) => api.priority), ranked });
  return ranked;
}

export function activeScenario(api: ActiveApi) {
  return api.scenarios.find((scenario) => scenario.id === api.activeScenarioId);
}

export function selectMatchingApi(apis: LogicalApi[] | undefined, context: MatchContext) {
  if (!apis) return undefined;
  for (const api of rankedApis(apis)) {
    if (api.enabled === false) continue;
    const scenario = activeScenario(api);
    if (scenario && matchApi(api, context)) return { api, scenario };
  }
  return undefined;
}

export function resolveExtensionRequest(
  state: State,
  request: ExtensionRuntimeRequest,
): ExtensionRuntimeResponse {
  const packageConfig = state.packages.find((item) => item.id === state.currentPackageId);
  const url = new URL(request.url);
  const selected = selectMatchingApi(packageConfig?.apis, {
    method: request.method.toUpperCase(),
    url,
    headers: request.headers,
  });

  if (!selected) return { action: "pass", reason: "unmatched" };
  if (selected.scenario.status < 200) return { action: "pass", reason: "unsupported-status" };

  return {
    action: "mock",
    status: selected.scenario.status,
    delayMs: selected.scenario.delayMs,
    body: JSON.stringify(selected.scenario.responseBody) ?? "null",
    headers: { "content-type": "application/json; charset=utf-8" },
  };
}
