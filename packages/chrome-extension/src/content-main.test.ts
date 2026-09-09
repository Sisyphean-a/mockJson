import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESOLVE_TIMEOUT_MS } from "./protocol.js";

const source = readFileSync(new URL("./content-main.ts", import.meta.url), "utf8");

test("MAIN world content script stays self-contained", () => {
  assert.doesNotMatch(source, /^import(?!\s+type\b)/m);
  assert.doesNotMatch(source, /^export\b/m);
});

test("resolver timeout and invalid responses fail open without an unhandled action access", () => {
  assert.equal(RESOLVE_TIMEOUT_MS, 1000);
  assert.match(source, /const CONTENT_RESOLVE_TIMEOUT_MS = 1200/);
  assert.match(source, /resolve\(isRuntimeResponse\(result\)/);
  assert.match(source, /\.catch\(\(\) =>/);
});
