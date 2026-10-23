import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSelection, validateSelection } from "../../shared/response-selection.js";
import type { LogicalApi, ResponseCondition, ResponseSelection, State } from "../../shared/types.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";

const condition = (props: Partial<ResponseCondition> = {}): ResponseCondition => ({ id: "c", source: "body", field: "/user/state", operator: "equals", value: true, ...props });
const selection = (conditions = [condition()]): ResponseSelection => ({ mode: "conditional", branches: [{ id: "b", name: "已认证", matchMode: "AND", conditions, scenarioId: "yes" }], fallback: { enabled: true, scenarioId: "default" } });
const request = (body?: string) => ({ headers: { "X-MODE": "empty" }, body });

test("条件保留类型、嵌套/数组/转义字段及空值，缺失不命中不等于", () => {
  const cases: [Partial<ResponseCondition>, string, boolean][] = [
    [{}, '{"user":{"state":true}}', true], [{ value: "true" }, '{"user":{"state":true}}', false],
    [{ field: "/items/0/a~1b/~0", value: null }, '{"items":[{"a/b":{"~":null}}]}', true],
    [{ operator: "exists" }, '{"user":{"state":null}}', true],
    [{ field: "/items/length", operator: "notExists" }, '{"items":[]}', true],
    [{ field: "/constructor", operator: "notExists" }, '{}', true],
    [{ operator: "notExists" }, '{}', true], [{ operator: "notEquals", value: false }, '{}', false],
    [{ value: 2 }, '{"user":{"state":"2"}}', false],
    [{ operator: "gt", value: 2 }, '{"user":{"state":3}}', true],
    [{ operator: "gt", value: 2 }, '{"user":{"state":"3"}}', false],
    [{ operator: "contains", value: "a" }, '{"user":{"state":"abc"}}', true],
  ];
  for (const [c, body, matched] of cases) assert.equal(evaluateSelection(selection([condition(c)]), null, request(body)).action === "branch", matched);
});

test("无效、不可读取和缺失分别说明；OR 的请求头仍可命中；首命中停止", () => {
  const s = selection([condition({ operator: "notExists" }), condition({ id: "h", source: "header", field: "x-mode", value: "empty" })]);
  for (const req of [request("bad json"), request(), { ...request(), bodyUnavailable: "upload" }]) {
    const miss = evaluateSelection(s, null, req);
    assert.equal(miss.action, "fallback");
    assert.match(miss.branches[0].conditions[0].reason, /JSON|无法取得|不可读取/);
    s.branches[0].matchMode = "OR";
    s.branches.push({ ...s.branches[0], id: "later" });
    const hit = evaluateSelection(s, null, req);
    assert.equal(hit.action, "branch");
    assert.equal(hit.branches[1].status, "skipped");
    s.branches.pop(); s.branches[0].matchMode = "AND";
  }
  s.branches = []; s.fallback.enabled = false;
  assert.equal(evaluateSelection(s, null, request()).action, "pass");
});

test("配置拒绝空条件、悬空引用、无效操作符及错误值类型", () => {
  assert.doesNotThrow(() => validateSelection(selection(), ["yes", "default"]));
  for (const change of [
    (s: ResponseSelection) => { s.branches[0].conditions = []; },
    (s: ResponseSelection) => { s.branches[0].scenarioId = "foreign"; },
    (s: ResponseSelection) => { s.fallback.scenarioId = null; },
    (s: ResponseSelection) => { s.branches[0].conditions[0].operator = "gt"; },
    (s: ResponseSelection) => { s.branches[0].conditions[0].field = "a.b"; },
  ]) { const s = selection(); change(s); assert.throws(() => validateSelection(s, ["yes", "default"])); }
});

function api(id: string, priority: number): LogicalApi {
  return { id, name: id, enabled: true, priority, matchMode: "AND", matchRules: [{ id: "r", source: "url", field: "path", operator: "equals", value: "/test" }], activeScenarioId: "default", scenarios: ["yes", "default"].map((id) => ({ id, name: id, status: 200, delayMs: 0, responseBody: { id } })) };
}

test("resolver 按分支选择，未命中放行不串到较低优先级接口；旧配置不变", () => {
  const high = api("high", 20); const low = api("low", 10);
  high.responseSelection = selection(); high.responseSelection.fallback.enabled = false;
  const state: State = { currentPackageId: "p", packages: [{ id: "p", name: "p", realServices: [], activeRealServiceId: null, apis: [high, low] }] };
  const req = { url: "https://example.com/test", method: "POST", headers: {}, body: '{"user":{"state":true}}' };
  const hit = resolveExtensionRequest(state, req);
  assert.equal(hit.action, "mock"); if (hit.action === "mock") assert.equal(hit.body, '{"id":"yes"}');
  assert.equal(resolveExtensionRequest(state, { ...req, body: "{}" }).action, "pass");
  high.enabled = false;
  assert.equal(resolveExtensionRequest(state, req).action, "mock");
  high.enabled = true; delete high.responseSelection;
  const old = resolveExtensionRequest(state, req); if (old.action === "mock") assert.equal(old.body, '{"id":"default"}');
});
