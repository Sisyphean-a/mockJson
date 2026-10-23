import type { LogicalApi, ResponseCondition, ResponseSelection } from "./types.js";

export type SelectionRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: string;
  bodyUnavailable?: string;
};
export type ConditionResult = { matched: boolean; actual?: unknown; reason: string };
export type SelectionResult = {
  action: "branch" | "fallback" | "fixed" | "pass";
  scenarioId: string | null;
  branchId?: string;
  branches: { id: string; status: "matched" | "missed" | "skipped"; conditions: ConditionResult[] }[];
};

export function selectionFor(api: Pick<LogicalApi, "responseSelection" | "activeScenarioId">): ResponseSelection {
  return api.responseSelection ?? {
    mode: "fixed", branches: [],
    fallback: { enabled: api.activeScenarioId !== null, scenarioId: api.activeScenarioId },
  };
}

export class SelectionValidationError extends Error {
  constructor(readonly path: string, message: string) { super(message); }
}

export function validateSelection(value: unknown, scenarioIds: string[]): asserts value is ResponseSelection {
  const fail = (path: string, message: string): never => { throw new SelectionValidationError(path, message); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!record(value) || !["fixed", "conditional"].includes(String(value.mode)) || !Array.isArray(value.branches))
    fail("mode", "响应模式或分支列表无效");
  const selection = value as Record<string, unknown> & { branches: unknown[] };
  const fallback = selection.fallback;
  if (!record(fallback) || typeof fallback.enabled !== "boolean") fail("fallback", "兜底配置无效");
  const f = fallback as Record<string, unknown>;
  if (f.scenarioId !== null && (typeof f.scenarioId !== "string" || !scenarioIds.includes(f.scenarioId)))
    fail("fallback", "兜底场景不存在，请重新选择");
  if (f.enabled && f.scenarioId === null) fail("fallback", "开启兜底时请选择场景");
  const branchIds = new Set<string>();
  selection.branches.forEach((item, i) => {
    const path = `branches.${i}`;
    if (!record(item)) fail(path, "分支格式无效");
    const b = item as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id || branchIds.has(b.id)) fail(path, "分支 ID 为空或重复");
    branchIds.add(b.id as string);
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 200) fail(`${path}.name`, "分支名称不能为空且最多 200 字");
    if (typeof b.scenarioId !== "string" || !scenarioIds.includes(b.scenarioId)) fail(`${path}.scenarioId`, "请选择当前接口的目标场景");
    if (!["AND", "OR"].includes(String(b.matchMode))) fail(path, "条件组合方式无效");
    if (!Array.isArray(b.conditions) || !b.conditions.length) fail(`${path}.conditions`, "至少添加一条条件，无条件响应请使用兜底");
    const conditionIds = new Set<string>();
    (b.conditions as unknown[]).forEach((condition, j) => {
      const cp = `${path}.conditions.${j}`;
      if (!record(condition)) fail(cp, "条件格式无效");
      const c = condition as Record<string, unknown>;
      if (typeof c.id !== "string" || !c.id || conditionIds.has(c.id)) fail(cp, "条件 ID 为空或重复");
      conditionIds.add(c.id as string);
      if (c.source !== "header" && c.source !== "body") fail(cp, "请选择请求头或 JSON 请求体");
      if (typeof c.field !== "string" || !c.field.trim()) fail(cp, "请填写字段位置");
      if (c.source === "body" && !validPointer(c.field as string)) fail(cp, "请求体字段使用 JSON Pointer，例如 /user/status，数组使用 /items/0/id");
      if (c.source === "header" && !/^[!#$%&'*+.^_`|~\w-]+$/.test(c.field as string)) fail(cp, "请求头名称无效");
      if (!["equals", "notEquals", "contains", "exists", "notExists", "gt", "gte", "lt", "lte"].includes(String(c.operator))) fail(cp, "判断方式无效");
      if (!["string", "number", "boolean"].includes(typeof c.value) && c.value !== null) fail(cp, "比较值必须是文本、数字、布尔或空值");
      if (typeof c.value === "number" && !Number.isFinite(c.value)) fail(cp, "请输入有效数字");
      if (c.source === "header" && typeof c.value !== "string") fail(cp, "请求头的比较值必须是文本");
      if (c.operator === "contains" && typeof c.value !== "string") fail(cp, "包含仅适用于文本");
      if (["gt", "gte", "lt", "lte"].includes(String(c.operator)) && typeof c.value !== "number") fail(cp, "大小比较仅适用于数字");
    });
  });
}

