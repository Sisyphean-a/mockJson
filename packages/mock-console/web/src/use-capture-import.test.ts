import test from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { useMockState } from "./use-mock-state";
import { useCaptureImport } from "./use-capture-import";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import type { CaptureSaveResult, State } from "../../shared/types";

function setup() {
  const scope = effectScope();
  const state: State = { currentPackageId: "p", packages: [{ id: "p", name: "测试包", realServices: [], activeRealServiceId: null, apis: [] }] };
  const result: CaptureSaveResult = { packageId: "p", apiId: "a", scenarioId: "s", activated: false };
  const posts: unknown[] = [];
  let fail = false, failReveal = false, viewed = 0;
  let delay: (() => Promise<void>) | undefined;
  const transport: AdminTransport = { async send(url, init) {
    if (url.endsWith("/state")) return Response.json(state);
    if (init.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      await delay?.();
      return fail ? Response.json({ error: "保存失败" }, { status: 500 }) : Response.json(result);
    }
    return Response.json({ id: "ticket", expiresAt: Date.now() + 1000, request: { method: "POST", url: "https://api.test/users?token=1" }, response: { status: 201, body: '{"ok":true}' } });
  } };
  const client = new MockAdminClient(createRuntimeEndpoints({ protocol: "http:", port: "22333" }), transport);
  const model = scope.run(() => useMockState(client))!;
  model.state.value = state;
  const c = scope.run(() => useCaptureImport(client, model, async () => {
    if (failReveal) throw new Error("加载失败");
    viewed++;
  }))!;
  return { scope, state, model, c, posts, viewed: () => viewed, fail: (value: boolean) => { fail = value; }, failReveal: () => { failReveal = true; }, delay: (fn: () => Promise<void>) => { delay = fn; } };
}

test("交接预填 JSON、状态码和名称，默认只保存，完成后定位场景", async (t) => {
  const x = setup(); t.after(() => x.scope.stop());
  await x.c.readLocation("#capture=ticket");
  assert.equal(x.c.open.value, true);
  assert.equal(x.c.form.apiName, "POST /users");
  assert.equal(x.c.form.status, 201);
  assert.deepEqual(JSON.parse(x.c.form.responseBody), { ok: true });
  assert.equal(x.c.dirty.value, false);
  x.c.form.scenarioName = "错误";
  assert.equal(x.c.dirty.value, true);
  await x.c.save(false);
  assert.equal(x.posts.length, 1);
  assert.equal((x.posts[0] as { activate: boolean }).activate, false);
  assert.equal(x.viewed(), 1);
  assert.equal(x.c.open.value, false);
});

test("失败保留草稿并可重试，保存中不重复提交", async (t) => {
  const x = setup(); t.after(() => x.scope.stop());
  await x.c.readLocation("#capture=ticket");
  x.fail(true);
  await x.c.save(false);
  assert.equal(x.c.error.value, "保存失败");
  assert.ok(x.c.draft.value);
  x.fail(false);
  let release!: () => void;
  x.delay(() => new Promise<void>((resolve) => { release = resolve; }));
  const saving = x.c.save(true);
  await x.c.save(true);
  assert.equal(x.posts.length, 2);
  release(); await saving;
  assert.equal(x.c.error.value, "");
});

test("配置刷新失败区分已保存结果，重试定位不重复保存", async (t) => {
  const x = setup(); t.after(() => x.scope.stop());
  await x.c.readLocation("#capture=ticket");
  x.failReveal();
  await x.c.save(false);
  assert.match(x.c.error.value, /场景已保存/);
  assert.ok(x.c.saved.value);
  await x.c.save(false);
  await x.c.viewSaved();
  assert.equal(x.posts.length, 1);
});

test("条件分支接口只追加，不切换模式；测试包变化重置目标接口", async (t) => {
  const x = setup(); t.after(() => x.scope.stop());
  x.model.state.value.packages[0].apis.push({ id: "a", name: "条件接口", enabled: true, priority: 1, matchMode: "OR", matchRules: [], activeScenarioId: null, scenarios: [], responseSelection: { mode: "conditional", branches: [], fallback: { enabled: false, scenarioId: null } } });
  await x.c.readLocation("#capture=ticket");
  x.c.form.apiId = "a";
  await x.c.save(true);
  assert.match(x.c.error.value, /条件分支/);
  assert.equal(x.posts.length, 0);
  x.model.state.value.currentPackageId = null;
  assert.equal(x.c.form.apiId, "");
  await x.c.save(false);
  assert.match(x.c.error.value, /测试包/);
});
