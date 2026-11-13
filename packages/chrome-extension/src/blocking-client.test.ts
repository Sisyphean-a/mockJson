import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { RequestBlockingClient } from "./blocking-client.js";
import { blockingDraft, type BlockingRule } from "./blocking-rules.js";

const input = blockingDraft({ pageUrl: "https://app.test", request: { url: "http://localhost:3000/api/logs", method: "POST" } });

function harness(t: TestContext) {
  const sent: any[] = [];
  const states: BlockingRule[][] = [];
  const errors: string[] = [];
  let receive!: (value: unknown) => void;
  let disconnect!: () => void;
  const old = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: { runtime: { connect() { return {
    postMessage(value: unknown) { sent.push(value); }, disconnect() { disconnect(); },
    onMessage: { addListener(listener: typeof receive) { receive = listener; } },
    onDisconnect: { addListener(listener: typeof disconnect) { disconnect = listener; } },
  }; } } } });
  const client = new RequestBlockingClient(rules => states.push(rules), message => errors.push(message));
  t.after(() => { client.close(); if (old) Object.defineProperty(globalThis, "chrome", old); else Reflect.deleteProperty(globalThis, "chrome"); });
  return { client, sent, states, errors, receive: (value: unknown) => receive(value), disconnect: () => disconnect() };
}

test("规则未加载时不能保存，提交仅在后台确认后成功，写入错误原样报告", async t => {
  const h = harness(t);
  await assert.rejects(h.client.save(input), /尚未读取/);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, "subscribe");
  h.receive({ type: "state", rules: [] });
  const result = h.client.save(input);
  const command = h.sent.at(-1);
  assert.equal(command.type, "save");
  const failed = assert.rejects(result, /磁盘已满/);
  h.receive({ type: "result", requestId: command.requestId, ok: false, error: "磁盘已满" });
  await failed;
  assert.deepEqual(h.states, [[]]);
  const saved = h.client.save(input);
  h.receive({ type: "result", requestId: h.sent.at(-1).requestId, ok: true });
  await saved;
});

test("断连使未确认写入明确失败，不自动重试写操作，销毁释放重连计时器", async t => {
  const h = harness(t);
  h.receive({ type: "state", rules: [] });
  const result = h.client.save(input);
  const failed = assert.rejects(result, /操作结果未确认/);
  h.disconnect();
  await failed;
  assert.equal(h.sent.filter(message => message.type === "save").length, 1);
  assert.match(h.errors[0], /正在重新连接/);
  h.client.close();
  await assert.rejects(h.client.save(input), /尚未读取/);
});
