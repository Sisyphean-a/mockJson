import test from "node:test";
import assert from "node:assert/strict";
import { matchApi } from "./matcher.js";
const api = (mode: "AND" | "OR") => ({
  id: "a",
  name: "a",
  enabled: true,
  priority: 1,
  matchMode: mode,
  activeScenarioId: null,
  scenarios: [],
  matchRules: [
    {
      id: "1",
      source: "header" as const,
      field: "ApiName",
      operator: "equals",
      value: "123",
    },
    {
      id: "2",
      source: "url" as const,
      field: "path",
      operator: "contains",
      value: "/loan",
    },
  ],
});
test("header matching ignores case and AND requires every rule", () => {
  assert.equal(
    matchApi(api("AND"), {
      method: "GET",
      url: new URL("http://x/loan"),
      headers: { apiname: "123" },
    }),
    true,
  );
  assert.equal(
    matchApi(api("AND"), {
      method: "GET",
      url: new URL("http://x/other"),
      headers: { apiname: "123" },
    }),
    false,
  );
});
test("OR accepts either rule", () => {
  assert.equal(
    matchApi(api("OR"), {
      method: "GET",
      url: new URL("http://x/other"),
      headers: { apiname: "123" },
    }),
    true,
  );
});
