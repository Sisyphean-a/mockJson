import { randomUUID } from "node:crypto";
import { MAX_REQUEST_LOGS } from "../../shared/types.js";
import type { RequestLog, RequestLogsDeltaResponse } from "../../shared/types.js";

export { MAX_REQUEST_LOGS } from "../../shared/types.js";

export const MAX_LOG_BODY_BYTES = 32 * 1024;

export function textLogResponse(contentType: string | null, body: string): RequestLog["response"] {
  const byteLength = Buffer.byteLength(body);
  return {
    contentType,
    body: utf8Preview(body, MAX_LOG_BODY_BYTES, byteLength),
    byteLength,
    truncated: byteLength > MAX_LOG_BODY_BYTES,
  };
}

export function emptyLogResponse(contentType: string | null): RequestLog["response"] {
  return { contentType, body: "", byteLength: 0, truncated: false };
}

function utf8Preview(body: string, maxBytes: number, byteLength: number) {
  if (byteLength <= maxBytes) return body;

  let low = 0;
  let high = Math.min(body.length, maxBytes) + 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (Buffer.byteLength(body.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle;
  }
  if (
    low < body.length &&
    low > 0 &&
    body.charCodeAt(low - 1) >= 0xd800 &&
    body.charCodeAt(low - 1) <= 0xdbff &&
    body.charCodeAt(low) >= 0xdc00 &&
    body.charCodeAt(low) <= 0xdfff
  ) low -= 1;
  return Buffer.from(body.slice(0, low)).toString("utf8");
}

type RequestLogEntry = Omit<RequestLog, "id">;
type StoredEntry = { revision: number; log: RequestLog };

export class RequestLogStore {
  private readonly entries: Array<StoredEntry | undefined>;
  private readonly generation = randomUUID();
  private start = 0;
  private size = 0;
  private revision = 0;

  constructor(private readonly maxEntries = MAX_REQUEST_LOGS) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error("日志数量上限必须是正整数");
    this.entries = new Array(maxEntries);
  }

  record(entry: RequestLogEntry) {
    this.revision += 1;
    const log = { id: randomUUID(), ...entry };
    let index: number;
    if (this.size < this.maxEntries) {
      index = (this.start + this.size) % this.maxEntries;
      this.size += 1;
    } else {
      this.start = (this.start + 1) % this.maxEntries;
      index = (this.start + this.size - 1) % this.maxEntries;
    }
    this.entries[index] = { revision: this.revision, log };
  }

  list() {
    const result = new Array<RequestLog>(this.size);
    for (let offset = 0; offset < this.size; offset += 1)
      result[offset] = this.entryAt(this.size - 1 - offset).log;
    return result;
  }

  listSince(etag: string): RequestLogsDeltaResponse {
    const parsed = /^"([^"-]+(?:-[^"-]+)*)-(\d+)"$/.exec(etag);
    const since = parsed && parsed[1] === this.generation ? Number(parsed[2]) : undefined;

    if (since === undefined || !Number.isSafeInteger(since) || since < 0 || since > this.revision)
      return { logs: this.list(), reset: true };
    if (since === this.revision) return { logs: [], reset: false };

    const retained = this.retainedEntries();
    const oldestRevision = retained[0]?.revision;
    if (oldestRevision === undefined || oldestRevision > since + 1)
      return { logs: this.list(), reset: true };

    const logs = retained
      .filter((entry) => entry.revision > since)
      .reverse()
      .map((entry) => entry.log);
    return logs.length === this.revision - since
      ? { logs, reset: false }
      : { logs: this.list(), reset: true };
  }

  etag() {
    return `"${this.generation}-${this.revision}"`;
  }

  clear() {
    if (this.size === 0) return;
    this.entries.fill(undefined);
    this.start = 0;
    this.size = 0;
    this.revision += 1;
  }

  private entryAt(offset: number) {
    return this.entries[(this.start + offset) % this.maxEntries]!;
  }

  private retainedEntries() {
    const result = new Array<StoredEntry>(this.size);
    for (let offset = 0; offset < this.size; offset += 1) result[offset] = this.entryAt(offset);
    return result;
  }
}
