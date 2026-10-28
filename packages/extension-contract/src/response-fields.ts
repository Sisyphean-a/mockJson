export type ScenarioResponseType = "mock" | "real-overrides" | "mock-with-real";

// Rule: 路径使用 JSON Pointer；不自动创建父级、不扩展数组，避免把错误结构拼成成功响应。
function parts(path: string) {
  if (!path.startsWith("/") || /~(?![01])/.test(path)) throw new Error(`字段路径无效：${path}，请使用 /data/imageUrl`);
  return path.slice(1).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function member(value: unknown, key: string, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" ||
      (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)))
    throw new Error(`字段结构不匹配：${path}`);
  return value as Record<string, unknown>;
}

function read(value: unknown, keys: string[], path: string): unknown {
  for (const key of keys) {
    const parent = member(value, key, path);
    if (!Object.hasOwn(parent, key)) throw new Error(`字段不存在：${path}`);
    value = parent[key];
  }
  return value;
}

export function validateResponseFields(type: unknown, paths: unknown): asserts type is ScenarioResponseType | undefined {
  if (type !== undefined && type !== "mock" && type !== "real-overrides" && type !== "mock-with-real")
    throw new Error("响应场景类型无效");
  if (paths !== undefined && (!Array.isArray(paths) || !paths.every((p) => typeof p === "string")))
    throw new Error("字段路径必须是文本列表");
  const fields = (paths ?? []) as string[];
  if (type !== undefined && type !== "mock" && fields.length === 0) throw new Error("混合响应至少指定一个字段路径");
  const decoded = fields.map(parts);
  for (let i = 0; i < decoded.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = decoded[i], b = decoded[j];
      if (a.slice(0, Math.min(a.length, b.length)).every((key, k) => key === b[k]))
        throw new Error("字段路径不能重复或包含父子路径");
    }
  }
}

export function validateMockFields(type: unknown, paths: unknown, mock: unknown) {
  validateResponseFields(type, paths);
  if (type === "mock" || type === undefined) return;
  for (const path of paths as string[]) {
    const keys = parts(path);
    if (type === "real-overrides") read(mock, keys, path);
    else member(read(mock, keys.slice(0, -1), path), keys[keys.length - 1], path);
  }
}

export function composeResponse(type: Exclude<ScenarioResponseType, "mock">, mock: unknown, real: unknown, paths: string[]): unknown {
  validateResponseFields(type, paths);
  const source = type === "real-overrides" ? mock : real;
  // Guarantee: 只修改独立 JSON 副本；配置、原响应及其他并发请求不会被污染。
  const result: unknown = JSON.parse(JSON.stringify(type === "real-overrides" ? real : mock));
  for (const path of paths) {
    const keys = parts(path);
    const value = read(source, keys, path);
    const parent = member(read(result, keys.slice(0, -1), path), keys[keys.length - 1], path);
    // Rule: defineProperty 让 __proto__ 等合法 JSON 键始终作为自有字段，不触发原型 setter。
    Object.defineProperty(parent, keys[keys.length - 1], {
      value: JSON.parse(JSON.stringify(value)), enumerable: true, writable: true, configurable: true,
    });
  }
  return result;
}

export function composedHeaders(headers: Record<string, string>): Record<string, string> {
  const stale = new Set(["content-length", "content-encoding", "transfer-encoding", "etag", "last-modified", "content-md5", "digest", "content-range", "accept-ranges"]);
  return { ...Object.fromEntries(Object.entries(headers).filter(([key]) => !stale.has(key.toLowerCase()))),
    "content-type": "application/json; charset=utf-8" };
}
