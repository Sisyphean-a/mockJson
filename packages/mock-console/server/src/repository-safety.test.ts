import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");

function git(args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("运行态 Mock 配置被忽略且未被 Git 跟踪", (context) => {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    context.skip("当前环境不是 Git 工作区");
    return;
  }

  assert.equal(git(["ls-files", "--", "data/mock-data.json"]), "");
  assert.doesNotThrow(() => git(["check-ignore", "--no-index", "data/mock-data.json"]));
});
