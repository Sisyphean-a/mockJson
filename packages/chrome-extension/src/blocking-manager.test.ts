import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as rules from "./blocking-rules.js";

const source = readFileSync(new URL("./blocking-manager.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/blocking-manager.html", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;

class Element {
  children: Element[] = [];
  options: Element[] = [];
  listeners: Record<string, (...args: any[]) => void> = {};
  dataset: Record<string, string> = {};
  textContent = ""; value = ""; className = ""; type = "";
  checked = false; hidden = false; disabled = false; required = false;
  constructor(readonly tagName = "div") {}
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren() { this.children = []; }
  setAttribute() {}
  addEventListener(type: string, listener: (...args: any[]) => void) { this.listeners[type] = listener; }
  add(option: Element) { this.options.push(option); }
  remove(index: number) { this.options.splice(index, 1); }
  focus() {}
  click() { if (!this.disabled) this.listeners.click?.(); }
}

function harness(search = "?pageOrigin=https://app.test&targetUrl=http://localhost:3000/api/logs&method=POST") {
  const elements = new Map<string, Element>();
  for (const id of html.matchAll(/id="([^"]+)"/g)) elements.set(id[1], new Element());
  const el = (id: string) => elements.get(id)!;
  el("scope-filter").options = [new Element("option"), new Element("option")];
  el("editor").hidden = true;
  let update!: (rules: rules.BlockingRule[]) => void;
  let unavailable!: (error: string) => void;
  const commands: any[] = [];
  const control = { error: "", records: [] as rules.BlockingRule[] };
  const document = {
    getElementById: el, createElement: (tag: string) => new Element(tag), addEventListener() {},
  };
  const window = { addEventListener() {}, parent: { postMessage() {} } };
  new Script(compiled).runInNewContext({ exports: {}, require(name: string) {
    if (name === "./blocking-rules.js") return rules;
    assert.equal(name, "./blocking-client.js");
    return { RequestBlockingClient: class {
      constructor(state: typeof update, error: typeof unavailable) { update = state; unavailable = error; }
      async save(input: rules.BlockingRuleInput, rule?: rules.BlockingRule) {
        commands.push({ type: "save", input, rule });
        if (control.error) throw new Error(control.error);
        const saved = { ...input, id: rule?.id ?? "one", revision: "new" };
        control.records = [...control.records.filter(item => item.id !== saved.id), saved];
        update(control.records);
      }
      async delete(rule: rules.BlockingRule) {
        commands.push({ type: "delete", rule });
        if (control.error) throw new Error(control.error);
        control.records = control.records.filter(item => item.id !== rule.id);
        update(control.records);
      }
      close() {}
    } };
  }, document, window, location: { search }, URLSearchParams, Error,
    Option: class extends Element { constructor(text: string, value: string) { super("option"); this.textContent = text; this.value = value; } },
  });
  return { el, commands, control,
    state(records: rules.BlockingRule[] = []) { control.records = records; update(records); },
    fail: (error: string) => unavailable(error),
    submit() { el("editor").listeners.submit({ preventDefault() {} }); },
    find(text: string) {
      const all = (element: Element): Element[] => [element, ...element.children.flatMap(all)];
      return all(el("rules")).find(element => element.textContent === text)!;
    },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const existing: rules.BlockingRule = { enabled: true, scopeOrigin: "https://app.test", method: "POST", targetUrl: "http://localhost:3000/api/logs", matchMode: "exact", id: "one", revision: "old" };

test("右键预填指定站点、方法和地址；保存失败保留草稿，成功后关闭编辑区", async () => {
  const h = harness(); h.state();
  assert.equal(h.el("editor").hidden, false);
  assert.equal(h.el("scope-url").value, "https://app.test");
  assert.equal(h.el("method").value, "POST");
  assert.equal(h.el("target-url").value, "http://localhost:3000/api/logs");
  h.control.error = "磁盘已满";
  h.submit(); await tick();
  assert.equal(h.el("editor").hidden, false);
  assert.equal(h.el("target-url").value, "http://localhost:3000/api/logs");
  assert.equal(h.el("error").textContent, "磁盘已满");
  h.control.error = "";
  h.submit(); await tick();
  assert.equal(h.el("editor").hidden, true);
  assert.equal(h.control.records.length, 1);
});

test("管理规则支持编辑、启停、确认删除，提交绑定选中版本", async () => {
  const h = harness(""); h.state([existing]);
  h.find("编辑").click();
  h.el("method").value = "GET";
  h.submit(); await tick();
  assert.equal(h.commands[0].rule.revision, "old");
  assert.equal(h.control.records[0].method, "GET");
  const toggle = h.el("rules").children[0].children[0].children[0];
  toggle.checked = false; toggle.listeners.change(); await tick();
  assert.equal(h.control.records[0].enabled, false);
  h.find("删除").click();
  assert.equal(h.control.records.length, 1);
  h.find("取消").click();
  assert.equal(h.control.records.length, 1);
  h.find("删除").click(); h.find("确认删除").click(); await tick();
  assert.equal(h.control.records.length, 0);
});

test("搜索与站点筛选包含全站点规则，断连禁用写入但保留已有列表", () => {
  const h = harness();
  h.state([existing, { ...existing, id: "global", scopeOrigin: "*" }, { ...existing, id: "other", scopeOrigin: "https://other.test" }]);
  assert.equal(h.el("rules").children.length, 2);
  h.el("rule-search").value = "missing"; h.el("rule-search").listeners.input();
  assert.equal(h.el("rules").children.length, 0);
  assert.equal(h.el("empty").hidden, false);
  h.el("rule-search").value = ""; h.el("rule-search").listeners.input();
  h.fail("连接已断开");
  assert.equal(h.el("rules").children.length, 2);
  assert.equal(h.el("add").disabled, true);
  assert.equal(h.el("connection").textContent, "连接已断开");
});
