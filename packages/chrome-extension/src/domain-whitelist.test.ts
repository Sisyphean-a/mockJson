import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WHITELIST, hostMatchesWhitelist, normalizeDomain, parseWhitelistText, urlMatchesWhitelist } from "./domain-whitelist.js";

test("默认白名单覆盖本地开发域名", () => {
  assert.deepEqual(DEFAULT_WHITELIST, ["localhost", "127.0.0.1"]);
  assert.equal(urlMatchesWhitelist("http://localhost:3000/api", DEFAULT_WHITELIST), true);
  assert.equal(urlMatchesWhitelist("http://127.0.0.1:8080/api", DEFAULT_WHITELIST), true);
  assert.equal(urlMatchesWhitelist("https://example.com/api", DEFAULT_WHITELIST), false);
});

test("请求域名白名单支持精确域名和子域名", () => {
  const parsed = parseWhitelistText("example.com\n*.internal.test, https://localhost");

  assert.deepEqual(parsed, {
    domains: ["example.com", "internal.test", "localhost"],
    invalid: [],
  });
  assert.equal(hostMatchesWhitelist("example.com", parsed.domains), true);
  assert.equal(hostMatchesWhitelist("api.example.com", parsed.domains), true);
  assert.equal(hostMatchesWhitelist("badexample.com", parsed.domains), false);
  assert.equal(hostMatchesWhitelist("other.test", parsed.domains), false);
});

test("白名单按请求目标域名过滤，不受页面域名影响", () => {
  const whitelist = ["api.example.com"];
  assert.equal(urlMatchesWhitelist("https://api.example.com/v1/users", whitelist), true);
  assert.equal(urlMatchesWhitelist("https://app.example.com/page", whitelist), false);
  assert.equal(urlMatchesWhitelist("https://other.test/v1/users", whitelist), false);
  assert.equal(urlMatchesWhitelist("/v1/users", whitelist), false);
  assert.equal(urlMatchesWhitelist("https://api.example.com:8443/v1/users", whitelist), true);
});

test("白名单拒绝路径、端口和无效域名", () => {
  assert.equal(normalizeDomain("example.com/path"), null);
  assert.equal(normalizeDomain("example.com:3000"), null);
  assert.equal(normalizeDomain("https://example.com/path"), null);

  const parsed = parseWhitelistText("example.com/path\nexample.com:3000\nexample.com");
  assert.deepEqual(parsed, {
    domains: ["example.com"],
    invalid: ["example.com/path", "example.com:3000"],
  });
});
