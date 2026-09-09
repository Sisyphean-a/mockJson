import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./content-main.ts", import.meta.url), "utf8");

test("MAIN world content script stays self-contained", () => {
  assert.doesNotMatch(source, /^import(?!\s+type\b)/m);
  assert.doesNotMatch(source, /^export\b/m);
});
