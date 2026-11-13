import test from "node:test";
import assert from "node:assert/strict";
import { blockingDraft, compileBlockingRules, normalizeBlockingInput, type BlockingRule } from "./blocking-rules.js";

const entry = { pageUrl: "https://app.test/page", request: { method: "POST", url: "http://localhost:3000/api/logs?time=1#part" } };
const rule = (input = {}): BlockingRule => ({ ...blockingDraft(entry), ...input, id: "one", revision: "v1" });
const isBlocked = (rules: BlockingRule[], request: typeof entry) => compileBlockingRules(rules)(request);

test("精确屏蔽忽略参数与片段，同站点其他页面生效，不跨站点、端口、方法或路径", () => {
  const rules = [rule()];
  assert.equal(isBlocked(rules, entry), true);
  assert.equal(isBlocked(rules, { ...entry, pageUrl: "https://app.test/another", request: { ...entry.request, url: "http://localhost:3000/api/logs?time=2" } }), true);
  for (const pageUrl of ["http://app.test/page", "https://child.app.test/page", "https://app.test:444/page", "https://other.test/page"]) assert.equal(isBlocked(rules, { ...entry, pageUrl }), false);
  for (const url of ["http://localhost:3001/api/logs", "https://localhost:3000/api/logs", "http://127.0.0.1:3000/api/logs", "http://localhost:3000/api/logs/", "http://localhost:3000/api/logs2"]) assert.equal(isBlocked(rules, { ...entry, request: { ...entry.request, url } }), false);
  assert.equal(isBlocked(rules, { ...entry, request: { ...entry.request, method: "GET" } }), false);
});

test("全站点、全部方法、字面路径前缀和停用规则", () => {
  const rules = [rule({ scopeOrigin: "*", method: "*", matchMode: "prefix" })];
  assert.equal(isBlocked(rules, { pageUrl: "https://other.test", request: { method: "GET", url: "http://localhost:3000/api/logs/events" } }), true);
  assert.equal(isBlocked([rule({ enabled: false })], entry), false);
  assert.equal(isBlocked(rules, { ...entry, pageUrl: "invalid" }), false);
  assert.equal(isBlocked(rules, { ...entry, request: { ...entry.request, url: "data:text/plain,x" } }), false);
});

test("预填规则规范化站点、方法和目标地址，拒绝无效或携带凭证的 URL", () => {
  assert.deepEqual(blockingDraft(entry), { enabled: true, scopeOrigin: "https://app.test", method: "POST", targetUrl: "http://localhost:3000/api/logs", matchMode: "exact" });
  assert.equal(normalizeBlockingInput({ ...rule(), method: " post " }).method, "POST");
  for (const input of [null, {}, { ...rule(), enabled: "true" }, { ...rule(), method: "GET\nPOST" }, { ...rule(), matchMode: "regex" }, { ...rule(), scopeOrigin: "chrome-extension://abc" }, { ...rule(), targetUrl: "http://user:secret@localhost/api/logs" }]) assert.throws(() => normalizeBlockingInput(input));
});
