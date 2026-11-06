import test from "node:test";
import assert from "node:assert/strict";
import { effectScope, ref } from "vue";
import type { GlobalDelay, State } from "../../shared/types";
import { MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useGlobalDelay } from "./use-global-delay";

const endpoints = createRuntimeEndpoints({ protocol: "http:", port: "22333" });

function setup(initial: GlobalDelay, transport: AdminTransport) {
  const state = ref<State>({ currentPackageId: null, packages: [], globalDelay: initial });
  const client = new MockAdminClient(endpoints, transport);
  const scope = effectScope();
  const delay = scope.run(() => useGlobalDelay(client, state, () => {}))!;
  return { state, scope, delay };
}

test("打开弹窗复制当前全局延迟，保存后更新状态", async () => {
  const requests: Array<{ url: string; input: GlobalDelay }> = [];
  const transport: AdminTransport = {
    async send(url, init) {
      const input = JSON.parse(String(init.body)) as GlobalDelay;
      requests.push({ url, input });
      return Response.json(input);
    },
  };
  const { state, scope, delay } = setup({ mode: "fixed", fixedMs: 250, minMs: 200, maxMs: 800 }, transport);
  try {
    delay.openGlobalDelay();
    assert.equal(delay.showGlobalDelay.value, true);
    assert.deepEqual(delay.globalDelayDraft.value, { mode: "fixed", fixedMs: 250, minMs: 200, maxMs: 800 });

    delay.globalDelayDraft.value.mode = "random";
    delay.globalDelayDraft.value.minMs = 300;
    delay.globalDelayDraft.value.maxMs = 900;
    await delay.saveGlobalDelay();

    assert.equal(requests[0].url, "/__mock_admin/global-delay");
    assert.deepEqual(state.value.globalDelay, { mode: "random", fixedMs: 250, minMs: 300, maxMs: 900 });
    assert.equal(delay.showGlobalDelay.value, false);
    assert.equal(delay.globalDelayActive.value, true);
    assert.equal(delay.globalDelayLabel.value, "300–900ms");
  } finally {
    scope.stop();
  }
});

test("随机范围倒置时不发送保存请求", async () => {
  let requests = 0;
  const transport: AdminTransport = { async send() { requests += 1; return Response.json({}); } };
  const { scope, delay } = setup({ mode: "off", fixedMs: 500, minMs: 200, maxMs: 800 }, transport);
  try {
    delay.openGlobalDelay();
    delay.globalDelayDraft.value.mode = "random";
    delay.globalDelayDraft.value.minMs = 900;
    delay.globalDelayDraft.value.maxMs = 100;

    await delay.saveGlobalDelay();

    assert.equal(requests, 0);
    assert.match(delay.globalDelayError.value, /最小值/);
    assert.equal(delay.showGlobalDelay.value, true);
  } finally {
    scope.stop();
  }
});
