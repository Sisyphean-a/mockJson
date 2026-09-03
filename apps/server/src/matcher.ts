import type { LogicalApi, MatchRule } from "./types.js";
export type MatchContext = {
  method: string;
  url: URL;
  headers: Record<string, string | string[] | undefined>;
};
function header(headers: MatchContext["headers"], field: string) {
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === field.toLowerCase(),
  );
  return key ? headers[key] : undefined;
}
function values(rule: MatchRule, context: MatchContext): string[] {
  if (rule.source === "header") {
    const value = header(context.headers, rule.field);
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  }
  const field =
    rule.field === "host"
      ? context.url.host
      : rule.field === "path"
        ? context.url.pathname
        : context.url.href;
  return [field];
}
export function matchRule(rule: MatchRule, context: MatchContext): boolean {
  const found = values(rule, context);
  const exists = found.length > 0 && found.some(Boolean);
  if (rule.operator === "exists") return exists;
  if (rule.operator === "notExists") return !exists;
  return found.some((value) =>
    rule.operator === "equals"
      ? value === rule.value
      : rule.operator === "notEquals"
        ? value !== rule.value
        : rule.operator === "contains"
          ? value.includes(rule.value)
          : !value.includes(rule.value),
  );
}
export function matchApi(api: LogicalApi, context: MatchContext) {
  const results = api.matchRules.map((r) => matchRule(r, context));
  return (
    api.matchRules.length === 0 ||
    (api.matchMode === "AND" ? results.every(Boolean) : results.some(Boolean))
  );
}