function validPointer(field: string) {
  return field.startsWith("/") && !/~(?![01])/.test(field);
}

export function scenarioReferences(selection: ResponseSelection, id: string) {
  const refs = selection.branches.filter((b) => b.scenarioId === id).map((b) => `分支「${b.name}」`);
  if (selection.fallback.scenarioId === id) refs.push(selection.fallback.enabled ? "兜底响应" : "已保留的兜底选择");
  return refs;
}

export function evaluateSelection(selection: ResponseSelection, activeScenarioId: string | null, request: SelectionRequest): SelectionResult {
  if (selection.mode === "fixed") return { action: activeScenarioId ? "fixed" : "pass", scenarioId: activeScenarioId, branches: [] };
  let parsed = false;
  let body: unknown;
  let bodyReason = "";
  const conditionResult = (c: ResponseCondition): ConditionResult => {
    let actual: unknown;
    let exists = false;
    if (c.source === "header") {
      const key = Object.keys(request.headers).find((k) => k.toLowerCase() === c.field.toLowerCase());
      actual = key === undefined ? undefined : request.headers[key];
      if (Array.isArray(actual)) actual = actual.join(", ");
      exists = actual !== undefined;
    } else {
      if (!parsed) {
        parsed = true;
        if (request.bodyUnavailable) bodyReason = `请求体不可读取：${request.bodyUnavailable}`;
        else if (request.body === undefined) bodyReason = "请求体无法取得";
        else {
          try { body = JSON.parse(request.body); }
          catch { bodyReason = "请求体不是有效 JSON"; }
        }
      }
      if (bodyReason) return { matched: false, reason: bodyReason };
      actual = body;
      exists = true;
      for (const part of c.field.slice(1).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        if (actual === null || typeof actual !== "object" || (Array.isArray(actual) && !/^(0|[1-9]\d*)$/.test(key)) || !Object.hasOwn(actual, key)) { exists = false; actual = undefined; break; }
        actual = (actual as Record<string, unknown>)[key];
      }
    }
    if (c.operator === "exists") return { matched: exists, actual, reason: exists ? "字段存在" : "字段不存在" };
    if (c.operator === "notExists") return { matched: !exists, actual, reason: exists ? "字段存在" : "字段不存在" };
    if (!exists) return { matched: false, reason: "字段不存在，普通比较不命中" };
    let matched = false;
    if (c.operator === "equals") matched = actual === c.value;
    if (c.operator === "notEquals") matched = actual !== c.value;
    if (c.operator === "contains") matched = typeof actual === "string" && actual.includes(String(c.value));
    if (typeof actual === "number" && typeof c.value === "number") {
      if (c.operator === "gt") matched = actual > c.value;
      if (c.operator === "gte") matched = actual >= c.value;
      if (c.operator === "lt") matched = actual < c.value;
      if (c.operator === "lte") matched = actual <= c.value;
    }
    return { matched, actual, reason: matched ? "条件成立" : "条件不成立（按原始类型比较）" };
  };
  const branches: SelectionResult["branches"] = [];
  let hit: typeof selection.branches[number] | undefined;
  for (const branch of selection.branches) {
    if (hit) { branches.push({ id: branch.id, status: "skipped", conditions: [] }); continue; }
    const conditions = branch.conditions.map(conditionResult);
    const matched = conditions.length > 0 && (branch.matchMode === "AND" ? conditions.every((c) => c.matched) : conditions.some((c) => c.matched));
    branches.push({ id: branch.id, status: matched ? "matched" : "missed", conditions });
    if (matched) hit = branch;
  }
  if (hit) return { action: "branch", scenarioId: hit.scenarioId, branchId: hit.id, branches };
  return { action: selection.fallback.enabled ? "fallback" : "pass", scenarioId: selection.fallback.enabled ? selection.fallback.scenarioId : null, branches };
}
