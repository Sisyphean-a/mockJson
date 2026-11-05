import type { Api, ApiGroup } from "./mock-admin-client";

// Rule: 分组拖拽结束后，目标分组的成员与顺序完全以拖拽结果为准，其余分组保持既有扁平顺序。
// Failure: 若用拖拽前的扁平数组重新分组，组内换序会被旧顺序覆盖，松手后视觉回弹。
export function orderApisAfterGroupDrop(
  apis: Api[],
  groups: ApiGroup[],
  groupId: string | null,
  dropped: Api[],
): Api[] {
  const groupIds = groups.map((group) => group.id);
  const known = new Set(groupIds);
  const target = groupId && known.has(groupId) ? groupId : null;
  const inDrop = new Set(dropped.map((api) => api.id));
  const buckets = new Map<string | null, Api[]>(groupIds.map((id) => [id, []]));
  buckets.set(null, []);
  for (const api of apis) {
    if (inDrop.has(api.id)) continue;
    const key = api.groupId && known.has(api.groupId) ? api.groupId : null;
    buckets.get(key)!.push(api);
  }
  // Guarantee: 跨组拖拽时扁平数组可能已被源列表事件移出该接口，成员对象以拖拽结果为准。
  // Guarantee: 拖拽列表可能不含被隐藏的归档成员，它们保留在目标分组末尾，不因排序丢失。
  buckets.set(target, [...dropped, ...(buckets.get(target) ?? [])]);
  return [...groupIds, null].flatMap((key) => buckets.get(key)!);
}
