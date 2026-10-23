import test from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useMockState } from "./use-mock-state";
import { useResponseSelection } from "./use-response-selection";
import { useApiActions } from "./use-api-actions";
import { useConsoleForms } from "./use-console-forms";
import type { State } from "../../shared/types";

async function setup() {
  const scope = effectScope();
  const state: State = { currentPackageId: "p", packages: [{ id: "p", name: "p", realServices: [], activeRealServiceId: null, apis: ["a", "b"].map((id) => ({ id, name: id, enabled: true, priority: 10, matchMode: "OR", matchRules: [], activeScenarioId: `${id}-first`, scenarios: [{ id: `${id}-first`, name: "默认", status: 200, delayMs: 0, responseBody: {} }, { id: `${id}-second`, name: "空白", status: 200, delayMs: 0, responseBody: {} }] })) }] };
  let calls = 0, fail = false;
  let delay: (() => Promise<void>) | undefined;
  const transport: AdminTransport = { async send(url, init) {
    calls++;
    if (init.method === "PUT") {
      await delay?.();
      if (fail) return new Response('{"error":"保存失败"}', { status: 500 });
      const input = JSON.parse(String(init.body));
      const api = state.packages[0].apis.find((a) => url.includes(`/apis/${a.id}/`))!;
      api.responseSelection = input.selection; api.activeScenarioId = input.activeScenarioId;
      return Response.json(api);
    }
    return Response.json(state);
  } };
  const client = new MockAdminClient(createRuntimeEndpoints({ protocol: "http:", port: "22333" }), transport);
  const model = scope.run(() => useMockState(client))!; await model.load();
  const c = scope.run(() => useResponseSelection(client, model))!;
  return { scope, client, model, c, state, calls: () => calls, fail: () => { fail = true; }, delay: (f: () => Promise<void>) => { delay = f; } };
}

test("切换响应工作区不制造未保存状态、不弹窗，也不改变生效配置", async () => {
  const x = await setup();
  try {
    const calls = x.calls();
    x.c.setResponseMode("conditional");
    assert.equal(x.c.responseDirty.value, false);
    assert.equal(x.c.responseEditorMode.value, "conditional");
    assert.equal(x.c.responseModeInactive.value, true);
    assert.equal(x.c.leavePrompt.value, false);
    x.c.runTrial();
    assert.equal(x.c.trialResult.value?.action, "fallback");
    assert.equal(x.c.trialSelection.value?.mode, "conditional");
    let navigated = false;
    assert.equal(x.c.guardResponseLeave(() => { navigated = true; }), true);
    assert.equal(navigated, true);
    x.c.setResponseMode("fixed");
    assert.equal(x.c.responseDirty.value, false);
    assert.equal(x.c.leavePrompt.value, false);
    assert.equal(x.calls(), calls);
    assert.equal(Object.hasOwn(x.model.api.value!, "responseSelection"), false);
    x.c.setResponseMode("conditional");
    assert.equal(await x.c.saveResponseSelection(), true);
    x.c.setResponseMode("fixed"); x.c.setResponseMode("conditional");
    assert.equal(x.c.responseDirty.value, false);
    assert.equal(x.c.leavePrompt.value, false);
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional");
  } finally { x.scope.stop(); }
});

test("新分支默认任一条件和 JSON 请求体，模式往返保留两边的实际修改", async () => {
  const x = await setup();
  try {
    x.c.setResponseMode("conditional"); x.c.addBranch();
    const branch = x.c.responseDraft.value.selection.branches[0];
    assert.equal(branch.matchMode, "OR");
    assert.equal(branch.conditions[0].source, "body");
    assert.equal(x.c.newCondition().source, "body");
    branch.matchMode = "AND"; branch.conditions[0].source = "header";
    branch.conditions[0].field = "X-Mode"; branch.conditions[0].value = "yes"; branch.scenarioId = "a-second";
    x.c.setResponseMode("fixed");
    x.c.responseDraft.value.activeScenarioId = null;
    x.c.setResponseMode("conditional");
    assert.equal(x.c.leavePrompt.value, false);
    assert.equal(branch.matchMode, "AND"); assert.equal(branch.conditions[0].source, "header");
    assert.equal(x.c.responseDraft.value.activeScenarioId, null);
    assert.equal(x.c.responseDirty.value, true);
    assert.equal(x.c.guardResponseLeave(() => {}), false);
    assert.equal(x.c.leavePrompt.value, true);
    await x.c.resolveResponseLeave("cancel");
    assert.equal(await x.c.saveResponseSelection(), true);
    x.c.setResponseMode("fixed"); x.c.setResponseMode("conditional");
    assert.equal(x.model.api.value?.responseSelection?.branches[0].matchMode, "AND");
    assert.equal(x.model.api.value?.responseSelection?.branches[0].conditions[0].source, "header");
    assert.equal(x.c.responseDirty.value, false);
  } finally { x.scope.stop(); }
});

