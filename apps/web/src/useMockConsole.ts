import { onBeforeUnmount, onMounted, ref } from "vue";
import { MockAdminClient } from "./mock-admin-client";
import { useApiActions } from "./use-api-actions";
import { useConsoleForms } from "./use-console-forms";
import { useMockState } from "./use-mock-state";
import { usePackageActions } from "./use-package-actions";
import { useScenarioActions } from "./use-scenario-actions";
import { createRuntimeEndpoints, type RuntimeEndpoints } from "./runtime-endpoints";

export function useMockConsole(endpoints: RuntimeEndpoints = createRuntimeEndpoints()) {
  const client = new MockAdminClient(endpoints);
  const model = useMockState(client);
  const forms = useConsoleForms();
  const toast = ref("");

  function notice(message: string) {
    toast.value = message;
    setTimeout(() => { toast.value = ""; }, 2200);
  }

  function leaveCurrentDraft() {
    return !forms.draftDirty.value || window.confirm("当前 JSON 尚未保存，确定要离开吗？");
  }

  const packageActions = usePackageActions(client, model, forms, notice, leaveCurrentDraft);
  const apiActions = useApiActions(client, model, forms, notice, leaveCurrentDraft);
  const scenarioActions = useScenarioActions(client, model, forms, notice, leaveCurrentDraft);

  function selectApi(item: Parameters<typeof model.selectApi>[0]) {
    return model.selectApi(item, leaveCurrentDraft);
  }

  function selectScene(item: Parameters<typeof model.selectScene>[0]) {
    return model.selectScene(item, leaveCurrentDraft);
  }

  async function retryLoad() {
    try { await model.load(); }
    catch {
      // Rule: 启动失败只由 loadError 展示，避免同一错误再叠加 Toast。
    }
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!forms.draftDirty.value) return;
    event.preventDefault();
    event.returnValue = "";
  }

  onMounted(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    void retryLoad();
  });
  onBeforeUnmount(() => window.removeEventListener("beforeunload", handleBeforeUnload));

  return {
    ...model,
    ...forms,
    toast,
    selectApi,
    selectScene,
    retryLoad,
    ...packageActions,
    switchPkg: packageActions.switchPackage,
    ...apiActions,
    ...scenarioActions,
  };
}
