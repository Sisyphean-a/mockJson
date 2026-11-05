import assert from "node:assert/strict";
import { test } from "node:test";
import { orderApisAfterGroupDrop } from "./api-group-order.js";
import type { Api, ApiGroup } from "./mock-admin-client.js";

const groups: ApiGroup[] = [
  { id: "g1", name: "支付" },
  { id: "g2", name: "订单" },
];

function api(id: string, groupId: string | null = null): Api {
  return {
    id,
    name: id,
    enabled: true,
    groupId,
    priority: 0,
    matchMode: "OR",
    matchRules: [],
    activeScenarioId: null,
    scenarios: [],
  };
}

const ids = (apis: Api[]) => apis.map((item) => item.id);

test("组内拖拽采用松手后的顺序，不被旧扁平数组还原", () => {
  const apis = [api("a1", "g1"), api("a2", "g1"), api("b1", "g2")];
  const next = orderApisAfterGroupDrop(apis, groups, "g1", [apis[1], apis[0]]);
  assert.deepEqual(ids(next), ["a2", "a1", "b1"]);
});

test("跨组拖入时目标组按拖拽结果排序，其他分组保持原顺序", () => {
  const moved = api("a1", "g2");
  const apis = [api("a2", "g1"), api("b1", "g2"), moved];
  const next = orderApisAfterGroupDrop(apis, groups, "g2", [apis[1], moved]);
  assert.deepEqual(ids(next), ["a2", "b1", "a1"]);
});

test("源列表更新不会把已经移出的接口放回原位", () => {
  const apis = [api("a2", "g1"), api("b1", "g2"), api("a1", "g2")];
  const next = orderApisAfterGroupDrop(apis, groups, "g1", [apis[0]]);
  assert.deepEqual(ids(next), ["a2", "b1", "a1"]);
});

test("拖回未分组与孤儿归属都落在未分组区末尾", () => {
  const orphan = api("ghost", "missing");
  const apis = [api("a1", null), api("a2", "g1"), orphan];
  assert.deepEqual(ids(orderApisAfterGroupDrop(apis, groups, "g1", [apis[1]])), ["a2", "a1", "ghost"]);
  assert.deepEqual(ids(orderApisAfterGroupDrop(apis, groups, null, [apis[2], apis[0]])), ["a2", "ghost", "a1"]);
});

test("源列表先移出扁平数组时，目标列表仍按拖拽结果恢复该接口", () => {
  const moved = api("a1", "g2");
  const apis = [api("a2", "g1"), api("b1", "g2")];
  assert.deepEqual(ids(orderApisAfterGroupDrop(apis, groups, "g2", [apis[1], moved])), ["a2", "b1", "a1"]);
});

test("被隐藏的归档接口不会因组内拖拽丢失", () => {
  const archived = api("a3", "g1");
  archived.archived = true;

  const apis = [api("a1", "g1"), archived, api("a2", "g1")];
  assert.deepEqual(ids(orderApisAfterGroupDrop(apis, groups, "g1", [apis[0], apis[2]])), ["a1", "a2", "a3"]);
});