test("仅启用模式失败时保持原行为和可重试状态，不制造配置脏状态", async () => {
  const x = await setup();
  try {
    x.c.setResponseMode("conditional"); x.fail();
    assert.equal(await x.c.saveResponseSelection(), false);
    assert.equal(x.c.responseDirty.value, false);
    assert.equal(x.c.responseModeInactive.value, true);
    assert.equal(x.c.responseEditorMode.value, "conditional");
    assert.equal(x.c.responseSaving.value, false);
    assert.match(x.c.responseError.value, /保存失败/);
    assert.equal(Object.hasOwn(x.model.api.value!, "responseSelection"), false);
    assert.equal(x.c.guardResponseLeave(() => {}), true);
  } finally { x.scope.stop(); }
});

test("首次进入分支只预填草稿兜底，模式与固定选择保存后生效，往返模式保留分支", async () => {
  const x = await setup();
  try {
    assert.equal(x.c.responseDirty.value, false);
    assert.deepEqual(x.c.responseReferences(x.model.scene.value!), []);
    x.c.setResponseMode("conditional");
    assert.equal(x.c.responseDraft.value.selection.fallback.scenarioId, "a-first");
    assert.equal(x.c.responseDirty.value, false); assert.equal(Object.hasOwn(x.model.api.value!, "responseSelection"), false);
    x.c.addBranch();
    const branch = x.c.responseDraft.value.selection.branches[0]; branch.name = "按标记"; branch.scenarioId = "a-second";
    branch.conditions[0].source = "header"; branch.conditions[0].field = "X-Mode"; branch.conditions[0].value = "empty";
    assert.equal(await x.c.saveResponseSelection(), true);
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional"); assert.equal(x.c.responseDirty.value, false);
    x.c.setResponseMode("fixed"); x.c.responseDraft.value.activeScenarioId = null;
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional");
    assert.equal(await x.c.saveResponseSelection(), true);
    assert.equal(x.model.api.value?.activeScenarioId, null);
    x.c.setResponseMode("conditional"); assert.equal(x.c.responseDraft.value.selection.branches[0].name, "按标记");
  } finally { x.scope.stop(); }
});

test("试算无网络副作用，首命中后未执行；条件/顺序/兜底和输入变化标记过期", async () => {
  const x = await setup();
  try {
    x.c.setResponseMode("conditional");
    for (let i = 0; i < 2; i++) { x.c.addBranch(); const b = x.c.responseDraft.value.selection.branches[i]; b.scenarioId = `a-${i === 0 ? 'first' : 'second'}`; b.conditions[0].source = "header"; b.conditions[0].field = "X"; b.conditions[0].value = "yes"; }
    x.c.trialHeaders.value = '{"x":"yes"}';
    const calls = x.calls(); x.c.runTrial(); assert.equal(x.calls(), calls);
    assert.equal(x.c.trialResult.value?.branches[1].status, "skipped");
    assert.equal(x.c.trialResult.value?.scenarioId, "a-first");
    x.c.moveBranch(1, -1); assert.equal(x.c.trialStale.value, true);
    x.c.runTrial(); assert.equal(x.c.trialResult.value?.scenarioId, "a-second"); assert.equal(x.c.trialStale.value, false);
    x.c.responseDraft.value.selection.fallback.enabled = false; assert.equal(x.c.trialStale.value, true); x.c.runTrial();
    x.c.trialBody.value = "bad JSON"; assert.equal(x.c.trialStale.value, true);
    x.c.trialHeaders.value = "[]"; x.c.runTrial(); assert.match(x.c.trialError.value, /请求头/);
  } finally { x.scope.stop(); }
});

