import { randomUUID } from "node:crypto";
import type { RequestLog } from "../../shared/types.js";

export const MAX_REQUEST_LOGS = 200;

type RequestLogEntry = Omit<RequestLog, "id">;

export class RequestLogStore {
  private readonly entries: RequestLog[] = [];
  private readonly generation = randomUUID();
  private revision = 0;

  constructor(private readonly maxEntries = MAX_REQUEST_LOGS) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error("日志数量上限必须是正整数");
  }

  record(entry: RequestLogEntry) {
    this.entries.unshift({ id: randomUUID(), ...entry });
    if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries;
    this.revision += 1;
  }

  list() {
    return this.entries.slice();
  }

  etag() {
    return `"${this.generation}-${this.revision}"`;
  }

  clear() {
    if (this.entries.length === 0) return;
    this.entries.length = 0;
    this.revision += 1;
  }
}
