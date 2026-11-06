import { computed, ref, type Ref } from "vue";
import { DEFAULT_GLOBAL_DELAY, type GlobalDelay, type State } from "../../shared/types";
import type { MockAdminClient } from "./mock-admin-client";

const MAX_DELAY_MS = 30000;

function isDelay(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_DELAY_MS;
}

function delayLabel(delay: GlobalDelay) {
  if (delay.mode === "fixed") return `${delay.fixedMs}ms`;
  if (delay.mode === "random") return `${delay.minMs}–${delay.maxMs}ms`;
  return "";
}

function delaySummary(delay: GlobalDelay) {
  if (delay.mode === "fixed") return `固定 ${delay.fixedMs} ms`;
  if (delay.mode === "random") return `随机 ${delay.minMs}–${delay.maxMs} ms`;
  return "关闭";
}

export function useGlobalDelay(client: MockAdminClient, state: Ref<State>, notice: (message: string) => void) {
  const showGlobalDelay = ref(false);
  const globalDelaySaving = ref(false);
  const globalDelayError = ref("");
  const globalDelayDraft = ref<GlobalDelay>({ ...DEFAULT_GLOBAL_DELAY });

  const globalDelay = computed(() => state.value.globalDelay ?? DEFAULT_GLOBAL_DELAY);
  const globalDelayActive = computed(() => globalDelay.value.mode !== "off");
  const globalDelayLabel = computed(() => delayLabel(globalDelay.value));
  const globalDelayTitle = computed(() => `全局延迟：${delaySummary(globalDelay.value)}`);

  function openGlobalDelay() {
    globalDelayDraft.value = { ...globalDelay.value };
    globalDelayError.value = "";
    showGlobalDelay.value = true;
  }

  function closeGlobalDelay() {
    if (globalDelaySaving.value) return;
    showGlobalDelay.value = false;
    globalDelayError.value = "";
  }

  async function saveGlobalDelay() {
    if (globalDelaySaving.value) return;
    const draft = globalDelayDraft.value;
    if (draft.mode === "fixed" && !isDelay(draft.fixedMs)) {
      globalDelayError.value = "固定延迟必须是 0 到 30000 毫秒的整数";
      return;
    }
    if (draft.mode === "random") {
      if (!isDelay(draft.minMs) || !isDelay(draft.maxMs)) {
        globalDelayError.value = "随机延迟必须是 0 到 30000 毫秒的整数";
        return;
      }
      if (draft.minMs > draft.maxMs) {
        globalDelayError.value = "随机延迟的最小值不能大于最大值";
        return;
      }
    }
    // Rule: 只校验当前方式；关闭或切换方式时，隐藏字段的残留输入不能阻塞保存。
    const current = globalDelay.value;
    const fixedMs = isDelay(draft.fixedMs) ? Number(draft.fixedMs) : current.fixedMs;
    const minMs = isDelay(draft.minMs) ? Number(draft.minMs) : current.minMs;
    const maxMs = isDelay(draft.maxMs) ? Number(draft.maxMs) : current.maxMs;
    const payload: GlobalDelay = {
      mode: draft.mode,
      fixedMs,
      minMs: Math.min(minMs, maxMs),
      maxMs: Math.max(minMs, maxMs),
    };
    globalDelaySaving.value = true;
    globalDelayError.value = "";
    try {
      const saved = await client.updateGlobalDelay(payload);
      state.value.globalDelay = saved;
      showGlobalDelay.value = false;
      notice(saved.mode === "off" ? "已关闭全局延迟" : `全局延迟已设为${delaySummary(saved)}`);
    } catch (error) {
      globalDelayError.value = error instanceof Error ? error.message : "全局延迟保存失败";
    } finally {
      globalDelaySaving.value = false;
    }
  }

  return {
    showGlobalDelay,
    globalDelayDraft,
    globalDelaySaving,
    globalDelayError,
    globalDelayActive,
    globalDelayLabel,
    globalDelayTitle,
    openGlobalDelay,
    closeGlobalDelay,
    saveGlobalDelay,
  };
}
