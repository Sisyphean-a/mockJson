export type BlockingRuleInput = {
  enabled: boolean;
  scopeOrigin: string;
  method: string;
  targetUrl: string;
  matchMode: "exact" | "prefix";
};

export type BlockingRule = BlockingRuleInput & { id: string; revision: string };
export const BLOCKING_PORT = "request-blocking";

export function httpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("请输入有效的 HTTP / HTTPS 地址"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("请输入不含用户名密码的 HTTP / HTTPS 地址");
  return url;
}

export function normalizeBlockingInput(value: unknown): BlockingRuleInput {
  if (!value || typeof value !== "object") throw new Error("屏蔽规则格式无效");
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== "boolean" || typeof input.scopeOrigin !== "string" ||
      typeof input.method !== "string" || typeof input.targetUrl !== "string" ||
      (input.matchMode !== "exact" && input.matchMode !== "prefix")) throw new Error("屏蔽规则格式无效");
  const method = input.method.trim().toUpperCase();
  if (!method || (method !== "*" && !/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method))) throw new Error("请求方法无效");
  const scopeOrigin = input.scopeOrigin.trim() === "*" ? "*" : httpUrl(input.scopeOrigin.trim()).origin;
  const target = httpUrl(input.targetUrl.trim());
  return { enabled: input.enabled, scopeOrigin, method, targetUrl: target.origin + target.pathname, matchMode: input.matchMode };
}

export function blockingIdentity(rule: BlockingRuleInput) {
  return JSON.stringify([rule.scopeOrigin, rule.method, rule.targetUrl, rule.matchMode]);
}

type BlockingEntry = { pageUrl: string; request: { url: string; method: string } };

export function compileBlockingRules(rules: readonly BlockingRule[]) {
  const index = new Map<string, { exact: Set<string>; prefixes: string[] }>();
  const key = (scope: string, method: string, origin: string) => JSON.stringify([scope, method, origin]);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const pattern = httpUrl(rule.targetUrl);
    const id = key(rule.scopeOrigin, rule.method, pattern.origin);
    const paths = index.get(id) ?? { exact: new Set<string>(), prefixes: [] };
    if (rule.matchMode === "exact") paths.exact.add(pattern.pathname);
    else paths.prefixes.push(pattern.pathname);
    index.set(id, paths);
  }
  return (entry: BlockingEntry) => {
    if (!index.size) return false;
    let target: URL, scope: string;
    try { target = httpUrl(entry.request.url); scope = httpUrl(entry.pageUrl).origin; } catch { return false; }
    for (const site of [scope, "*"]) for (const method of [entry.request.method.toUpperCase(), "*"]) {
      const paths = index.get(key(site, method, target.origin));
      if (paths && (paths.exact.has(target.pathname) || paths.prefixes.some(path => target.pathname.startsWith(path)))) return true;
    }
    return false;
  };
}

export function blockingDraft(entry: { pageUrl: string; request: { url: string; method: string } }): BlockingRuleInput {
  return normalizeBlockingInput({ enabled: true, scopeOrigin: entry.pageUrl, method: entry.request.method, targetUrl: entry.request.url, matchMode: "exact" });
}
