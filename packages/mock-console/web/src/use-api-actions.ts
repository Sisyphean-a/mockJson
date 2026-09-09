import type { Api, MatchRule, MockAdminClient } from "./mock-admin-client";
import type { useConsoleForms } from "./use-console-forms";
import type { useMockState } from "./use-mock-state";

type Forms = ReturnType<typeof useConsoleForms>;
type Model = ReturnType<typeof useMockState>;
type Notify = (message: string) => void;

export function useApiActions(client: MockAdminClient, model: Model, forms: Forms, notify: Notify, canLeave: () => boolean) {
  function openApiCreate() {
    if (!model.pkg.value) { forms.showPackage.value = true; return; }
    forms.apiEditName.value = "";
    forms.showApi.value = true;
  }

  function openApiEdit() {
    const api = model.api.value;
    if (!api) return;
    forms.apiEditName.value = api.name;
    forms.apiPriority.value = api.priority;
    forms.showApi.value = true;
  }

  async function createApi() {
    const current = model.pkg.value;
    if (!current || !forms.apiName.value.trim()) return;
    try {
      const created = await model.runAdminRequest(() => client.createApi(current.id, forms.apiName.value));
      current.apis.push(created);
      forms.apiName.value = "";
      forms.showApi.value = false;
      model.selectApi(created, canLeave);
      notify("接口已创建");
    } catch (error) { notify(message(error)); }
  }

  async function saveApi() {
    const current = model.api.value;
    if (!current) return;
    try {
      const saved = await model.runAdminRequest(() => client.updateApi(current.id, { name: forms.apiEditName.value, priority: forms.apiPriority.value }));
      model.replaceApi(saved);
      forms.showApi.value = false;
      notify("接口已更新");
    } catch (error) { notify(message(error)); }
  }

  async function deleteApi() {
    await deleteApiTarget(model.api.value);
  }

  async function deleteApiTarget(api: Api | undefined) {
    if (!api || !window.confirm(`确定删除接口“${api.name}”及其场景吗？删除后不可恢复。`)) return;
    try { await model.runAdminRequest(() => client.deleteApi(api.id)); await model.load(); notify("接口已删除"); }
    catch (error) { notify(message(error)); }
  }

  async function toggle(api: Api) {
    try {
      const saved = await model.runAdminRequest(() => client.updateApi(api.id, { enabled: !api.enabled }));
      model.replaceApi(saved);
      notify(saved.enabled ? "Mock 已开启" : "已关闭 Mock，将转发真实服务");
    } catch (error) { notify(message(error)); }
  }

  function openRuleCreate() {
    forms.editingRuleId.value = null;
    forms.ruleSource.value = "header";
    forms.ruleField.value = "apiName";
    forms.ruleOperator.value = "equals";
    forms.ruleValue.value = "";
    forms.addingRule.value = true;
  }

  function openRuleEdit(rule: MatchRule) {
    forms.editingRuleId.value = rule.id;
    forms.ruleSource.value = rule.source;
    forms.ruleField.value = rule.field;
    forms.ruleOperator.value = rule.operator;
    forms.ruleValue.value = rule.value;
    forms.addingRule.value = true;
  }

  function cancelRuleEdit() {
    forms.editingRuleId.value = null;
    forms.addingRule.value = false;
  }

  async function addRule() {
    const api = model.api.value;
    if (!api || (forms.ruleOperator.value !== "exists" && forms.ruleOperator.value !== "notExists" && !forms.ruleValue.value.trim())) return;
    const value = forms.ruleSource.value === "method" ? forms.ruleValue.value.trim().toUpperCase() : forms.ruleValue.value.trim();
    const editingRuleId = forms.editingRuleId.value;
    const draft: Omit<MatchRule, "id"> = {
      source: forms.ruleSource.value,
      field: forms.ruleField.value,
      operator: forms.ruleOperator.value as MatchRule["operator"],
      value,
    };
    const rules: MatchRule[] = editingRuleId
      ? api.matchRules.map((rule) => rule.id === editingRuleId ? { ...rule, ...draft } : rule)
      : [...api.matchRules, { id: crypto.randomUUID(), ...draft }];
    try {
      const saved = await model.runAdminRequest(() => client.updateApi(api.id, { matchRules: rules }));
      model.replaceApi(saved);
      cancelRuleEdit();
      notify(editingRuleId ? "匹配条件已更新" : "匹配条件已添加");
    } catch (error) { notify(message(error)); }
  }

  async function removeRule(id: string) {
    const api = model.api.value;
    if (!api) return;
    try {
      const saved = await model.runAdminRequest(() => client.updateApi(api.id, { matchRules: api.matchRules.filter((rule) => rule.id !== id) }));
      model.replaceApi(saved);
      if (forms.editingRuleId.value === id) cancelRuleEdit();
      notify("匹配条件已删除");
    } catch (error) { notify(message(error)); }
  }

  async function updateLogic(mode: "AND" | "OR") {
    const api = model.api.value;
    if (!api) return;
    try {
      const saved = await model.runAdminRequest(() => client.updateApi(api.id, { matchMode: mode }));
      model.replaceApi(saved);
      notify("规则关系已更新");
    } catch (error) { notify(message(error)); }
  }

  function changeSource() {
    forms.ruleField.value = forms.ruleSource.value === "header" ? "apiName" : forms.ruleSource.value === "url" ? "path" : "method";
  }

  return {
    openApiCreate,
    openApiEdit,
    createApi,
    saveApi,
    deleteApi,
    deleteApiTarget,
    toggle,
    openRuleCreate,
    openRuleEdit,
    cancelRuleEdit,
    addRule,
    removeRule,
    updateLogic,
    changeSource,
  };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
