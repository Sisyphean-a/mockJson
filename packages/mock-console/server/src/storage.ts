import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { PersistedState, State } from "../../shared/types.js";
import { isValidState } from "./validation.js";

const emptyState = (): State => ({ currentPackageId: null, packages: [] });

export class JsonFileRepository {
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}

  async read(): Promise<PersistedState> {
    const parse = async (file: string) => {
      const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!isValidState(value)) throw new Error("配置结构无效");
      return value;
    };
    try {
      return await parse(this.file);
    } catch (error) {
      try {
        const backup = await parse(this.file + ".bak");
        await fs.mkdir(dirname(this.file), { recursive: true });
        await fs.copyFile(this.file + ".bak", this.file);
        return backup;
      } catch (backupError) {
        if (isMissing(error) && isMissing(backupError)) return emptyState();
        throw new Error(`无法读取配置文件：${error instanceof Error ? error.message : "未知错误"}`);
      }
    }
  }

  async write(state: State, serializedState?: string) {
    if (!isValidState(state)) throw new Error("拒绝保存无效配置");
    const serialized = serializedState ?? JSON.stringify(state, null, 2);
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      const old = this.file + ".bak";
      try {
        const current: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
        if (isValidState(current)) await fs.copyFile(this.file, old);
      } catch {}
      await fs.writeFile(tmp, `${serialized}\n`);
      await fs.rename(tmp, this.file);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}

function isMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
