import type { TrafficEntry, TrafficPanelMessage, TrafficWindowMessage } from "./protocol.js";
import { isStoredTrafficEntry, isTrafficFinishMessage, isTrafficRequestBodyMessage, isTrafficStartMessage } from "./protocol.js";

const MAX_TRAFFIC_ENTRIES = 500;
const MAX_PERSISTED_TRAFFIC = 200;
const PERSISTED_BODY_LIMIT = 4096;
const TRAFFIC_PERSIST_DELAY_MS = 600;

type TrafficUpdate = Extract<TrafficPanelMessage, { type: "entry" | "cleared" }>;
type TrafficSource = Pick<TrafficEntry, "tabId" | "frameId" | "pageUrl">;

type TrafficStorage = {
  read(tabId: number): Promise<unknown>;
  write(tabId: number, entries: TrafficEntry[]): Promise<void>;
};

type TabTraffic = {
  entries: Map<string, TrafficEntry>;
  version: number;
  load?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
};

export class TabTrafficStore {
  private readonly tabs = new Map<number, TabTraffic>();
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: TrafficStorage,
    private readonly notify: (tabId: number, update: TrafficUpdate) => void,
  ) {}

  record(message: TrafficWindowMessage, source: TrafficSource) {
    const tab = this.getTab(source.tabId);
    const id = isTrafficStartMessage(message) ? message.entry.id : message.id;
    const key = `${source.frameId}:${id}`;
    let entry = tab.entries.get(key);
    if (isTrafficStartMessage(message)) {
      entry = { ...message.entry, ...source };
      tab.entries.set(key, entry);
      this.trim(tab);
    } else {
      if (!entry) return;
      if (isTrafficRequestBodyMessage(message)) {
        if (message.body !== undefined) {
          entry.request.body = message.body;
          delete entry.request.bodyUnavailable;
          if (message.bodyTruncated) entry.request.bodyTruncated = true;
          else delete entry.request.bodyTruncated;
        } else if (message.bodyUnavailable) {
          delete entry.request.body;
          entry.request.bodyUnavailable = message.bodyUnavailable;
          delete entry.request.bodyTruncated;
        }
      } else if (isTrafficFinishMessage(message)) {
        entry.decision = message.decision;
        entry.endedAt = message.endedAt;
        if (message.passReason) entry.passReason = message.passReason;
        if (message.response) entry.response = message.response;
        if (message.error) entry.error = message.error;
      }
    }
    this.notify(source.tabId, { type: "entry", entry });
    this.schedulePersist(source.tabId, tab);
  }

  async snapshot(tabId: number): Promise<TrafficEntry[]> {
    const tab = this.getTab(tabId);
    await tab.load;
    return this.tabs.get(tabId) === tab ? orderedEntries(tab) : [];
  }

  clear(tabId: number): Promise<void> {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      // Guarantee: 清空前尚未加载的标签页也不能再读回磁盘上的旧记录。
      tab = { entries: new Map(), version: 0 };
      this.tabs.set(tabId, tab);
    }
    tab.version += 1;
    clearTimeout(tab.timer);
    tab.timer = undefined;
    tab.entries.clear();
    const saved = this.write(tabId, []);
    this.notify(tabId, { type: "cleared" });
    return saved;
  }

  dropTab(tabId: number): Promise<void> {
    clearTimeout(this.tabs.get(tabId)?.timer);
    this.tabs.delete(tabId);
    return this.write(tabId, []);
  }

  private getTab(tabId: number): TabTraffic {
    let tab = this.tabs.get(tabId);
    if (!tab) {
      tab = { entries: new Map(), version: 0 };
      this.tabs.set(tabId, tab);
      tab.load = this.load(tabId, tab);
    }
    return tab;
  }

  private async load(tabId: number, tab: TabTraffic) {
    const version = tab.version;
    let raw: unknown;
    try {
      // Rule: 重建标签页状态前先等既有清空写入，不能复活已删除的会话快照。
      await this.writes;
      raw = await this.storage.read(tabId);
    } catch {
      // Failure: 会话恢复失败不影响页面请求和本轮新记录。
      return;
    }
    if (this.tabs.get(tabId) !== tab || tab.version !== version || !Array.isArray(raw)) return;
    let changed = false;
    for (const entry of raw) {
      if (!isStoredTrafficEntry(entry) || entry.tabId !== tabId) continue;
      const key = `${entry.frameId}:${entry.id}`;
      if (tab.entries.has(key)) continue;
      tab.entries.set(key, entry);
      changed = true;
    }
    if (!changed) return;
    this.trim(tab);
    for (const entry of tab.entries.values()) this.notify(tabId, { type: "entry", entry });
  }

  private trim(tab: TabTraffic) {
    if (tab.entries.size <= MAX_TRAFFIC_ENTRIES) return;
    const ordered = [...tab.entries].sort((a, b) => a[1].startedAt - b[1].startedAt);
    for (const [key] of ordered.slice(0, ordered.length - MAX_TRAFFIC_ENTRIES)) tab.entries.delete(key);
  }

  private schedulePersist(tabId: number, tab: TabTraffic) {
    if (tab.timer !== undefined) return;
    tab.timer = setTimeout(() => {
      tab.timer = undefined;
      if (this.tabs.get(tabId) !== tab) return;
      const entries = orderedEntries(tab).slice(-MAX_PERSISTED_TRAFFIC).map(toPersistedTraffic);
      void this.write(tabId, entries);
    }, TRAFFIC_PERSIST_DELAY_MS);
  }

  private write(tabId: number, entries: TrafficEntry[]) {
    // Guarantee: 旧快照和清空共用写队列；存储失败仅丢失观测副本，不影响页面请求。
    this.writes = this.writes.then(() => this.storage.write(tabId, entries)).catch(() => undefined);
    return this.writes;
  }
}

function orderedEntries(tab: TabTraffic) {
  return [...tab.entries.values()].sort((a, b) => a.startedAt - b.startedAt);
}

function toPersistedTraffic(entry: TrafficEntry): TrafficEntry {
  return {
    ...entry,
    request: truncateBody(entry.request),
    ...(entry.response ? { response: truncateBody(entry.response) } : {}),
  };
}

function truncateBody<T extends { body?: string; bodyTruncated?: boolean }>(value: T): T {
  return value.body !== undefined && value.body.length > PERSISTED_BODY_LIMIT
    ? { ...value, body: value.body.slice(0, PERSISTED_BODY_LIMIT), bodyTruncated: true }
    : { ...value };
}
