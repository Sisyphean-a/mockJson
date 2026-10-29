import test from "node:test";
import assert from "node:assert/strict";
import { effectScope } from "vue";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useMockState } from "./use-mock-state";
import { useConsoleForms } from "./use-console-forms";
import { useApiActions } from "./use-api-actions";
import type { State } from "../../shared/types";

test("控制台恢复已放行接口时发送启用动作，成功同步放行标记，失败保留状态", async () => {
  const state: State = { currentPackageId: "p", packages: [{ id: "p", name: "p", realServices: [], activeRealServiceId: null, apis: [{
    id: "a", name: "接口", enabled: true, passthrough: true, priority: 0, matchMode: "AND", matchRules: [],
    activeScenarioId: "s", scenarios: [{ id: "s", name: "场景", status: 200, delayMs: 0, responseBody: { ok: true } }],
  }] }] };
  const writes: unknown[] = [];
  let fail = true;
  const transport: AdminTransport = { async send(_url, init) {
    if (init.method !== "PATCH") return Response.json(state);
    writes.push(JSON.parse(String(init.body)));
    if (fail) return Response.json({ error: "保存失败" }, { status: 500 });
    return Response.json({ ...state.packages[0].apis[0], enabled: true, passthrough: false });
  } };
  const scope = effectScope();
  try {
    const client = new MockAdminClient(createRuntimeEndpoints({ protocol: "http:", port: "22333" }), transport);
    const model = scope.run(() => useMockState(client))!; await model.load();
    const forms = scope.run(() => useConsoleForms())!;
    const actions = scope.run(() => useApiActions(client, model, forms, () => {}, () => true))!;
    await actions.toggle(model.api.value!);
    assert.equal(model.api.value!.passthrough, true);
    fail = false;
    await actions.toggle(model.api.value!);
    assert.equal(model.api.value!.enabled, true);
    assert.equal(model.api.value!.passthrough, false);
    assert.deepEqual(writes, [{ enabled: true }, { enabled: true }]);
    assert.deepEqual(model.api.value!.scenarios[0].responseBody, { ok: true });
  } finally { scope.stop(); }
});
