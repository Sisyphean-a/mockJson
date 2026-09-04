export type RuntimeLocation = Pick<Location, "protocol" | "port">;

export type RuntimeEndpoints = Readonly<{
  servicePort: string;
  localMockUrl: string;
  lanMockUrl: string;
  adminUrl(path: string): string;
}>;

export function createRuntimeEndpoints(
  location: RuntimeLocation | undefined = typeof window === "undefined" ? undefined : window.location,
): RuntimeEndpoints {
  const isHttpPage = location?.protocol === "http:" || location?.protocol === "https:";
  const servicePort = location?.port === "22334" ? "22333" : location?.port || "22333";
  const adminOrigin = !isHttpPage || location?.port === "22334" ? `http://127.0.0.1:${servicePort}` : "";

  return {
    servicePort,
    localMockUrl: `http://127.0.0.1:${servicePort}`,
    lanMockUrl: `http://<电脑局域网 IP>:${servicePort}/原始路径`,
    adminUrl: (path) => `${adminOrigin}${path}`,
  };
}
