import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { MockAdminClient, RequestLog } from "./mock-admin-client";

type RunAdminRequest = <T>(operation: () => Promise<T>) => Promise<T>;

export function useRequestLogs(client: MockAdminClient, runAdminRequest: RunAdminRequest) {
  const activeView = ref<"workspace" | "logs">("workspace");
  const logs = shallowRef<RequestLog[]>([]);
  const logsLoading = ref(false);
  const logsError = ref("");
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let requestInFlight = false;

  async function refreshLogs() {
    if (requestInFlight) return;
    requestInFlight = true;
    logsLoading.value = true;
    try {
      const result = await runAdminRequest(() => client.getLogs());
      logs.value = result.logs;
      logsError.value = "";
    } catch (error) {
      logsError.value = error instanceof Error ? error.message : "无法加载请求日志";
    } finally {
      requestInFlight = false;
      logsLoading.value = false;
    }
  }

  async function clearLogs() {
    if (requestInFlight || !window.confirm("确定清空最近的请求日志吗？清空后无法恢复。")) return false;
    requestInFlight = true;
    logsLoading.value = true;
    try {
      await runAdminRequest(() => client.clearLogs());
      logs.value = [];
      logsError.value = "";
      return true;
    } catch (error) {
      logsError.value = error instanceof Error ? error.message : "无法清空请求日志";
      return false;
    } finally {
      requestInFlight = false;
      logsLoading.value = false;
    }
  }

  function showLogs() {
    activeView.value = "logs";
    void refreshLogs();
  }

  function showWorkspace() {
    activeView.value = "workspace";
  }

  onMounted(() => {
    refreshTimer = setInterval(() => {
      if (activeView.value === "logs") void refreshLogs();
    }, 2000);
  });

  onBeforeUnmount(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  return {
    activeView,
    logs,
    logsLoading,
    logsError,
    refreshLogs,
    clearLogs,
    showLogs,
    showWorkspace,
  };
}
