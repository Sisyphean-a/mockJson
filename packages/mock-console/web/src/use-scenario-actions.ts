import { onBeforeUnmount, watch } from "vue";
import { validateResponseFields } from "@mock-json/extension-contract/response-fields";
import type { Api, MockAdminClient, Scene } from "./mock-admin-client";
import type { useConsoleForms } from "./use-console-forms";
import type { useMockState } from "./use-mock-state";

type Forms = ReturnType<typeof useConsoleForms>;
type Model = ReturnType<typeof useMockState>;
type Notify = (message: string) => void;

export function useScenarioActions(client: MockAdminClient, model: Model, forms: Forms, notify: Notify, canLeave: () => boolean) {
  const jsonAutosaveDelayMs = 1000;
  let jsonAutosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let jsonSavePromise: Promise<void> | null = null;
  let jsonSaveQueued = false;
  let draftRevision = 0;

  function clearJsonAutosave() {
    if (jsonAutosaveTimer !== undefined) clearTimeout(jsonAutosaveTimer);
    jsonAutosaveTimer = undefined;
  }

  function scheduleJsonAutosave() {
    clearJsonAutosave();
    if (!forms.draftDirty.value) return;
    jsonAutosaveTimer = setTimeout(() => {
      jsonAutosaveTimer = undefined;
      if (forms.draftDirty.value) void saveJson(true);
    }, jsonAutosaveDelayMs);
  }

  watch(model.scene, (current) => {
    clearJsonAutosave();
    draftRevision += 1;
    forms.draft.value = current ? JSON.stringify(current.responseBody, null, 4) : "";
    forms.jsonError.value = "";
    forms.draftDirty.value = false;
  }, { immediate: true });
  watch(forms.draft, () => {
    draftRevision += 1;
    scheduleJsonAutosave();
  });
  watch([
    forms.sceneName, forms.sceneResponseType, forms.sceneFieldPaths, forms.sceneInitialBody,
    forms.editSceneName, forms.editSceneStatus, forms.editSceneDelay, forms.editSceneColor,
  ], () => {
    if (!forms.sceneSaving.value) forms.sceneFormError.value = "";
  }, { flush: "sync" });
  onBeforeUnmount(clearJsonAutosave);

  function openSceneCreate() {
    if (forms.sceneSaving.value || !canLeave()) return;
    forms.sceneEditMode.value = false;
    forms.sceneName.value = "";
    forms.sceneResponseType.value = "mock";
    forms.sceneFieldPaths.value = "";
    forms.sceneInitialBody.value = "{}";
    forms.sceneFormError.value = "";
    forms.showScene.value = true;
  }

  function openSceneEdit(scene: Scene) {
    if (forms.sceneSaving.value) return;
    if (model.sceneId.value !== scene.id && !canLeave()) return;
    model.sceneId.value = scene.id;
    forms.editSceneName.value = scene.name;
    forms.editSceneStatus.value = scene.status;
    forms.editSceneDelay.value = scene.delayMs;
    forms.editSceneColor.value = scene.color || "blue";
    forms.sceneResponseType.value = scene.responseType ?? "mock";
    forms.sceneFieldPaths.value = (scene.fieldPaths ?? []).join("\n");
    forms.sceneFormError.value = "";
    forms.sceneEditMode.value = true;
    forms.showScene.value = true;
  }

  async function createScene() {
    const api = model.api.value;
    if (!api || forms.sceneSaving.value) return;
    const isFirstScene = api.scenarios.length === 0;
    forms.sceneSaving.value = true;
    forms.sceneFormError.value = "";
    try {
      if (!forms.sceneName.value.trim()) throw new Error("请输入场景名称");
      const fields = responseFields();
      let responseBody: unknown;
      try { responseBody = JSON.parse(forms.sceneInitialBody.value); }
      catch { throw new Error("JSON 格式有误，请修正后再创建"); }
      const created = await model.runAdminRequest(() => client.createScenario(api.id, { name: forms.sceneName.value, responseBody, ...fields }));
      api.scenarios.push(created);
      if (isFirstScene) { api.activeScenarioId = created.id; api.passthrough = false; }
      forms.sceneName.value = "";
      forms.showScene.value = false;
      model.sceneId.value = created.id;
      notify(isFirstScene ? "场景已创建并启用" : "场景已创建");
    } catch (error) { forms.sceneFormError.value = message(error); }
    finally { forms.sceneSaving.value = false; }
  }

  function responseFields() {
    const responseType = forms.sceneResponseType.value;
    const fieldPaths = responseType === "mock" ? [] : forms.sceneFieldPaths.value.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
    validateResponseFields(responseType, fieldPaths);
    return { responseType, fieldPaths };
  }

  async function saveScene() {
    if (forms.sceneSaving.value) return;
    if (!forms.sceneEditMode.value) { await createScene(); return; }
    const scene = model.scene.value;
    if (!scene) return;
    forms.sceneSaving.value = true;
    forms.sceneFormError.value = "";
    try {
      const saved = await model.runAdminRequest(() => client.updateScenario(scene.id, {
        name: forms.editSceneName.value, status: forms.editSceneStatus.value,
        delayMs: forms.editSceneDelay.value, color: forms.editSceneColor.value, ...responseFields(),
      }));
      Object.assign(scene, saved);
      forms.showScene.value = false;
      forms.sceneEditMode.value = false;
      notify("场景已更新");
    } catch (error) { forms.sceneFormError.value = message(error); }
    finally { forms.sceneSaving.value = false; }
  }

  async function saveJson(silent = false) {
    clearJsonAutosave();
    if (jsonSavePromise) {
      jsonSaveQueued = true;
      return jsonSavePromise;
    }

    const scene = model.scene.value;
    if (!scene) return;
    const draftAtSave = forms.draft.value;
    const revisionAtSave = draftRevision;
    const savePromise = saveJsonDraft(scene, draftAtSave, revisionAtSave, silent);
    jsonSavePromise = savePromise;
    try {
      await savePromise;
    } finally {
      jsonSavePromise = null;
      if (jsonSaveQueued) {
        jsonSaveQueued = false;
        if (forms.draftDirty.value) void saveJson(true);
      }
    }
  }

  async function saveJsonDraft(scene: Scene, draftAtSave: string, revisionAtSave: number, silent: boolean) {
    try {
      const responseBody = JSON.parse(draftAtSave);
      const saved = await model.runAdminRequest(() => client.updateScenario(scene.id, { responseBody }));
      if (model.scene.value?.id !== scene.id || draftRevision !== revisionAtSave) return;
      scene.responseBody = saved.responseBody;
      forms.draftDirty.value = false;
      forms.jsonError.value = "";
      if (!silent) notify("场景已保存");
    } catch (error) {
      if (model.scene.value?.id !== scene.id || draftRevision !== revisionAtSave) return;
      const messageText = error instanceof Error ? error.message : "JSON 格式错误";
      forms.jsonError.value = messageText.startsWith("无法连接 Mock 服务") ? `${messageText}；响应尚未保存` : messageText;
    }
  }

  async function toggleScene(scene: Scene) {
    const api = model.api.value;
    if (!api) return;
    const isActive = model.activeSceneId.value === scene.id && !api.passthrough;
    if (!isActive && model.sceneId.value === scene.id && forms.draftDirty.value) {
      notify("请先修正 JSON 或等待自动保存完成");
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
        api.passthrough = false;
        model.sceneId.value = scene.id;
        notify("场景已启用");
      }
    } catch (error) { notify(message(error)); }
  }

  async function reorderScenarios(orderedIds: string[], previousIds: string[]) {
    const current = model.api.value;
    if (!current || sameOrder(orderedIds, previousIds)) return;

    const byId = new Map(current.scenarios.map((scenario) => [scenario.id, scenario]));
    const previous = previousIds.map((id) => byId.get(id));
    const next = orderedIds.map((id) => byId.get(id));
    if (previous.some((scenario) => !scenario) || next.some((scenario) => !scenario)) return;

    current.scenarios.splice(0, current.scenarios.length, ...(next as Scene[]));
    try {
      const saved = await model.runAdminRequest(() => client.reorderScenarios(current.id, orderedIds));
      current.scenarios.splice(0, current.scenarios.length, ...saved);
      model.synchronizeSelection();
      notify("场景顺序已保存");
    } catch (error) {
      current.scenarios.splice(0, current.scenarios.length, ...(previous as Scene[]));
      notify(message(error));
    }
  }

  async function duplicateScene(scene: Scene) {
    const api = model.api.value;
    if (!api) return;
    try {
      const created = await model.runAdminRequest(() => client.createScenario(api.id, {
        name: `${scene.name} 副本`, status: scene.status, delayMs: scene.delayMs,
        responseBody: scene.responseBody, color: scene.color, activate: false,
        responseType: scene.responseType, fieldPaths: scene.fieldPaths,
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

  return { openSceneCreate, openSceneEdit, createScene, saveScene, saveJson, toggleScene, reorderScenarios, duplicateScene, deleteScene };
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}
