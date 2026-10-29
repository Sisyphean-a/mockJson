import { onBeforeUnmount, onMounted, ref } from "vue";
import { MockAdminClient } from "./mock-admin-client";
import { useApiActions } from "./use-api-actions";
import { useConsoleForms } from "./use-console-forms";
import { useMockState } from "./use-mock-state";
import { usePackageActions } from "./use-package-actions";
import { useScenarioActions } from "./use-scenario-actions";
import { createRuntimeEndpoints, type RuntimeEndpoints } from "./runtime-endpoints";
import { useRequestLogs } from "./use-request-logs";
import { useResponseSelection } from "./use-response-selection";
import { useCaptureImport } from "./use-capture-import";

export function useMockConsole(endpoints: RuntimeEndpoints = createRuntimeEndpoints()) {
  const client = new MockAdminClient(endpoints);
  const model = useMockState(client);
  const requestLogs = useRequestLogs(client, model.runAdminRequest);
  const forms = useConsoleForms();
  const responseActions = useResponseSelection(client, model);
  const toast = ref("");
  // Rule: 匹配条件展开/折叠是跨逻辑接口共享的全局 UI 状态，切换接口时保持不变。
  const matchCollapsed = ref(false);

  function notice(message: string) {
    toast.value = message;
    setTimeout(() => { toast.value = ""; }, 2200);
  }

  function toggleMatchCollapsed() {
    matchCollapsed.value = !matchCollapsed.value;
  }

  function leaveCurrentDraft() {
    return !forms.draftDirty.value || window.confirm("当前 JSON 尚未自动保存完成，确定要离开吗？");
  }

  const packageActions = usePackageActions(client, model, forms, notice, leaveCurrentDraft);
  const apiActions = useApiActions(client, model, forms, notice, leaveCurrentDraft);
  const scenarioActions = useScenarioActions(client, model, forms, notice, leaveCurrentDraft);

  function selectApi(item: Parameters<typeof model.selectApi>[0], after?: () => void) {
    if (model.api.value?.id === item.id) { after?.(); return true; }
    return responseActions.guardResponseLeave(() => { if (model.selectApi(item, leaveCurrentDraft)) after?.(); });
  }

  function selectScene(item: Parameters<typeof model.selectScene>[0]) {
    if (!leaveCurrentDraft()) return;
    model.selectScene(item);
    responseActions.rulesOpen.value = false;
  }

  function viewBranchScene(id: string) {
    const scene = model.api.value?.scenarios.find((s) => s.id === id);
    if (scene) selectScene(scene);
  }

  function showBranchRules() {
    if (leaveCurrentDraft()) responseActions.rulesOpen.value = true;
  }

  async function toggleScene(scene: Parameters<typeof scenarioActions.toggleScene>[0]) {
    const api = model.api.value;
    if (!api || responseActions.responseSaving.value) return;
    if (responseActions.responseEditorMode.value !== "fixed") return;
    if (responseActions.responseDirty.value || api.responseSelection?.mode === "conditional") {
      const draft = responseActions.responseDraft.value;
      draft.activeScenarioId = draft.activeScenarioId === scene.id && !api.passthrough ? null : scene.id;
    } else await scenarioActions.toggleScene(scene);
  }

  function deleteScene(scene: Parameters<typeof scenarioActions.deleteScene>[0]) {
    const refs = responseActions.responseReferences(scene);
    if (refs.length) { window.alert(`场景「${scene.name}」被 ${refs.join("、")} 引用，请先解除或替换引用并保存。`); return; }
    return scenarioActions.deleteScene(scene);
  }

  async function retryLoad() {
    try { await model.load(); }
    catch {
      // Rule: 启动失败只由 loadError 展示，避免同一错误再叠加 Toast。
    }
  }

  const capture = useCaptureImport(client, model, async (result) => {
    await model.load();
    if (model.pkg.value?.id !== result.packageId)
      throw new Error("当前测试包已变化，请在顶部切换到保存场景的测试包后重试");
    const api = model.pkg.value.apis.find((a) => a.id === result.apiId);
    if (!api?.scenarios.some((s) => s.id === result.scenarioId))
      throw new Error("已保存的接口或场景已被删除");
    model.search.value = "";
    model.selectedId.value = result.apiId;
    model.sceneId.value = result.scenarioId;
    responseActions.rulesOpen.value = false;
    requestLogs.showWorkspace();
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    notice(result.activated ? "场景已保存并启用" : "场景已保存，未改变当前响应");
  });

  function closeCapture() {
    if (!capture.close()) return false;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!forms.draftDirty.value && !responseActions.responseDirty.value && !capture.dirty.value && !capture.saving.value) return;
    event.preventDefault();
    event.returnValue = "";
  }

  onMounted(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    void retryLoad().then(() => {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const apiId = hash.get("api");
      if (!apiId) return capture.readLocation(window.location.hash);
      if (hash.get("package") !== model.pkg.value?.id) { notice("当前测试包已变化，请确认顶部测试包"); return; }
      const target = model.pkg.value.apis.find((a) => a.id === apiId);
      if (!target) { notice("接口已被删除或移至其他测试包"); return; }
      model.selectApi(target);
      requestLogs.showWorkspace();
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    });
  });
  onBeforeUnmount(() => window.removeEventListener("beforeunload", handleBeforeUnload));

  return {
    ...model,
    capture,
    closeCapture,
    ...requestLogs,
    ...forms,
    toast,
    matchCollapsed,
    toggleMatchCollapsed,
    retryLoad,
    ...packageActions,
    ...apiActions,
    ...scenarioActions,
    ...responseActions,
    selectApi,
    selectScene,
    viewBranchScene,
    showBranchRules,
    toggleScene,
    deleteScene,
    openSceneEdit: (scene: Parameters<typeof scenarioActions.openSceneEdit>[0]) => {
      if (model.sceneId.value !== scene.id && !leaveCurrentDraft()) return;
      model.selectScene(scene);
      responseActions.rulesOpen.value = false;
      scenarioActions.openSceneEdit(scene);
    },
    showWorkspace: () => { if (!capture.open.value || closeCapture()) requestLogs.showWorkspace(); },
    showLogs: () => {
      if (capture.open.value && !closeCapture()) return;
      return responseActions.guardResponseLeave(requestLogs.showLogs);
    },
    switchPkg: (id: string) => responseActions.guardResponseLeave(() => packageActions.switchPackage(id)),
    createApi: () => responseActions.guardResponseLeave(apiActions.createApi),
    moveApi: () => responseActions.guardResponseLeave(apiActions.moveApi),
    deleteApi: () => responseActions.guardResponseLeave(apiActions.deleteApi),
    deleteApiTarget: (api: Parameters<typeof apiActions.deleteApiTarget>[0]) => { responseActions.guardResponseLeave(() => apiActions.deleteApiTarget(api)); },
    savePackage: () => responseActions.guardResponseLeave(packageActions.savePackage),
    deletePackage: (pkg: Parameters<typeof packageActions.deletePackage>[0]) => responseActions.guardResponseLeave(() => packageActions.deletePackage(pkg)),
  };
}
