import { computed, ref, toRaw, watch } from "vue";
import type { ResponseBranch, ResponseCondition, ResponseSelection } from "../../shared/types";
import { evaluateSelection, scenarioReferences, selectionFor, SelectionValidationError, validateSelection, type SelectionResult } from "../../shared/response-selection";
import type { MockAdminClient, Scene } from "./mock-admin-client";
import type { useMockState } from "./use-mock-state";

type Draft = { selection: ResponseSelection; activeScenarioId: string | null };
const clone = <T>(value: T): T => structuredClone(toRaw(value));
// Rule: 无效数字不能被 JSON 转成 null，否则会把错误输入误认成已保存的空值。
const signature = (value: unknown) => JSON.stringify(value, (_key, item) =>
  typeof item === "number" && !Number.isFinite(item) ? { invalidNumber: String(item) } : item);

export function useResponseSelection(client: MockAdminClient, model: ReturnType<typeof useMockState>) {
  const responseDraft = ref<Draft>({ selection: { mode: "fixed", branches: [], fallback: { enabled: false, scenarioId: null } }, activeScenarioId: null });
  const responseEditorMode = ref<ResponseSelection["mode"]>("fixed");
  const responseModeInactive = computed(() => responseEditorMode.value !== (model.api.value?.responseSelection?.mode ?? "fixed"));
  const baseline = ref("");
  const responseDirty = computed(() => signature(responseDraft.value) !== baseline.value);
  const responseSaving = ref(false);
  const responseError = ref("");
  const responseErrorPath = ref("");
  const rulesOpen = ref(false);
  const expandedBranch = ref<string | null>(null);
  const trialOpen = ref(false);
  const trialHeaders = ref("{}");
  const trialBody = ref("{}");
  const trialAvailability = ref("available");
  const trialError = ref("");
  const trialResult = ref<SelectionResult | null>(null);
  const trialAt = ref("");
  const trialSelection = ref<ResponseSelection | null>(null);
  const fingerprint = computed(() => signature([responseEditorMode.value, responseDraft.value, trialHeaders.value, trialBody.value, trialAvailability.value]));
  const trialStale = computed(() => !!trialResult.value && fingerprint.value !== trialAt.value);
  const leavePrompt = ref(false);
  let pendingLeave: (() => unknown) | null = null;

  function resetResponseDraft() {
    const api = model.api.value;
    responseDraft.value = api ? { selection: clone(selectionFor(api)), activeScenarioId: api.activeScenarioId } :
      { selection: { mode: "fixed", branches: [], fallback: { enabled: false, scenarioId: null } }, activeScenarioId: null };
    baseline.value = signature(responseDraft.value);
    responseError.value = "";
    responseErrorPath.value = "";
  }
  watch(() => model.api.value?.id, () => {
    resetResponseDraft();
    responseEditorMode.value = responseDraft.value.selection.mode;
    rulesOpen.value = responseEditorMode.value === "conditional";
    expandedBranch.value = null;
    trialOpen.value = false;
    trialResult.value = null;
  }, { immediate: true, flush: "sync" });
  watch(() => model.api.value?.activeScenarioId, () => { if (!responseDirty.value) resetResponseDraft(); }, { flush: "sync" });

  function guardResponseLeave(action: () => unknown) {
    if (responseSaving.value) return false;
    if (!responseDirty.value) { void action(); return true; }
    pendingLeave = action;
    leavePrompt.value = true;
    return false;
  }
  async function resolveResponseLeave(choice: "save" | "discard" | "cancel") {
    if (responseSaving.value) return;
    if (choice === "save" && !await saveResponseSelection()) return;
    if (choice === "discard") resetResponseDraft();
    const action = pendingLeave;
    pendingLeave = null;
    leavePrompt.value = false;
    if (choice !== "cancel") await action?.();
  }
  function setResponseMode(mode: ResponseSelection["mode"]) {
    if (responseSaving.value || mode === responseEditorMode.value) return;
    // Rule: 工作区切换只改变查看对象；两边草稿保留，明确保存/启用后才改变生效模式。
    responseEditorMode.value = mode;
    rulesOpen.value = mode === "conditional";
  }
  async function saveResponseSelection() {
    const api = model.api.value;
    if (!api || responseSaving.value) return false;
    responseError.value = ""; responseErrorPath.value = "";
    try {
      const draft = clone(responseDraft.value);
      draft.selection.mode = responseEditorMode.value;
      validateSelection(draft.selection, api.scenarios.map((s) => s.id));
      responseSaving.value = true;
      const saved = await model.runAdminRequest(() => client.saveResponseSelection(api.id, draft.selection, draft.activeScenarioId));
      // Rule: 只更新选择配置，不覆盖独立自动保存的场景内容和列表顺序。
      const current = model.state.value.packages.flatMap((p) => p.apis).find((item) => item.id === api.id);
      if (current) {
        current.responseSelection = saved.responseSelection;
        current.activeScenarioId = saved.activeScenarioId;
      }
      responseDraft.value.selection.mode = draft.selection.mode;
      baseline.value = signature(draft);
      return true;
    } catch (error) {
      responseError.value = error instanceof Error ? error.message : "保存失败，请重试";
      responseErrorPath.value = error instanceof SelectionValidationError ? error.path : "";
      const index = responseErrorPath.value.match(/^branches\.(\d+)/)?.[1];
      if (index) expandedBranch.value = responseDraft.value.selection.branches[Number(index)]?.id ?? null;
      return false;
    } finally { responseSaving.value = false; }
  }
  function addBranch() {
    const branch: ResponseBranch = { id: crypto.randomUUID(), name: "新分支", matchMode: "OR", conditions: [newCondition()], scenarioId: "" };
    responseDraft.value.selection.branches.push(branch);
    expandedBranch.value = branch.id;
  }
  function newCondition(): ResponseCondition {
    return { id: crypto.randomUUID(), source: "body", field: "", operator: "equals", value: "" };
  }
  function moveBranch(index: number, delta: number) {
    const branches = responseDraft.value.selection.branches;
    const target = index + delta;
    if (target < 0 || target >= branches.length) return;
    [branches[index], branches[target]] = [branches[target], branches[index]];
  }
  function deleteBranch(branch: ResponseBranch) {
    if (!window.confirm(`确定删除分支「${branch.name}」吗？目标场景不会删除。`)) return;
    responseDraft.value.selection.branches = responseDraft.value.selection.branches.filter((b) => b.id !== branch.id);
  }
  async function createBranchScene(branch: ResponseBranch, name: string) {
    const api = model.api.value;
    if (!api) return;
    const scene = await model.runAdminRequest(() => client.createScenario(api.id, { name, responseBody: {}, activate: false }));
    api.scenarios.push(scene);
    branch.scenarioId = scene.id;
  }
  function responseReferences(scene: Scene) {
    const saved = model.api.value?.responseSelection;
    const draftRefs = saved || responseEditorMode.value === "conditional" || responseDirty.value || responseDraft.value.selection.branches.length
      ? scenarioReferences(responseDraft.value.selection, scene.id) : [];
    return [...new Set([...(saved ? scenarioReferences(saved, scene.id) : []), ...draftRefs])];
  }
  function runTrial() {
    trialError.value = "";
    try {
      validateSelection(responseDraft.value.selection, model.api.value?.scenarios.map((s) => s.id) ?? []);
      let headers: unknown;
      try { headers = JSON.parse(trialHeaders.value); }
      catch { throw new Error("请求头不是有效 JSON，请填写名称和值均为文本的 JSON 对象"); }
      if (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((v) => typeof v !== "string"))
        throw new Error("请求头请填写 JSON 对象，值使用文本");
      const selection = { ...clone(responseDraft.value.selection), mode: responseEditorMode.value };
      trialResult.value = evaluateSelection(selection, responseDraft.value.activeScenarioId, {
        headers: headers as Record<string, string>,
        ...(trialAvailability.value === "available" ? { body: trialBody.value } : trialAvailability.value === "absent" ? {} : { bodyUnavailable: trialAvailability.value }),
      });
      trialSelection.value = selection;
      trialAt.value = fingerprint.value;
    } catch (error) { trialError.value = error instanceof Error ? error.message : "无法试算"; }
  }
  return {
    responseDraft, responseEditorMode, responseModeInactive, responseDirty, responseSaving, responseError, responseErrorPath, resetResponseDraft,
    rulesOpen, expandedBranch, trialOpen, trialHeaders, trialBody, trialAvailability, trialResult, trialSelection, trialStale, trialError,
    leavePrompt, guardResponseLeave, resolveResponseLeave, setResponseMode, saveResponseSelection,
    addBranch, newCondition, moveBranch, deleteBranch, createBranchScene, responseReferences, runTrial,
  };
}
