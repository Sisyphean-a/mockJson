import { computed } from "vue";
import type { Api, ApiGroup, MockAdminClient } from "./mock-admin-client";
import type { useConsoleForms } from "./use-console-forms";
import type { useMockState } from "./use-mock-state";

type Forms = ReturnType<typeof useConsoleForms>;
type Model = ReturnType<typeof useMockState>;
type Notify = (message: string) => void;

export function useApiGroupActions(client: MockAdminClient, model: Model, forms: Forms, notify: Notify) {
  function openApiGroupCreate() {
    if (!model.pkg.value) return;
    forms.editingApiGroupId.value = null;
    forms.apiGroupName.value = "";
    forms.showApiGroup.value = true;
  }

  function openApiGroupEdit(group: ApiGroup) {
    forms.editingApiGroupId.value = group.id;
    forms.apiGroupName.value = group.name;
    forms.showApiGroup.value = true;
  }

  function closeApiGroupForm() {
    forms.showApiGroup.value = false;
    forms.editingApiGroupId.value = null;
  }

  async function saveApiGroup() {
    const current = model.pkg.value;
    const name = forms.apiGroupName.value.trim();
    if (!current || !name) return;
    const editingId = forms.editingApiGroupId.value;
    try {
      const saved = await model.runAdminRequest(() =>
        editingId ? client.updateApiGroup(editingId, name) : client.createApiGroup(current.id, name),
      );
      if (editingId) {
        const index = current.apiGroups.findIndex((group) => group.id === editingId);
        if (index >= 0) current.apiGroups[index] = saved;
        notify("分组已更新");
      } else {
        current.apiGroups = [...current.apiGroups, saved];
        notify("分组已创建");
      }
      closeApiGroupForm();
    } catch (error) { notify(message(error)); }
  }

  // Rule: 空分组没有需要保留的成员，直接删除；有成员时先弹窗确认，删除只解除归属。
  async function deleteApiGroupTarget(group: ApiGroup) {
    const current = model.pkg.value;
    if (!current || !current.apiGroups.some((item) => item.id === group.id)) return;
    if (current.apis.some((api) => api.groupId === group.id)) {
      forms.apiGroupDeleteId.value = group.id;
      forms.showApiGroupDelete.value = true;
      return;
    }
    await removeApiGroup(group);
  }

  const apiGroupDeleteTarget = computed(
    () => model.pkg.value?.apiGroups.find((group) => group.id === forms.apiGroupDeleteId.value) ?? null,
  );
  const apiGroupDeleteCount = computed(() => {
    const group = apiGroupDeleteTarget.value;
    return group ? (model.pkg.value?.apis.filter((api) => api.groupId === group.id).length ?? 0) : 0;
  });

  function cancelApiGroupDelete() {
    forms.showApiGroupDelete.value = false;
    forms.apiGroupDeleteId.value = null;
  }

  async function confirmApiGroupDelete() {
    const group = apiGroupDeleteTarget.value;
    cancelApiGroupDelete();
    if (group) await removeApiGroup(group);
  }

  async function removeApiGroup(group: ApiGroup) {
    const current = model.pkg.value;
    if (!current) return;
    try {
      await model.runAdminRequest(() => client.deleteApiGroup(group.id));
      // Rule: 与服务端一致地仅解除归属，接口对象、规则与场景就地保留。
      for (const api of current.apis) if (api.groupId === group.id) api.groupId = null;
      current.apiGroups = current.apiGroups.filter((item) => item.id !== group.id);
      notify("分组已删除");
    } catch (error) { notify(message(error)); }
  }

  async function reorderApiGroups(orderedIds: string[], previousIds: string[]) {
    const current = model.pkg.value;
    if (!current || sameOrder(orderedIds, previousIds)) return;

    const byId = new Map(current.apiGroups.map((group) => [group.id, group]));
    const next = orderedIds.map((id) => byId.get(id));
    if (next.some((group) => !group)) return;

    const previousGroups = current.apiGroups;
    current.apiGroups = next as ApiGroup[];
    try {
      const saved = await model.runAdminRequest(() => client.reorderApiGroups(current.id, orderedIds));
      const latest = new Map(saved.map((group) => [group.id, group]));
      current.apiGroups = (next as ApiGroup[]).map((group) => latest.get(group.id) ?? group);
      notify("分组顺序已保存");
    } catch (error) {
      current.apiGroups = previousGroups;
      notify(message(error));
    }
  }

  // Rule: 第三个参数是拖拽前的归属快照；模型可能已被拖拽同步更新，不能用当前值判断是否需要写服务端。
  async function setApiGroup(api: Api, groupId: string | null, before = api.groupId ?? null) {
    if (before === groupId) return;
    api.groupId = groupId;
    try {
      await model.runAdminRequest(() => client.updateApi(api.id, { groupId }));
    } catch (error) {
      api.groupId = before;
      notify(message(error));
    }
  }

  return {
    openApiGroupCreate,
    openApiGroupEdit,
    saveApiGroup,
    deleteApiGroupTarget,
    confirmApiGroupDelete,
    cancelApiGroupDelete,
    apiGroupDeleteTarget,
    apiGroupDeleteCount,
    reorderApiGroups,
    setApiGroup,
  };
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
