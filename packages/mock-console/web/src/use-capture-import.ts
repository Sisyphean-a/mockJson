import { computed, reactive, ref, watch } from "vue";
import type { CaptureDraft, CaptureSaveResult } from "../../shared/types";
import type { MockAdminClient } from "./mock-admin-client";
import type { useMockState } from "./use-mock-state";

export function useCaptureImport(client: MockAdminClient, model: ReturnType<typeof useMockState>, reveal: (result: CaptureSaveResult) => Promise<void>) {
  const open = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  const draft = ref<CaptureDraft>();
  const saved = ref<CaptureSaveResult>();
  const form = reactive({ apiId: "", apiName: "", scenarioName: "", status: 200, delayMs: 0, responseBody: "" });
  let captureId = "";
  let initialForm = "";
  const selectedApi = computed(() => model.pkg.value?.apis.find((a) => a.id === form.apiId));
  const conditional = computed(() => selectedApi.value?.responseSelection?.mode === "conditional");
  const dirty = computed(() => Boolean(open.value && draft.value && !saved.value && initialForm && JSON.stringify(form) !== initialForm));
  const jsonError = computed(() => {
    try { JSON.parse(form.responseBody); return ""; }
    catch { return "响应内容必须是合法 JSON"; }
  });

  watch(() => model.pkg.value?.id, () => { form.apiId = ""; }, { flush: "sync" });

  async function readLocation(hash: string) {
    const id = new URLSearchParams(hash.replace(/^#/, "")).get("capture");
    if (!id) return;
    captureId = id;
    open.value = true;
    await load();
  }

  async function load() {
    if (loading.value || saving.value) return;
    loading.value = true;
    error.value = "";
    try {
      const value = await model.runAdminRequest(() => client.getCapture(captureId));
      draft.value = value;
      saved.value = value.saved;
      const url = new URL(value.request.url);
      Object.assign(form, {
        apiId: "", apiName: `${value.request.method} ${url.pathname}`.slice(0, 200),
        scenarioName: `响应 ${value.response.status}`, status: value.response.status,
        delayMs: 0, responseBody: JSON.stringify(JSON.parse(value.response.body), null, 2),
      });
      initialForm = JSON.stringify(form);
    } catch (cause) { error.value = cause instanceof Error ? cause.message : "无法读取响应草稿"; }
    finally { loading.value = false; }
  }

  function close() {
    if (saving.value) return false;
    if (dirty.value && !window.confirm("响应草稿有未保存修改，确定离开吗？")) return false;
    open.value = false;
    return true;
  }

  async function viewSaved() {
    if (!saved.value || saving.value) return;
    saving.value = true;
    error.value = "";
    try { await reveal(saved.value); open.value = false; }
    catch (cause) { error.value = `场景已保存，但暂时无法定位：${cause instanceof Error ? cause.message : "请重新加载配置"}`; }
    finally { saving.value = false; }
  }

  async function save(activate: boolean) {
    if (saving.value || !draft.value || saved.value) return;
    if (!model.pkg.value) { error.value = "请先在顶部新建或选择测试包"; return; }
    if (jsonError.value) { error.value = jsonError.value; return; }
    if (activate && conditional.value) { error.value = "条件分支接口请仅保存，再到响应规则中选择该场景"; return; }
    saving.value = true;
    error.value = "";
    try {
      saved.value = await model.runAdminRequest(() => client.saveCapture(captureId, {
        ...form, apiId: form.apiId || undefined, packageId: model.pkg.value!.id, activate,
      }));
    } catch (cause) { error.value = cause instanceof Error ? cause.message : "场景保存失败"; }
    finally { saving.value = false; }
    if (saved.value) await viewSaved();
  }

  return { open, loading, saving, error, draft, saved, form, selectedApi, conditional, dirty, jsonError, readLocation, load, close, save, viewSaved };
}
