import type { PackageConfig, State } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isUuidLike = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

export function isValidState(value: unknown): value is State {
  if (!isRecord(value) || !Array.isArray(value.packages)) return false;
  if (value.currentPackageId !== null && !isUuidLike(value.currentPackageId))
    return false;
  return value.packages.every(isValidPackage);
}

export function isValidPackage(value: unknown): value is PackageConfig {
  if (!isRecord(value)) return false;
  return (
    isUuidLike(value.id) &&
    typeof value.name === "string" &&
    typeof value.targetBaseUrl === "string" &&
    Array.isArray(value.apis) &&
    value.apis.every(isValidApi)
  );
}

function isValidApi(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    isUuidLike(value.id) &&
    typeof value.name === "string" &&
    typeof value.enabled === "boolean" &&
    Number.isInteger(value.priority) &&
    (value.matchMode === "AND" || value.matchMode === "OR") &&
    Array.isArray(value.matchRules) &&
    Array.isArray(value.scenarios) &&
    (value.activeScenarioId === null || isUuidLike(value.activeScenarioId)) &&
    value.matchRules.every(isValidRule) &&
    value.scenarios.every(isValidScenario)
  );
}

function isValidRule(value: unknown) {
  if (!isRecord(value) || typeof value.field !== "string" || !value.field.trim()) return false;
  const sourceValid =
    (value.source === "header") ||
    (value.source === "url" && ["fullUrl", "host", "path"].includes(value.field)) ||
    (value.source === "method" && value.field === "method");
  const operator = String(value.operator);
  const operatorValid = ["equals", "notEquals", "contains", "notContains", "exists", "notExists"].includes(operator);
  const valueValid = typeof value.value === "string" && (["exists", "notExists"].includes(operator) || value.value.length > 0);
  return isUuidLike(value.id) && sourceValid && operatorValid && valueValid;
}

function isValidScenario(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    isUuidLike(value.id) &&
    typeof value.name === "string" &&
    typeof value.status === "number" &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    typeof value.delayMs === "number" &&
    Number.isInteger(value.delayMs) &&
    value.delayMs >= 0 &&
    value.delayMs <= 30000 &&
    "responseBody" in value &&
    (value.color === undefined || ["blue", "green", "yellow", "red", "gray"].includes(String(value.color)))
  );
}

export function parseJsonBody(value: unknown) {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  JSON.stringify(value);
  return value;
}

export function validateName(value: unknown, fallback: string) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 200) throw new Error(`${fallback}名称不能为空且不能超过 200 个字符`);
  return name;
}

export function validateStatus(value: unknown, fallback = 200) {
  const status = value === undefined ? fallback : value;
  if (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599)
    throw new Error("HTTP 状态码必须是 100 到 599 的整数");
  return Number(status);
}

export function validateDelay(value: unknown, fallback = 0) {
  const delay = value === undefined ? fallback : value;
  if (!Number.isInteger(delay) || Number(delay) < 0 || Number(delay) > 30000)
    throw new Error("延迟必须是 0 到 30000 毫秒的整数");
  return Number(delay);
}

export function validateMatchRules(value: unknown) {
  if (!Array.isArray(value) || !value.every(isValidRule))
    throw new Error("匹配条件格式不正确");
  return value;
}
