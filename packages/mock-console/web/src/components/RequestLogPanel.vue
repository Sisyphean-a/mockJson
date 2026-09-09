<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ConsoleController } from "../console-controller";
import type { RequestLog } from "../mock-admin-client";

type RequestLogPanelController = Pick<ConsoleController, "pkg" | "logs" | "logsLoading" | "logsError" | "refreshLogs" | "clearLogs">;
const { controller: c } = defineProps<{ controller: RequestLogPanelController }>();

type LogFilter = "all" | RequestLog["outcome"];
type SourceFilter = "all" | RequestLog["source"];

const filter = ref<LogFilter>("all");
const sourceFilter = ref<SourceFilter>("all");
const search = ref("");
const selectedId = ref<string | null>(null);

const packageLogs = computed(() => {
  const packageId = c.pkg.value?.id || null;
  return c.logs.value.filter((log) => log.packageId === packageId);
});

const filteredLogs = computed(() => {
  const query = search.value.trim().toLowerCase();
  return packageLogs.value.filter((log) => {
    if (filter.value !== "all" && log.outcome !== filter.value) return false;
    if (sourceFilter.value !== "all" && log.source !== sourceFilter.value) return false;
    if (!query) return true;
    return [log.method, log.host, log.url, log.apiName, log.scenarioName]
      .filter((item): item is string => Boolean(item))
      .some((item) => item.toLowerCase().includes(query));
  });
});

const selectedLog = computed(() =>
  filteredLogs.value.find((log) => log.id === selectedId.value) || filteredLogs.value[0] || null,
);

const responseSummaryCache = new WeakMap<RequestLog, { body: string; summary: string }>();

watch(filteredLogs, (items) => {
  if (!items.some((log) => log.id === selectedId.value)) selectedId.value = items[0]?.id || null;
}, { immediate: true });

const outcomeLabels: Record<RequestLog["outcome"], string> = {
  mocked: "Mock 命中",
  forwarded: "已转发",
  unmatched: "未命中",
  passed: "扩展放行",
  error: "代理错误",
};

const sourceLabels: Record<RequestLog["source"], string> = {
  proxy: "Proxy",
  extension: "Chrome 扩展",
};

const passReasonLabels: Record<NonNullable<RequestLog["passReason"]>, string> = {
  unmatched: "未命中规则",
  disabled: "扩展已暂停",
  "invalid-request": "请求无效",
  "unsupported-status": "状态码暂不支持",
};

function outcomeLabel(outcome: RequestLog["outcome"]) {
  return outcomeLabels[outcome];
}

function responseText(log: RequestLog) {
  if (log.response.body === null) return `非文本响应，无法直接预览（${formatBytes(log.response.byteLength)}）`;
  if (!log.response.body) return "（空响应体）";
  try {
    return JSON.stringify(JSON.parse(log.response.body), null, 4);
  } catch {
    return log.response.body;
  }
}

function sourceLabel(source: RequestLog["source"]) {
  return sourceLabels[source];
}

function passReasonLabel(reason: RequestLog["passReason"]) {
  return reason ? passReasonLabels[reason] : "已放行";
}

function responseSummary(log: RequestLog) {
  if (log.outcome === "passed") return `浏览器原生请求已放行 · ${passReasonLabel(log.passReason)}`;
  if (log.source === "extension" && log.outcome === "unmatched") return "扩展判定未命中，浏览器将直接请求原始地址";
  if (log.response.body === null) return `非文本响应 · ${formatBytes(log.response.byteLength)}`;
  const cached = responseSummaryCache.get(log);
  if (cached?.body === log.response.body) return cached.summary;
  const summary = log.response.body.replace(/\s+/g, " ").trim() || "空响应体";
  const value = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
  responseSummaryCache.set(log, { body: log.response.body, summary: value });
  return value;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: number) {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}

function formatStatus(value: number) {
  return value > 0 ? String(value) : "—";
}

function endpoint(log: RequestLog) {
  return `${log.host ? `${log.host}` : ""}${log.url}` || "（未知地址）";
}

function clearFilters() {
  filter.value = "all";
  sourceFilter.value = "all";
  search.value = "";
}
</script>

