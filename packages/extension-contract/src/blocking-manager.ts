export const BLOCKING_MANAGER_CHANNEL = "mock-console:blocking-manager";

// Rule: 控制台桥仅允许正式与开发的本机页面，不按后缀或任意 localhost 端口放行。
export function isBlockingConsoleUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) &&
      ["22333", "22334"].includes(url.port) && !url.username && !url.password;
  } catch { return false; }
}

export function isBlockingManagerUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "chrome-extension:" && /^[a-p]{32}$/.test(url.hostname) &&
      url.pathname === "/blocking-manager.html" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}
