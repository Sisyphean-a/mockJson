import { blockingIdentity, normalizeBlockingInput, type BlockingRule } from "./blocking-rules.js";

const DATABASE = "mock-console-request-blocking";
const STORE = "rules";

export class BlockingRuleStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory?: IDBFactory, private readonly databaseName = DATABASE) {}

  private open() {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = (this.factory ?? indexedDB).open(this.databaseName, 1);
        let blocked = false;
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("identity", "identity", { unique: true });
        };
        request.onerror = () => reject(request.error ?? new Error("无法打开屏蔽规则数据库"));
        request.onblocked = () => { blocked = true; reject(new Error("屏蔽规则数据库被其他页面占用，请关闭旧页面后重试")); };
        request.onsuccess = () => {
          const database = request.result;
          if (blocked) { database.close(); return; }
          database.onversionchange = () => { database.close(); this.database = undefined; };
          resolve(database);
        };
      }).catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }

  async list(): Promise<BlockingRule[]> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).getAll();
      transaction.oncomplete = () => {
        try {
          resolve(request.result.map((value: unknown) => {
            const stored = value as BlockingRule;
            if (typeof stored.id !== "string" || typeof stored.revision !== "string") throw new Error("已保存的屏蔽规则损坏");
            return { ...normalizeBlockingInput(stored), id: stored.id, revision: stored.revision };
          }));
        } catch (error) { reject(error); }
      };
      transaction.onabort = () => reject(transaction.error ?? new Error("读取屏蔽规则失败"));
    });
  }

  async save(input: unknown, id?: string, expectedRevision?: string): Promise<void> {
    const normalized = normalizeBlockingInput(input);
    return this.mutate(id, expectedRevision, (store, currentId) => {
      store.put({ ...normalized, id: currentId, revision: crypto.randomUUID(), identity: blockingIdentity(normalized) });
    });
  }

  async delete(id: string, expectedRevision: string): Promise<void> {
    return this.mutate(id, expectedRevision, (store, currentId) => { store.delete(currentId); });
  }

  private async mutate(id: string | undefined, expectedRevision: string | undefined, change: (store: IDBObjectStore, id: string) => void) {
    if (id !== undefined && (!id || !expectedRevision)) throw new Error("规则版本无效");
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure: Error | undefined;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? new Error(transaction.error?.name === "ConstraintError"
        ? "已存在相同的屏蔽规则，请编辑原规则" : `保存屏蔽规则失败：${transaction.error?.message ?? "事务已中止"}`));
      if (!id) { change(store, crypto.randomUUID()); return; }
      const read = store.get(id);
      read.onsuccess = () => {
        if (!read.result || read.result.revision !== expectedRevision) {
          failure = new Error("规则已在其他页面修改或删除，请重新选择后再操作");
          transaction.abort();
          return;
        }
        change(store, id);
      };
    });
  }

  async close() {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
