import test from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useMockState } from "./use-mock-state";
import { useConsoleForms } from "./use-console-forms";
import { useApiGroupActions } from "./use-api-group-actions";
import type { State } from "../../shared/types";

function bootstrap(state: State, transport: AdminTransport) {
  const scope = effectScope();
  const client = new MockAdminClient(createRuntimeEndpoints({ protocol: "http:", port: "22333" }), transport);
  const model = scope.run(() => useMockState(client))!;
  const forms = scope.run(() => useConsoleForms())!;
  const actions = scope.run(() => useApiGroupActions(client, model, forms, () => {}))!;
  return { scope, model, forms, actions };
}

test("新建与删除分组同步本地模型，删除只解除成员归属", async () => {
  const state: State = { currentPackageId: "p", packages: [{
    id: "p", name: "p", realServices: [], activeRealServiceId: null,
    apiGroups: [{ id: "g", name: "结算" }],
    apis: [{ id: "a", name: "接口", enabled: true, groupId: "g", priority: 0, matchMode: "OR", matchRules: [], activeScenarioId: null, scenarios: [] }],
  }] };
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const transport: AdminTransport = { async send(url, init) {
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ url, body });
      return Response.json({ id: `new-${posts.length}`, name: body.name });
    }
    if (init.method === "DELETE") return Response.json({ success: true });
    return Response.json(state);
  } };
  const { scope, model, forms, actions } = bootstrap(state, transport);
  try {
    await model.load();
    const group = model.pkg.value!.apiGroups[0];

    forms.apiGroupName.value = "借款";
    await actions.saveApiGroup();
    assert.deepEqual(model.pkg.value!.apiGroups.map((item) => item.name), ["结算", "借款"]);
    assert.equal(forms.showApiGroup.value, false);

    // 有成员的分组先弹窗，确认后才删除并解除归属。
    await actions.deleteApiGroupTarget(group);
    assert.equal(forms.showApiGroupDelete.value, true);
    assert.equal(forms.apiGroupDeleteId.value, group.id);
    assert.deepEqual(model.pkg.value!.apiGroups.map((item) => item.name), ["结算", "借款"]);
    await actions.confirmApiGroupDelete();
    assert.equal(forms.showApiGroupDelete.value, false);
    assert.deepEqual(model.pkg.value!.apiGroups.map((item) => item.name), ["借款"]);
    assert.equal(model.pkg.value!.apis[0].groupId ?? null, null);
    assert.equal(model.pkg.value!.apis[0].scenarios.length, 0);
    assert.equal((posts[0].body as { name: string }).name, "借款");

    // 空分组直接删除，不再弹窗。
    const empty = model.pkg.value!.apiGroups[0];
    await actions.deleteApiGroupTarget(empty);
    assert.equal(forms.showApiGroupDelete.value, false);
    assert.deepEqual(model.pkg.value!.apiGroups, []);
  } finally {
    scope.stop();
  }
});

test("分组排序乐观生效，保存失败时回滚到原顺序", async () => {
  const first = { id: "g1", name: "一" };
  const second = { id: "g2", name: "二" };
  const state: State = { currentPackageId: "p", packages: [{
    id: "p", name: "p", realServices: [], activeRealServiceId: null, apiGroups: [first, second], apis: [],
  }] };
  let fail = true;
  const transport: AdminTransport = { async send(_url, init) {
    if (init.method === "PUT") {
      if (fail) return Response.json({ error: "保存失败" }, { status: 500 });
      const { ids } = JSON.parse(String(init.body)) as { ids: string[] };
      return Response.json(ids.map((id) => ({ id, name: id === "g1" ? "一" : "二" })));
    }
    return Response.json(state);
  } };
  const { scope, model, actions } = bootstrap(state, transport);
  try {
    await model.load();
    await actions.reorderApiGroups(["g2", "g1"], ["g1", "g2"]);
    assert.deepEqual(model.pkg.value!.apiGroups.map((item) => item.id), ["g1", "g2"]);

    fail = false;
    await actions.reorderApiGroups(["g2", "g1"], ["g1", "g2"]);
    assert.deepEqual(model.pkg.value!.apiGroups.map((item) => item.id), ["g2", "g1"]);
  } finally { scope.stop(); }
});

test("拖拽归属通过 updateApi 保存，失败回滚到原分组", async () => {
  const state: State = { currentPackageId: "p", packages: [{
    id: "p", name: "p", realServices: [], activeRealServiceId: null,
    apiGroups: [{ id: "g", name: "结算" }],
    apis: [{ id: "a", name: "接口", enabled: true, priority: 0, matchMode: "OR", matchRules: [], activeScenarioId: null, scenarios: [] }],
  }] };
  const writes: Array<Record<string, unknown>> = [];
  let fail = true;
  const transport: AdminTransport = { async send(_url, init) {
    if (init.method === "PATCH") {
      writes.push(JSON.parse(String(init.body)));
      if (fail) return Response.json({ error: "保存失败" }, { status: 500 });
      return Response.json({ ...state.packages[0].apis[0], groupId: (writes.at(-1) as { groupId: string }).groupId });
    }
    return Response.json(state);
  } };
  const { scope, model, actions } = bootstrap(state, transport);
  try {
    await model.load();
    const api = model.pkg.value!.apis[0];
    await actions.setApiGroup(api, "g");
    assert.equal(api.groupId ?? null, null);

    fail = false;
    await actions.setApiGroup(api, "g");
    assert.equal(api.groupId, "g");
    assert.deepEqual(writes, [{ groupId: "g" }, { groupId: "g" }]);
  } finally { scope.stop(); }
});
