import { computed, onMounted, ref, watch } from "vue";

export type Rule = {
  id: string;
  source: "header" | "url" | "method";
  field: string;
  operator: string;
  value: string;
};
export type Scene = {
  id: string;
  name: string;
  status: number;
  delayMs: number;
  responseBody: unknown;
  color?: string;
};
export type Api = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "AND" | "OR";
  matchRules: Rule[];
  activeScenarioId: string | null;
  scenarios: Scene[];
};
export type Pkg = { id: string; name: string; targetBaseUrl: string; apis: Api[] };
type State = { currentPackageId: string | null; packages: Pkg[] };

export function useMockConsole() {
  const state = ref<State>({ currentPackageId: null, packages: [] });
  const search = ref(""), selectedId = ref<string | null>(null), sceneId = ref<string | null>(null);
  const draft = ref(""), jsonError = ref(""), expanded = ref(true), draftDirty = ref(false);
  const showApi = ref(false), showScene = ref(false), showPackage = ref(false), sceneEditMode = ref(false);
  const apiName = ref(""), serverReady = ref(false), apiEditName = ref(""), apiPriority = ref(0);
  const sceneName = ref(""), editSceneName = ref(""), editSceneStatus = ref(200), editSceneDelay = ref(0), editSceneColor = ref("blue");
  const packageName = ref(""), editingPackageId = ref<string | null>(null), toast = ref(""), targetUrl = ref("");
  const ruleSource = ref<"header" | "url" | "method">("header"), ruleField = ref("apiName"), ruleOperator = ref("equals"), ruleValue = ref(""), addingRule = ref(false);
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
  const pkg = computed(() => state.value.packages.find((p) => p.id === state.value.currentPackageId));
  const api = computed(() => pkg.value?.apis.find((a) => a.id === selectedId.value));
  const scene = computed(() => api.value?.scenarios.find((s) => s.id === sceneId.value));
  const activeSceneId = computed(() => {
    if (!api.value) return null;
    return api.value.scenarios.some((s) => s.id === api.value!.activeScenarioId) ? api.value.activeScenarioId : api.value.scenarios[0]?.id || null;
  });
  const activeScene = computed(() => api.value?.scenarios.find((s) => s.id === activeSceneId.value));
  const filtered = computed(() => pkg.value?.apis.filter((a) => a.name.toLowerCase().includes(search.value.toLowerCase())) || []);

  async function call(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    let response: Response;
    try {
      response = await fetch(path, { ...options, headers });
      serverReady.value = true;
    } catch (error) {
      serverReady.value = false;
      throw error;
    }
    if (!response.ok) {
      let message = "请求失败";
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }
  async function load() {
    state.value = await call("/__mock_admin/state");
    serverReady.value = true;
    const current = pkg.value;
    if (!current) { selectedId.value = null; sceneId.value = null; return; }
    if (!current.apis.some((a) => a.id === selectedId.value)) selectedId.value = current.apis[0]?.id || null;
    const selected = current.apis.find((a) => a.id === selectedId.value);
    if (!selected?.scenarios.some((s) => s.id === sceneId.value)) sceneId.value = selected?.activeScenarioId || selected?.scenarios[0]?.id || null;
  }
  watch(scene, (s) => {
    draft.value = s ? JSON.stringify(s.responseBody, null, 2) : "";
    jsonError.value = "";
    draftDirty.value = false;
  }, { immediate: true });
  watch(pkg, () => { targetUrl.value = pkg.value?.targetBaseUrl || ""; });
  function leaveCurrentDraft() { return !draftDirty.value || window.confirm("当前 JSON 尚未保存，确定要离开吗？"); }
  function selectApi(a: Api) {
    if (!leaveCurrentDraft()) return;
    selectedId.value = a.id;
    sceneId.value = a.activeScenarioId || a.scenarios[0]?.id || null;
  }
  async function switchPkg(id: string) {
    if (!leaveCurrentDraft()) return;
    try { await call("/__mock_admin/current-package/" + id, { method: "POST" }); await load(); notice("测试包已切换"); }
    catch (e: any) { notice(e.message); }
  }
  function openApiCreate() {
    if (!pkg.value) { openPackage(); return; }
    apiEditName.value = "";
    showApi.value = true;
  }
  function openPackage(p?: Pkg) { editingPackageId.value = p?.id || null; packageName.value = p?.name || ""; showPackage.value = true; }
  async function savePackage() {
    try {
      if (editingPackageId.value) {
        await call("/__mock_admin/packages/" + editingPackageId.value, { method: "PATCH", body: JSON.stringify({ name: packageName.value }) });
      } else {
        const created = await call("/__mock_admin/packages", { method: "POST", body: JSON.stringify({ name: packageName.value }) });
        await call("/__mock_admin/current-package/" + created.id, { method: "POST" });
      }
      showPackage.value = false; await load(); notice(editingPackageId.value ? "Package 已更新" : "Package 已创建");
    } catch (e: any) { notice(e.message); }
  }
  async function deletePackage(p: Pkg) {
    if (!window.confirm(`确定删除 Package“${p.name}”及其全部配置吗？`)) return;
    try { await call("/__mock_admin/packages/" + p.id, { method: "DELETE" }); await load(); notice("Package 已删除"); }
    catch (e: any) { notice(e.message); }
  }
  async function saveTargetUrl() {
    if (!pkg.value) return;
    try { const value = targetUrl.value.trim(); await call("/__mock_admin/packages/" + pkg.value.id, { method: "PATCH", body: JSON.stringify({ targetBaseUrl: value }) }); pkg.value.targetBaseUrl = value; notice(value ? "真实服务地址已保存" : "已清空真实服务地址"); }
    catch (e: any) { notice(e.message); }
  }
  async function toggle(a: Api) {
    try { await call("/__mock_admin/apis/" + a.id, { method: "PATCH", body: JSON.stringify({ enabled: !a.enabled }) }); a.enabled = !a.enabled; notice(a.enabled ? "Mock 已开启" : "已关闭 Mock，将转发真实服务"); }
    catch (e: any) { notice(e.message); }
  }
  function openApiEdit() { if (!api.value) return; apiEditName.value = api.value.name; apiPriority.value = api.value.priority; showApi.value = true; }
  async function saveApi() {
    if (!api.value) return;
    try { const saved = await call("/__mock_admin/apis/" + api.value.id, { method: "PATCH", body: JSON.stringify({ name: apiEditName.value, priority: apiPriority.value }) }); Object.assign(api.value, saved); showApi.value = false; notice("接口已更新"); }
    catch (e: any) { notice(e.message); }
  }
  async function deleteApi() {
    if (!api.value || !window.confirm(`确定删除接口“${api.value.name}”及其场景吗？`)) return;
    try { await call("/__mock_admin/apis/" + api.value.id, { method: "DELETE" }); await load(); notice("接口已删除"); }
    catch (e: any) { notice(e.message); }
  }
  async function activate(s: Scene) {
    if (!api.value || !leaveCurrentDraft()) return;
    try { await call(`/__mock_admin/apis/${api.value.id}/activate/${s.id}`, { method: "POST" }); api.value.activeScenarioId = s.id; sceneId.value = s.id; notice("场景已切换"); }
    catch (e: any) { notice(e.message); }
  }
  async function addRule() {
    if (!api.value || (ruleOperator.value !== "exists" && ruleOperator.value !== "notExists" && !ruleValue.value.trim())) return;
    const value = ruleSource.value === "method" ? ruleValue.value.trim().toUpperCase() : ruleValue.value.trim();
    const rules = [...api.value.matchRules, { id: crypto.randomUUID(), source: ruleSource.value, field: ruleField.value, operator: ruleOperator.value, value }];
    try { await call("/__mock_admin/apis/" + api.value.id, { method: "PATCH", body: JSON.stringify({ matchRules: rules }) }); api.value.matchRules = rules; ruleValue.value = ""; addingRule.value = false; notice("匹配条件已添加"); }
    catch (e: any) { notice(e.message); }
  }
  async function removeRule(id: string) {
    if (!api.value) return;
    try { const rules = api.value.matchRules.filter((r) => r.id !== id); await call("/__mock_admin/apis/" + api.value.id, { method: "PATCH", body: JSON.stringify({ matchRules: rules }) }); api.value.matchRules = rules; notice("匹配条件已删除"); }
    catch (e: any) { notice(e.message); }
  }
  async function updateLogic(mode: "AND" | "OR") {
    if (!api.value) return;
    try { await call("/__mock_admin/apis/" + api.value.id, { method: "PATCH", body: JSON.stringify({ matchMode: mode }) }); api.value.matchMode = mode; notice("规则关系已更新"); }
    catch (e: any) { notice(e.message); }
  }
  function changeSource() { ruleField.value = ruleSource.value === "header" ? "apiName" : ruleSource.value === "url" ? "path" : "method"; }
  async function saveJson() {
    if (!scene.value) return;
    try { const responseBody = JSON.parse(draft.value); const saved = await call("/__mock_admin/scenarios/" + scene.value.id, { method: "PATCH", body: JSON.stringify({ responseBody }) }); scene.value.responseBody = saved.responseBody; draftDirty.value = false; jsonError.value = ""; notice("场景已保存"); }
    catch (e: any) { jsonError.value = e.message || "JSON 格式错误"; }
  }
  async function createApi() {
    if (!pkg.value || !apiName.value.trim()) return;
    try { const created = await call("/__mock_admin/packages/" + pkg.value.id + "/apis", { method: "POST", body: JSON.stringify({ name: apiName.value }) }); pkg.value.apis.push(created); apiName.value = ""; showApi.value = false; selectApi(created); notice("接口已创建"); }
    catch (e: any) { notice(e.message); }
  }
  async function createScene() {
    if (!api.value || !sceneName.value.trim()) return;
    try { const created = await call("/__mock_admin/apis/" + api.value.id + "/scenarios", { method: "POST", body: JSON.stringify({ name: sceneName.value, responseBody: {}, activate: true }) }); api.value.scenarios.push(created); api.value.activeScenarioId = created.id; sceneName.value = ""; showScene.value = false; sceneId.value = created.id; notice("场景已创建"); }
    catch (e: any) { notice(e.message); }
  }
  function openSceneCreate() {
    if (!leaveCurrentDraft()) return;
    sceneEditMode.value = false;
    sceneName.value = "";
    showScene.value = true;
  }
  function openSceneEdit(s: Scene) {
    if (sceneId.value !== s.id && !leaveCurrentDraft()) return;
    sceneId.value = s.id;
    editSceneName.value = s.name;
    editSceneStatus.value = s.status;
    editSceneDelay.value = s.delayMs;
    editSceneColor.value = s.color || "blue";
    sceneEditMode.value = true;
    showScene.value = true;
  }
  async function duplicateScene(s: Scene) {
    if (!api.value) return;
    try {
      const created = await call("/__mock_admin/apis/" + api.value.id + "/scenarios", { method: "POST", body: JSON.stringify({ name: `${s.name} 副本`, status: s.status, delayMs: s.delayMs, responseBody: s.responseBody, color: s.color, activate: false }) });
      api.value.scenarios.push(created);
      notice("场景已复制");
    } catch (e: any) { notice(e.message); }
  }
  async function saveScene() {
    try {
      if (sceneEditMode.value && scene.value) { const saved = await call("/__mock_admin/scenarios/" + scene.value.id, { method: "PATCH", body: JSON.stringify({ name: editSceneName.value, status: editSceneStatus.value, delayMs: editSceneDelay.value, color: editSceneColor.value }) }); Object.assign(scene.value, saved); notice("场景已更新"); }
      else { await createScene(); return; }
      showScene.value = false; sceneEditMode.value = false;
    } catch (e: any) { notice(e.message); }
  }
  async function deleteScene(s: Scene) {
    if (!api.value || !window.confirm(`确定删除场景“${s.name}”吗？`)) return;
    try { await call("/__mock_admin/scenarios/" + s.id, { method: "DELETE" }); await load(); notice("场景已删除"); }
    catch (e: any) { notice(e.message); }
  }
  function notice(message: string) { toast.value = message; setTimeout(() => (toast.value = ""), 2200); }
  onMounted(async () => { try { await load(); } catch (e: any) { serverReady.value = false; notice(e.message); } });

  return { state, search, selectedId, sceneId, draft, jsonError, expanded, showApi, showScene, showPackage, sceneEditMode, draftDirty, apiName, serverReady, apiEditName, apiPriority, sceneName, editSceneName, editSceneStatus, editSceneDelay, editSceneColor, packageName, editingPackageId, toast, targetUrl, ruleSource, ruleField, ruleOperator, ruleValue, addingRule, operators, urlFields, methodFields, ruleHint, pkg, api, scene, activeSceneId, activeScene, filtered, selectApi, switchPkg, openApiCreate, openPackage, savePackage, deletePackage, saveTargetUrl, toggle, openApiEdit, saveApi, deleteApi, activate, addRule, removeRule, updateLogic, changeSource, saveJson, createApi, createScene, openSceneCreate, openSceneEdit, duplicateScene, saveScene, deleteScene };
}
