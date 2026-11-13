import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { registerRequestBlocking } from "./blocking-service.js";
import { BlockingRuleStore } from "./blocking-store.js";
import { BLOCKING_PORT, blockingDraft } from "./blocking-rules.js";

const base = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";
const input = blockingDraft({ pageUrl: "https://app.test", request: { url: "http://localhost:3000/api/logs", method: "POST" } });

function harness(store: BlockingRuleStore) {
  let connect!: (port: any) => void;
  registerRequestBlocking({ getURL: path => base + path, onConnect: { addListener(listener) { connect = listener; } } }, store);
  return (url: string) => {
    const messages: any[] = [];
    const waiting: Array<{ predicate: (message: any) => boolean; resolve(message: any): void }> = [];
    let receive: (message: unknown) => void = () => {};
    let close: () => void = () => {};
    let disconnected = false;
    connect({ name: BLOCKING_PORT, sender: { url },
      onMessage: { addListener(listener: typeof receive) { receive = listener; } },
      onDisconnect: { addListener(listener: typeof close) { close = listener; } },
      disconnect() { disconnected = true; close(); },
      postMessage(message: any) {
        messages.push(message);
        for (const item of [...waiting]) if (item.predicate(message)) { waiting.splice(waiting.indexOf(item), 1); item.resolve(message); }
      },
    });
    return { messages, receive, close, get disconnected() { return disconnected; },
      next(predicate: (message: any) => boolean) {
        return new Promise<any>(resolve => waiting.push({ predicate, resolve }));
      },
    };
  };
}

test("多个面板共享提交后的状态，扩展重启后恢复规则，面板仅有读取权限", async t => {
  const factory = new IDBFactory();
  const store = new BlockingRuleStore(factory);
  t.after(() => store.close());
  const connect = harness(store);
  const manager = connect(base + "blocking-manager.html?pageOrigin=https://app.test");
  const panel = connect(base + "panel.html?tabId=1");
  const snapshot = panel.next(message => message.type === "state");
  panel.receive({ type: "subscribe" });
  assert.deepEqual((await snapshot).rules, []);
  const otherPanel = connect(base + "panel.html?tabId=2");
  const update = panel.next(message => message.type === "state" && message.rules.length === 1);
  const otherUpdate = otherPanel.next(message => message.type === "state");
  const saved = manager.next(message => message.type === "result");
  manager.receive({ type: "save", requestId: "create", input });
  assert.equal((await saved).ok, true);
  const rules = (await update).rules;
  assert.deepEqual((await otherUpdate).rules, rules);
  const denied = panel.next(message => message.type === "result");
  panel.receive({ type: "delete", requestId: "denied", id: rules[0].id, revision: rules[0].revision });
  assert.equal((await denied).ok, false);
  assert.deepEqual(await store.list(), rules);
  manager.close(); panel.close(); otherPanel.close();
  await store.close();
  const restoredStore = new BlockingRuleStore(factory);
  t.after(() => restoredStore.close());
  const reopened = harness(restoredStore)(base + "panel.html?tabId=3");
  const recovered = reopened.next(message => message.type === "state");
  reopened.receive({ type: "subscribe" });
  assert.deepEqual((await recovered).rules, rules);
});

test("不授予网页内容脚本、伪造扩展域名或其他扩展页面规则访问权", async t => {
  const store = new BlockingRuleStore(new IDBFactory());
  t.after(() => store.close());
  const connect = harness(store);
  for (const url of ["", "http://127.0.0.1:22333/", "https://app.test/", base + "popup.html", base + "blocking-manager.html/extra", "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/blocking-manager.html"]) {
    const port = connect(url);
    assert.equal(port.disconnected, true);
    port.receive({ type: "save", requestId: "fake", input });
    assert.deepEqual(port.messages, []);
  }
  assert.deepEqual(await store.list(), []);
});

test("校验和冲突失败不推送伪成功，也不清空已有规则", async t => {
  const store = new BlockingRuleStore(new IDBFactory());
  t.after(() => store.close());
  const manager = harness(store)(base + "blocking-manager.html");
  const saved = manager.next(message => message.type === "result");
  manager.receive({ type: "save", requestId: "create", input });
  await saved;
  const before = await store.list();
  manager.messages.length = 0;
  const failed = manager.next(message => message.type === "result");
  manager.receive({ type: "save", requestId: "duplicate", input });
  assert.equal((await failed).ok, false);
  assert.deepEqual(await store.list(), before);
  assert.equal(manager.messages.some(message => message.type === "state"), false);
});
