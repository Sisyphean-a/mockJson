import { randomUUID } from "node:crypto";
import { MAX_REQUEST_LOGS } from "../../shared/types.js";
import type { RequestLog, RequestLogsDeltaResponse } from "../../shared/types.js";

export { MAX_REQUEST_LOGS } from "../../shared/types.js";

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
