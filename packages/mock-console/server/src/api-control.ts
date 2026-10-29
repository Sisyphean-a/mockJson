import { createHash } from "node:crypto";
import type { ExtensionControlledApi, ExtensionControlInspection, ExtensionControlRequest } from "@mock-json/extension-contract";
import type { LogicalApi, State } from "../../shared/types.js";
import { selectionFor } from "../../shared/response-selection.js";
import { matchingApis, selectMatchingApi } from "./runtime-resolver.js";

export function apiControlRevision(api: LogicalApi) {
  return createHash("sha256").update(JSON.stringify(api)).digest("hex");
}

export function controlledApi(api: LogicalApi): ExtensionControlledApi {
  const selection = selectionFor(api);
  const ids = selection.mode === "fixed" ? [api.activeScenarioId] :
    [...selection.branches.map((branch) => branch.scenarioId), ...(selection.fallback.enabled ? [selection.fallback.scenarioId] : [])];
  const usable = api.scenarios.some((s) => ids.includes(s.id) && s.status >= 200 && s.status <= 599);
  return {
    id: api.id, name: api.name, enabled: api.enabled, passthrough: api.passthrough === true,
    revision: apiControlRevision(api), mode: selection.mode, activeScenarioId: api.activeScenarioId,
    mockUnavailableReason: usable ? "" : "请先选择一个浏览器支持的响应场景",
    scenarios: api.scenarios.map((s) => ({ id: s.id, name: s.name, status: s.status, responseType: s.responseType ?? "mock" })),
  };
}

export function inspectApiControls(state: State, request: ExtensionControlRequest): ExtensionControlInspection {
  const pkg = state.packages.find((p) => p.id === state.currentPackageId);
  if (!pkg) return { package: null, matchedApiId: null, apis: [] };
  const context = { url: new URL(request.url), method: request.method, headers: request.headers };
  return {
    package: { id: pkg.id, name: pkg.name },
    matchedApiId: selectMatchingApi(pkg.apis, context)?.api.id ?? null,
    // Rule: 查找包含已停用接口，但只返回操作所需摘要，不传输场景 JSON 或修改判定日志。
    apis: matchingApis(pkg.apis, context).map(controlledApi),
  };
}
