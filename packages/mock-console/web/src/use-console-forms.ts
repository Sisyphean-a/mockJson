import { computed, ref } from "vue";

export function useConsoleForms() {
  const draft = ref("");
  const jsonError = ref("");
  const expanded = ref(true);
  const draftDirty = ref(false);
  const showApi = ref(false);
  const showScene = ref(false);
  const showPackage = ref(false);
  const showRealServices = ref(false);
  const sceneEditMode = ref(false);
  const apiName = ref("");
  const apiEditName = ref("");
  const apiPriority = ref(0);
  const sceneName = ref("");
  const editSceneName = ref("");
  const editSceneStatus = ref(200);
  const editSceneDelay = ref(0);
  const editSceneColor = ref("blue");
  const packageName = ref("");
  const editingPackageId = ref<string | null>(null);
  const realServiceName = ref("");
  const realServiceEditId = ref<string | null>(null);
  const targetUrl = ref("");
  const ruleSource = ref<"header" | "url" | "method">("header");
  const ruleField = ref("apiName");
  const ruleOperator = ref("equals");
  const ruleValue = ref("");
  const editingRuleId = ref<string | null>(null);
  const addingRule = ref(false);

  const operators = [
    { value: "equals", label: "等于" }, { value: "notEquals", label: "不等于" },
    { value: "contains", label: "包含" }, { value: "notContains", label: "不包含" },
    { value: "exists", label: "存在" }, { value: "notExists", label: "不存在" },
  ];
  const urlFields = [
    { value: "path", label: "path（路径，不含查询参数）" }, { value: "host", label: "host（域名和端口）" },
    { value: "fullUrl", label: "fullUrl（包含查询参数）" },
  ];
  const methodFields = [{ value: "method", label: "HTTP Method" }];
  const ruleHint = computed(() => {
    if (ruleSource.value === "header") return "Reqable 转发请求时保留该 Header，服务就可以按它匹配。";
    if (ruleSource.value === "method") return "例如 GET、POST、PUT；匹配时区分 HTTP 方法。";
    if (ruleField.value === "path") return "推荐使用：例如 /api/chile/loan。";
    if (ruleField.value === "host") return "注意：Reqable 改写目标后，Host 可能变成本机地址。";
    return "包含完整路径和 ? 后面的查询参数，例如 case=failed。";
  });

  return {
    draft, jsonError, expanded, draftDirty, showApi, showScene, showPackage, showRealServices, sceneEditMode,
    apiName, apiEditName, apiPriority, sceneName, editSceneName, editSceneStatus,
    editSceneDelay, editSceneColor, packageName, editingPackageId, realServiceName, realServiceEditId, targetUrl,
    ruleSource, ruleField, ruleOperator, ruleValue, editingRuleId, addingRule,
    operators, urlFields, methodFields, ruleHint,
  };
}
