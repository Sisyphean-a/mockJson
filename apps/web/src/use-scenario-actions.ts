import { watch } from "vue";
import type { Api, MockAdminClient, Scene } from "./mock-admin-client";
import type { useConsoleForms } from "./use-console-forms";
import type { useMockState } from "./use-mock-state";

type Forms = ReturnType<typeof useConsoleForms>;
type Model = ReturnType<typeof useMockState>;
type Notify = (message: string) => void;

export function useScenarioActions(client: MockAdminClient, model: Model, forms: Forms, notify: Notify, canLeave: () => boolean) {
  watch(model.scene, (current) => {
    forms.draft.value = current ? JSON.stringify(current.responseBody, null, 4) : "";
    forms.jsonError.value = "";
    forms.draftDirty.value = false;
  }, { immediate: true });
  watch(model.pkg, (current) => { forms.targetUrl.value = current?.targetBaseUrl || ""; }, { immediate: true });

  function openSceneCreate() {
    if (!canLeave()) return;
    forms.sceneEditMode.value = false;
    forms.sceneName.value = "";
    forms.showScene.value = true;
  }

  function openSceneEdit(scene: Scene) {
    if (model.sceneId.value !== scene.id && !canLeave()) return;
    model.sceneId.value = scene.id;
    forms.editSceneName.value = scene.name;
    forms.editSceneStatus.value = scene.status;
    forms.editSceneDelay.value = scene.delayMs;
    forms.editSceneColor.value = scene.color || "blue";
    forms.sceneEditMode.value = true;
    forms.showScene.value = true;
  }

  async function createScene() {
    const api = model.api.value;
    if (!api || !forms.sceneName.value.trim()) return;
    try {
      const created = await model.runAdminRequest(() => client.createScenario(api.id, { name: forms.sceneName.value, responseBody: {} }));
      api.scenarios.push(created);
      forms.sceneName.value = "";
      forms.showScene.value = false;
      model.sceneId.value = created.id;
      notify("场景已创建，配置完成后再启用");
    } catch (error) { notify(message(error)); }
  }

  async function saveScene() {
    if (!forms.sceneEditMode.value) { await createScene(); return; }
    const scene = model.scene.value;
    if (!scene) return;
    try {
      const saved = await model.runAdminRequest(() => client.updateScenario(scene.id, {
        name: forms.editSceneName.value, status: forms.editSceneStatus.value,
        delayMs: forms.editSceneDelay.value, color: forms.editSceneColor.value,
      }));
      Object.assign(scene, saved);
      forms.showScene.value = false;
      forms.sceneEditMode.value = false;
      notify("场景已更新");
    } catch (error) { notify(message(error)); }
  }

  async function saveJson() {
    const scene = model.scene.value;
    if (!scene) return;
    try {
      const responseBody = JSON.parse(forms.draft.value);
      const saved = await model.runAdminRequest(() => client.updateScenario(scene.id, { responseBody }));
      scene.responseBody = saved.responseBody;
      forms.draftDirty.value = false;
      forms.jsonError.value = "";
      notify("场景已保存");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "JSON 格式错误";
      forms.jsonError.value = messageText.startsWith("无法连接 Mock 服务") ? `${messageText}；响应尚未保存` : messageText;
    }
  }

  async function toggleScene(scene: Scene) {
    const api = model.api.value;
    if (!api) return;
    const isActive = model.activeSceneId.value === scene.id;
    if (!isActive && model.sceneId.value === scene.id && forms.draftDirty.value) {
      notify("请先保存响应，再启用场景");
      return;
    }
    if (!isActive && model.sceneId.value !== scene.id && !canLeave()) return;
    try {
      if (isActive) {
        await model.runAdminRequest(() => client.deactivateScenario(api.id));
        api.activeScenarioId = null;
        notify("场景已停用");
      } else {
        await model.runAdminRequest(() => client.activateScenario(api.id, scene.id));
        api.activeScenarioId = scene.id;
        model.sceneId.value = scene.id;
        notify("场景已启用");
      }
    } catch (error) { notify(message(error)); }
  }

  async function duplicateScene(scene: Scene) {
    const api = model.api.value;
    if (!api) return;
    try {
      const created = await model.runAdminRequest(() => client.createScenario(api.id, {
        name: `${scene.name} 副本`, status: scene.status, delayMs: scene.delayMs,
        responseBody: scene.responseBody, color: scene.color, activate: false,
      }));
      api.scenarios.push(created);
      notify("场景已复制");
    } catch (error) { notify(message(error)); }
  }

  async function deleteScene(scene: Scene) {
    const api = model.api.value;
    if (!api || !window.confirm(`确定删除场景“${scene.name}”吗？删除后不可恢复。`)) return;
    try { await model.runAdminRequest(() => client.deleteScenario(scene.id)); await model.load(); notify("场景已删除"); }
    catch (error) { notify(message(error)); }
  }

  return { openSceneCreate, openSceneEdit, createScene, saveScene, saveJson, toggleScene, duplicateScene, deleteScene };
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
