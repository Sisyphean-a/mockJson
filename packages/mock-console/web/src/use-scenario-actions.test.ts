import test from "node:test";
import assert from "node:assert/strict";
import { effectScope, nextTick } from "vue";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useConsoleForms } from "./use-console-forms";
import { useMockState } from "./use-mock-state";
import { useScenarioActions } from "./use-scenario-actions";
import type { State } from "../../shared/types";

async function setup() {
  const scope = effectScope();
  const state: State = { currentPackageId: "p", packages: [{ id: "p", name: "p", realServices: [], activeRealServiceId: null,
    apis: [{ id: "a", name: "a", enabled: true, priority: 0, matchMode: "AND", matchRules: [], activeScenarioId: null, scenarios: [] }] }] };
  const writes: { url: string; input: any }[] = [];
  const scenes = new Map<string, Record<string, unknown>>();
  let fail = false;
  let delay: (() => Promise<void>) | undefined;
  const transport: AdminTransport = { async send(url, init) {
    if (!init.body) return Response.json(state);
    const input = JSON.parse(String(init.body)); writes.push({ url, input });
    await delay?.();
    if (fail) return Response.json({ error: "保存失败" }, { status: 400 });
    const id = init.method === "PATCH" ? url.split("/").at(-1)! : `s${writes.length}`;
    const scene = { status: 200, delayMs: 0, responseBody: {}, ...scenes.get(id), ...input, id };
    scenes.set(id, scene);
    return Response.json(scene);
  } };
  const client = new MockAdminClient(createRuntimeEndpoints({ protocol: "http:", port: "22333" }), transport);
  const model = scope.run(() => useMockState(client))!;
  await model.load();
  const forms = scope.run(() => useConsoleForms())!;
  const actions = scope.run(() => useScenarioActions(client, model, forms, () => {}, () => true))!;
  return { scope, model, forms, actions, writes, fail: () => { fail = true; }, recover: () => { fail = false; }, delay: (f: () => Promise<void>) => { delay = f; } };
}

test("新建三类场景，不改变固定响应选择方式，复制保留类型和字段", async () => {
  const x = await setup();
  try {
    for (const type of ["mock", "real-overrides", "mock-with-real"] as const) {
      x.actions.openSceneCreate();
      assert.equal(x.forms.sceneResponseType.value, "mock");
      x.forms.sceneName.value = type;
      x.forms.sceneResponseType.value = type;
      x.forms.sceneFieldPaths.value = "/data/imageUrl\n";
      x.forms.sceneInitialBody.value = '{"data":{"imageUrl":"test"}}';
      await x.actions.createScene();
      const created = x.model.api.value!.scenarios.at(-1)!;
      assert.equal(created.responseType, type);
      assert.deepEqual(created.responseBody, { data: { imageUrl: "test" } });
      assert.deepEqual(created.fieldPaths, type === "mock" ? [] : ["/data/imageUrl"]);
      assert.equal(x.model.api.value!.activeScenarioId, x.model.api.value!.scenarios[0].id);
      assert.equal(x.model.api.value!.responseSelection, undefined);
      await nextTick();
    }
    const scene = x.model.api.value!.scenarios.at(-1)!;
    x.actions.openSceneEdit(scene);
    assert.equal(x.forms.sceneResponseType.value, "mock-with-real");
    assert.equal(x.forms.sceneFieldPaths.value, "/data/imageUrl");
    await x.actions.duplicateScene(scene);
    assert.equal(x.writes.at(-1)!.input.responseType, "mock-with-real");
    assert.deepEqual(x.writes.at(-1)!.input.fieldPaths, ["/data/imageUrl"]);
    assert.equal(x.writes.at(-1)!.input.activate, false);
  } finally { x.scope.stop(); }
});

test("创建与编辑在请求中保持忙碌，重复提交只写一次，失败保留输入并可重试", async () => {
  const x = await setup();
  let release = () => {};
  try {
    x.actions.openSceneCreate();
    x.forms.sceneName.value = "完整响应";
    x.forms.sceneInitialBody.value = '{"ok":true}';
    x.delay(() => new Promise<void>(resolve => { release = resolve; }));
    const creating = x.actions.createScene();
    assert.equal(x.forms.sceneSaving.value, true);
    await x.actions.createScene();
    assert.equal(x.writes.length, 1);
    release(); await creating; await nextTick();
    assert.equal(x.forms.sceneSaving.value, false);
    const scene = x.model.scene.value!;
    x.actions.openSceneEdit(scene);
    x.forms.editSceneName.value = "更新名称";
    x.fail();
    const saving = x.actions.saveScene();
    assert.equal(x.forms.sceneSaving.value, true);
    await x.actions.saveScene();
    assert.equal(x.writes.length, 2);
    release(); await saving;
    assert.equal(x.forms.sceneSaving.value, false);
    assert.equal(x.forms.showScene.value, true);
    assert.equal(x.forms.editSceneName.value, "更新名称");
    assert.equal(scene.name, "完整响应");
    x.recover();
    const retry = x.actions.saveScene();
    assert.equal(x.forms.sceneFormError.value, "");
    release(); await retry;
    assert.equal(x.forms.showScene.value, false);
    assert.equal(scene.name, "更新名称");
    assert.deepEqual(scene.responseBody, { ok: true });
    assert.equal(Object.hasOwn(x.writes.at(-1)!.input, "responseBody"), false);
  } finally { release(); x.scope.stop(); }
});

test("创建前校验名称与 JSON，校验失败后忙碌状态恢复", async () => {
  const x = await setup();
  try {
    x.actions.openSceneCreate();
    await x.actions.createScene();
    assert.match(x.forms.sceneFormError.value, /名称/);
    x.forms.sceneName.value = "场景";
    x.forms.sceneInitialBody.value = "{";
    await x.actions.createScene();
    assert.match(x.forms.sceneFormError.value, /JSON/);
    assert.equal(x.forms.sceneSaving.value, false);
    assert.equal(x.forms.sceneInitialBody.value, "{");
    assert.equal(x.writes.length, 0);
    x.forms.sceneInitialBody.value = "{}";
    assert.equal(x.forms.sceneFormError.value, "");
  } finally { x.scope.stop(); }
});

test("路径和 JSON 错误在弹窗中保留，服务拒绝保存也不关闭或修改生效场景", async () => {
  const x = await setup();
  try {
    x.actions.openSceneCreate();
    x.forms.sceneName.value = "图片";
    x.forms.sceneResponseType.value = "mock-with-real";
    await x.actions.createScene();
    assert.match(x.forms.sceneFormError.value, /至少指定/);
    assert.equal(x.writes.length, 0);
    x.forms.sceneFieldPaths.value = "/data/imageUrl";
    x.forms.sceneInitialBody.value = "{";
    await x.actions.createScene();
    assert.equal(x.writes.length, 0);
    x.forms.sceneInitialBody.value = '{"data":{}}';
    await x.actions.createScene();
    await nextTick();
    const scene = x.model.scene.value!;
    x.actions.openSceneEdit(scene);
    x.forms.sceneResponseType.value = "real-overrides";
    x.fail();
    await x.actions.saveScene();
    assert.equal(x.forms.showScene.value, true);
    assert.equal(x.forms.sceneFormError.value, "保存失败");
    assert.equal(scene.responseType, "mock-with-real");
  } finally { x.scope.stop(); }
});