<template>
  <section class="request-log-panel" aria-labelledby="request-log-title" role="tabpanel">
    <div class="log-panel-head">
      <div>
        <span class="panel-context">运行观测 · 当前测试包</span>
        <h1 id="request-log-title">请求日志</h1>
        <p>实时查看请求命中的逻辑接口、响应场景和实际返回数据</p>
      </div>
      <div class="log-panel-actions">
        <span class="log-retention">自动刷新 · 最近 200 条</span>
        <button class="secondary" :disabled="c.logsLoading.value" @click="c.refreshLogs">刷新</button>
        <button class="secondary danger-action" :disabled="!c.logs.value.length || c.logsLoading.value" @click="c.clearLogs">清空日志</button>
      </div>
    </div>

    <div class="log-toolbar">
      <label class="log-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="search" aria-label="搜索请求日志" placeholder="搜索 URL 或逻辑接口…" />
      </label>
      <label class="log-filter">
        <span>结果</span>
        <select v-model="filter" aria-label="按请求结果筛选">
          <option value="all">全部</option>
          <option value="mocked">Mock 命中</option>
          <option value="forwarded">已转发</option>
          <option value="unmatched">未命中</option>
          <option value="passed">扩展放行</option>
          <option value="error">代理错误</option>
        </select>
      </label>
      <label class="log-filter">
        <span>来源</span>
        <select v-model="sourceFilter" aria-label="按请求来源筛选">
          <option value="all">全部</option>
          <option value="extension">Chrome 扩展</option>
          <option value="proxy">Proxy / Reqable</option>
        </select>
      </label>
      <span class="log-count">{{ filteredLogs.length }} 条</span>
    </div>

    <div v-if="c.logsError.value" class="log-error" role="alert">
      <span>{{ c.logsError.value }}</span>
      <button class="text-action" @click="c.refreshLogs">重试</button>
    </div>

    <div class="log-content">
      <div class="log-list" aria-label="请求日志列表">
        <div v-if="c.logsLoading.value && !packageLogs.length" class="log-empty" role="status">正在加载请求日志…</div>
        <div v-else-if="!filteredLogs.length && packageLogs.length" class="log-empty">
          <p>没有符合条件的日志</p>
          <button class="text-action" @click="clearFilters">清除筛选</button>
        </div>
        <div v-else-if="!filteredLogs.length" class="log-empty">
          <p>还没有请求日志</p>
          <span>重新发起一次接入 Mock 服务的请求，这里会显示命中接口和响应数据。</span>
        </div>
        <button
          v-for="log in filteredLogs"
          :key="log.id"
          :class="['log-row', { selected: log.id === selectedLog?.id }]"
          type="button"
          @click="selectedId = log.id"
        >
          <div class="log-row-head">
            <span class="log-method">{{ log.method }}</span>
            <span :class="['log-source', `source-${log.source}`]">{{ sourceLabel(log.source) }}</span>
            <span :class="['log-outcome', `outcome-${log.outcome}`]">{{ outcomeLabel(log.outcome) }}</span>
            <time>{{ formatTime(log.timestamp) }}</time>
          </div>
          <code class="log-url">{{ endpoint(log) }}</code>
          <div class="log-row-meta">
            <strong>{{ log.apiName || "未命中逻辑接口" }}</strong>
            <span v-if="log.scenarioName">· {{ log.scenarioName }}</span>
            <span class="log-status" :class="{ failed: log.status >= 400 }">{{ formatStatus(log.status) }}</span>
          </div>
          <p class="log-preview">{{ responseSummary(log) }}</p>
        </button>
      </div>

      <div v-if="selectedLog" class="log-detail">
        <div class="log-detail-head">
          <div>
            <span class="panel-context">请求详情</span>
            <h2>{{ selectedLog.apiName || "未命中逻辑接口" }}</h2>
          </div>
          <div class="log-detail-badges">
            <span :class="['log-source', `source-${selectedLog.source}`]">{{ sourceLabel(selectedLog.source) }}</span>
            <span :class="['log-outcome', `outcome-${selectedLog.outcome}`]">{{ outcomeLabel(selectedLog.outcome) }}</span>
          </div>
        </div>

        <div class="log-detail-grid">
          <div><span>请求来源</span><b>{{ sourceLabel(selectedLog.source) }}</b></div>
          <div><span>请求地址</span><code>{{ endpoint(selectedLog) }}</code></div>
          <div><span>请求时间</span><b>{{ formatDateTime(selectedLog.timestamp) }}</b></div>
          <div><span>HTTP 状态</span><b :class="{ failed: selectedLog.status >= 400 }">{{ formatStatus(selectedLog.status) }}</b></div>
          <div><span>耗时</span><b>{{ formatDuration(selectedLog.durationMs) }}</b></div>
          <div v-if="selectedLog.passReason"><span>放行原因</span><b>{{ passReasonLabel(selectedLog.passReason) }}</b></div>
          <div><span>响应场景</span><b>{{ selectedLog.scenarioName || "—" }}</b></div>
          <div><span>响应类型</span><b>{{ selectedLog.response.contentType || "未知" }}</b></div>
        </div>

        <div v-if="selectedLog.error" class="log-failure" role="alert">
          <span>错误信息</span>
          <code>{{ selectedLog.error }}</code>
        </div>

        <div class="log-response-head">
          <div><h3>响应数据</h3><span>{{ formatBytes(selectedLog.response.byteLength) }}</span></div>
          <span v-if="selectedLog.response.truncated" class="log-truncated">已截断预览</span>
        </div>
        <pre class="log-response-body">{{ responseText(selectedLog) }}</pre>
        <p v-if="selectedLog.response.truncated" class="log-note">响应体较大，仅展示前 32 KB；代理仍按原样继续转发。</p>
      </div>
      <div v-else class="log-detail-empty">选择一条日志查看完整响应数据</div>
    </div>
  </section>
</template>