test("离开草稿可取消/放弃/保存；保存失败不切换接口，字段错误保留原输入", async () => {
  const x = await setup();
  try {
    x.c.setResponseMode("conditional");
    x.c.responseDraft.value.selection.fallback.enabled = false;
    const navigate = () => x.model.selectApi(x.model.pkg.value!.apis[1]);
    assert.equal(x.c.guardResponseLeave(navigate), false);
    await x.c.resolveResponseLeave("cancel"); assert.equal(x.model.api.value?.id, "a"); assert.equal(x.c.responseDirty.value, true);
    x.c.guardResponseLeave(navigate); x.fail(); await x.c.resolveResponseLeave("save");
    assert.equal(x.model.api.value?.id, "a"); assert.equal(x.c.leavePrompt.value, true); assert.match(x.c.responseError.value, /保存失败/);
    await x.c.resolveResponseLeave("discard"); assert.equal(x.model.api.value?.id, "b"); assert.equal(x.c.responseDirty.value, false);
    x.c.setResponseMode("conditional"); x.c.addBranch();
    assert.equal(await x.c.saveResponseSelection(), false); assert.match(x.c.responseError.value, /目标场景/); assert.equal(x.c.responseDraft.value.selection.branches[0].name, "新分支");
  } finally { x.scope.stop(); }
});

test("无效数字不会被当成已保存的 null，保留草稿并在条件旁报告错误", async () => {
  const x = await setup();
  try {
    x.c.setResponseMode("conditional"); x.c.addBranch();
    const branch = x.c.responseDraft.value.selection.branches[0]; branch.scenarioId = "a-second";
    Object.assign(branch.conditions[0], { source: "body", field: "/value", value: null });
    assert.equal(await x.c.saveResponseSelection(), true);
    x.c.responseDraft.value.selection.branches[0].conditions[0].value = NaN;
    assert.equal(x.c.responseDirty.value, true);
    assert.equal(await x.c.saveResponseSelection(), false);
    assert.match(x.c.responseError.value, /有效数字/);
    assert.equal(x.c.responseErrorPath.value, "branches.0.conditions.0");
  } finally { x.scope.stop(); }
});

test("并发接口元数据更新和迟到响应不覆盖已保存的响应选择", async () => {
  const x = await setup();
  try {
    const staleApi = JSON.parse(JSON.stringify(x.model.api.value!));
    let release!: () => void;
    const waiting = new Promise<void>((r) => { release = r; }); x.delay(() => waiting);
    x.c.setResponseMode("conditional");
    const saving = x.c.saveResponseSelection();
    x.model.replaceApi({ ...staleApi, name: "保存中的元数据更新" });
    release(); await saving;
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional");
    x.model.replaceApi({ ...staleApi, name: "迟到的元数据响应" });
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional");
    assert.equal(x.model.api.value?.name, "迟到的元数据响应");
  } finally { x.scope.stop(); }
});

test("迟到的接口排序结果只改变顺序，不覆盖已保存的响应配置", async () => {
  const x = await setup();
  try {
    let release!: () => void;
    const waiting = new Promise<void>((r) => { release = r; });
    const staleApis = JSON.parse(JSON.stringify(x.model.pkg.value!.apis));
    x.client.reorderApis = async () => { await waiting; return [staleApis[1], staleApis[0]]; };
    const actions = x.scope.run(() => useApiActions(x.client, x.model, useConsoleForms(), () => {}, () => true))!;
    const sorting = actions.reorderApis(["b", "a"], ["a", "b"]);
    x.c.setResponseMode("conditional"); assert.equal(await x.c.saveResponseSelection(), true);
    release(); await sorting;
    assert.deepEqual(x.model.pkg.value!.apis.map((a) => a.id), ["b", "a"]);
    assert.equal(x.model.api.value?.responseSelection?.mode, "conditional");
  } finally { x.scope.stop(); }
});

test("保存中禁用重复提交和导航，成功前实际配置不变", async () => {
  const x = await setup();
  try {
    let release!: () => void;
    const wait = new Promise<void>((r) => { release = r; }); x.delay(() => wait);
    x.c.setResponseMode("conditional"); const saving = x.c.saveResponseSelection();
    assert.equal(x.c.responseSaving.value, true); assert.equal(Object.hasOwn(x.model.api.value!, "responseSelection"), false);
    assert.equal(await x.c.saveResponseSelection(), false);
    let navigated = false; assert.equal(x.c.guardResponseLeave(() => { navigated = true; }), false); assert.equal(navigated, false);
    release(); assert.equal(await saving, true); assert.equal(x.c.responseDirty.value, false);
  } finally { x.scope.stop(); }
});
