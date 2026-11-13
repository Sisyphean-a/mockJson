import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as contract from "@mock-json/extension-contract/blocking-manager";

const source = readFileSync(new URL("./blocking-console-bridge.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;

function harness(url: string, topLevel = true) {
  const responses: any[] = [];
  let receive: ((event: any) => void) | undefined;
  const window = {
    top: undefined as unknown,
    addEventListener(_name: string, listener: typeof receive) { receive = listener; },
    postMessage(message: any, origin: string) { responses.push({ ...message, origin }); },
  };
  window.top = topLevel ? window : {};
  new Script(compiled).runInNewContext({ exports: {}, require() { return contract; }, window, location: new URL(url),
    chrome: { runtime: { getURL(path: string) { return "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/" + path; } } },
  });
  return { responses, registered: () => !!receive,
    send(data: any, source: unknown = window, origin = new URL(url).origin) { receive?.({ data, source, origin }); },
  };
}

test("仅在可信本机顶层控制台发现管理页，不代理任意网页的规则操作", () => {
  const h = harness("http://127.0.0.1:22333/");
  const message = { channel: contract.BLOCKING_MANAGER_CHANNEL, type: "discover", id: "request" };
  h.send(message, {});
  h.send(message, undefined, "https://evil.test");
  h.send({ ...message, type: "delete" });
  assert.deepEqual(h.responses, []);
  h.send(message);
  assert.deepEqual(h.responses, [{ channel: contract.BLOCKING_MANAGER_CHANNEL, type: "manager", id: "request", url: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/blocking-manager.html", origin: "http://127.0.0.1:22333" }]);
  for (const url of ["http://localhost:3000/", "https://evil.test", "http://127.0.0.1.evil:22333/"]) assert.equal(harness(url).registered(), false);
  assert.equal(harness("http://localhost:22333/", false).registered(), false);
});
