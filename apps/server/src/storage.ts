import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { State } from "./types.js";
export class JsonFileRepository {
  constructor(private readonly file: string) {}
  async read(): Promise<State> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return { currentPackageId: null, packages: [] };
    }
  }
  async write(state: State) {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    const old = this.file + ".bak";
    try {
      await fs.copyFile(this.file, old);
    } catch {}
    await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n");
    await fs.rename(tmp, this.file);
  }
}
