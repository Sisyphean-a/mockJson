import type { LogicalApi, MatchRule } from "../../shared/types.js";

export type MatchContext = {
  method: string;
  url: URL;
  headers: Record<string, string | string[] | undefined>;
};

function header(headers: MatchContext["headers"], field: string) {
  const direct = Object.hasOwn(headers, field) ? headers[field] : undefined;
  if (direct !== undefined) return direct;

  const normalizedField = field.toLowerCase();
  for (const key in headers) {
    if (Object.hasOwn(headers, key) && key.toLowerCase() === normalizedField) return headers[key];
  }
  return undefined;
}

function ruleValue(rule: MatchRule, context: MatchContext): string | string[] | undefined {
  if (rule.source === "header") return header(context.headers, rule.field);
  if (rule.source === "method") return context.method;
  return rule.field === "host"
    ? context.url.host
    : rule.field === "path"
      ? context.url.pathname
      : context.url.href;
}

function matches(value: string, rule: MatchRule) {
  if (rule.operator === "equals") return value === rule.value;
  if (rule.operator === "notEquals") return value !== rule.value;
  if (rule.operator === "notContains") return !value.includes(rule.value);
  return value.includes(rule.value);
}

export function matchRule(rule: MatchRule, context: MatchContext): boolean {
  const value = ruleValue(rule, context);
  const exists = value !== undefined && (!Array.isArray(value) || value.length > 0);
  if (rule.operator === "exists") return exists;
  if (rule.operator === "notExists") return !exists;
  if (!exists) return false;

  if (Array.isArray(value)) {
    return rule.operator === "notEquals" || rule.operator === "notContains"
      ? value.every((item) => matches(item, rule))
      : value.some((item) => matches(item, rule));
  }
  return matches(value, rule);
}

export function matchApi(api: LogicalApi, context: MatchContext) {
  if (api.matchRules.length === 0) return false;
  if (api.matchMode === "AND") {
    for (const rule of api.matchRules) if (!matchRule(rule, context)) return false;
    return true;
  }
  for (const rule of api.matchRules) if (matchRule(rule, context)) return true;
  return false;
}
