export const WHITELIST_STORAGE_KEY = "allowedPageDomains";
export const DEFAULT_WHITELIST = ["localhost", "127.0.0.1"] as const;

export type WhitelistParseResult = {
  domains: string[];
  invalid: string[];
};

export function parseWhitelistText(value: string): WhitelistParseResult {
  const domains: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of value.split(/[\s,]+/).filter(Boolean)) {
    const domain = normalizeDomain(token);
    if (!domain) {
      invalid.push(token);
      continue;
    }
    if (!seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  }

  return { domains, invalid };
}

export function normalizeWhitelist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const domain = normalizeDomain(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

export function normalizeDomain(value: string): string | null {
  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  if (candidate.startsWith("*.")) candidate = candidate.slice(2);

  if (candidate.includes("://")) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) return null;
    candidate = url.hostname.toLowerCase();
  } else if (/[\/?#:@]/.test(candidate)) {
    return null;
  }

  if (candidate.endsWith(".")) candidate = candidate.slice(0, -1);
  if (candidate.length === 0 || candidate.length > 253) return null;
  const labels = candidate.split(".");
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))
    return null;
  return candidate;
}

export function hostMatchesWhitelist(host: string | null | undefined, whitelist: readonly string[]) {
  const normalizedHost = typeof host === "string" ? normalizeDomain(host) : null;
  if (!normalizedHost) return false;
  return whitelist.some((domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
}

export function urlMatchesWhitelist(value: string, whitelist: readonly string[]) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return hostMatchesWhitelist(url.hostname, whitelist);
  } catch {
    return false;
  }
}
