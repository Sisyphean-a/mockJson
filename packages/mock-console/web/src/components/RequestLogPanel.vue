<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ConsoleController } from "../console-controller";
import type { RequestLog } from "../mock-admin-client";

type RequestLogPanelController = Pick<ConsoleController, "pkg" | "logs" | "logsLoading" | "logsError" | "refreshLogs" | "clearLogs" | "selectApi" | "showWorkspace">;
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
const selectedApi = computed(() => {
  const apiId = selectedLog.value?.apiId;
  return apiId ? c.pkg.value?.apis.find((api) => api.id === apiId) || null : null;
});

const queryParams = computed(() => selectedLog.value
  ? [...new URL(selectedLog.value.url, "http://mock.local").searchParams.entries()]
  : []);
const requestHeaders = computed(() => Object.entries(selectedLog.value?.request.headers || {}));

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

function bodyText(body: string | null) {
  if (!body) return "（空请求体）";
  try {
    return JSON.stringify(JSON.parse(body), null, 4);
  } catch {
    return body;
  }
}

function responseText(log: RequestLog) {
  if (log.response.body === null) return `非文本响应，无法直接预览（${formatBytes(log.response.byteLength)}）`;
  return log.response.body ? bodyText(log.response.body) : "（空响应体）";
}

function sourceLabel(source: RequestLog["source"]) {
  return sourceLabels[source];
}

function passReasonLabel(reason: RequestLog["passReason"]) {
  return reason ? passReasonLabels[reason] : "已放行";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const url = log.url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  const host = log.host?.trim() || "";
  if (!host) return url || "（未知地址）";
  return `${host}${url.startsWith("/") || host.endsWith("/") ? "" : "/"}${url}`;
}

function openSelectedApi() {
  if (!selectedApi.value || !c.selectApi(selectedApi.value)) return;
  c.showWorkspace();
}

function clearFilters() {
  filter.value = "all";
  sourceFilter.value = "all";
  search.value = "";
}
</script>

<template>
  <section class="request-log-panel" aria-label="请求日志" role="tabpanel">
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
      <span class="log-retention">自动刷新 · 最近 200 条</span>
      <button class="secondary" :disabled="c.logsLoading.value" @click="c.refreshLogs">刷新</button>
      <button class="secondary danger-action" :disabled="!c.logs.value.length || c.logsLoading.value" @click="c.clearLogs">清空日志</button>
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
            <span class="log-row-result" :title="[log.apiName || '未命中逻辑接口', log.scenarioName, formatStatus(log.status)].filter(Boolean).join(' · ')">
              <span :class="['log-match', { unmatched: !log.apiName }]">{{ log.apiName ? `命中：${log.apiName}` : "未命中" }}</span>
              <span v-if="log.scenarioName" class="log-row-scenario">· {{ log.scenarioName }}</span>
              <span class="log-status" :class="{ failed: log.status >= 400 }">{{ formatStatus(log.status) }}</span>
            </span>
            <time :datetime="log.timestamp">{{ formatTime(log.timestamp) }}</time>
          </div>
          <code class="log-url">{{ endpoint(log) }}</code>

        </button>
      </div>

      <div v-if="selectedLog" class="log-detail">
        <div class="log-detail-head">
          <div class="log-detail-title">
            <span class="panel-context">当前请求</span>
            <h2>{{ selectedLog.method }} 请求</h2>
            <code class="log-detail-url">{{ endpoint(selectedLog) }}</code>
          </div>
          <div class="log-detail-badges">
            <span :class="['log-source', `source-${selectedLog.source}`]">{{ sourceLabel(selectedLog.source) }}</span>
            <span :class="['log-outcome', `outcome-${selectedLog.outcome}`]">{{ outcomeLabel(selectedLog.outcome) }}</span>
            <span :class="['log-status', { failed: selectedLog.status >= 400 }]">{{ formatStatus(selectedLog.status) }}</span>
            <span class="log-duration">{{ formatDuration(selectedLog.durationMs) }}</span>
          </div>
        </div>

        <div class="log-detail-api">
          <div class="log-api-identity">
            <span>命中逻辑接口</span>
            <b>{{ selectedLog.apiName || "未命中" }}</b>
          </div>
          <div class="log-scenario-identity">
            <span>响应场景</span>
            <b>{{ selectedLog.scenarioName || "—" }}</b>
          </div>
          <button v-if="selectedApi" class="text-action" type="button" @click="openSelectedApi">查看接口配置</button>
        </div>

        <p v-if="selectedLog.passReason" class="log-pass-reason">放行原因：{{ passReasonLabel(selectedLog.passReason) }}</p>
        <div v-if="selectedLog.error" class="log-failure" role="alert">
          <span>错误信息</span>
          <code>{{ selectedLog.error }}</code>
        </div>

        <section class="log-request" aria-label="请求数据">
          <div class="log-section-head"><h3>请求数据</h3><span>参数与请求头</span></div>
          <div class="log-request-group">
            <h4>URL 参数 <span>{{ queryParams.length }}</span></h4>
            <div v-if="queryParams.length" class="log-fields">
              <div v-for="([name, value], index) in queryParams" :key="index" class="log-field">
                <code>{{ name }}</code><span>{{ value || '（空值）' }}</span>
              </div>
            </div>
            <p v-else class="log-no-data">无 URL 参数</p>
          </div>
          <div class="log-request-group">
            <h4>请求头 <span>{{ requestHeaders.length }}</span></h4>
            <div v-if="requestHeaders.length" class="log-fields">
              <div v-for="([name, value]) in requestHeaders" :key="name" class="log-field">
                <code>{{ name }}</code><span>{{ value }}</span>
              </div>
            </div>
            <p v-else class="log-no-data">无可用请求头</p>
          </div>
          <div v-if="selectedLog.request.body.byteLength || selectedLog.request.body.body === null" class="log-request-group">
            <h4>请求体 <span v-if="selectedLog.request.body.byteLength">{{ formatBytes(selectedLog.request.body.byteLength) }}</span></h4>
            <pre v-if="selectedLog.request.body.body !== null" class="log-request-body">{{ selectedLog.request.body.body }}</pre>
            <p v-else class="log-no-data">{{ selectedLog.source === 'extension'
              ? selectedLog.request.body.truncated ? '请求体超过本地判定接口容量，未记录；Mock 判定不受影响。' : '此请求体无法读取；Mock 判定不受影响。'
              : '非文本请求体，无法预览' }}</p>
            <p v-if="selectedLog.source === 'proxy' && selectedLog.request.body.truncated" class="log-note">请求体仅展示前 32 KB；转发内容不受影响。</p>
          </div>
        </section>

        <details :key="selectedLog.id" class="log-response">
          <summary class="log-response-head">
            <span class="log-expand-icon" aria-hidden="true">›</span>
            <span class="log-response-title">响应数据</span>
            <span class="log-response-size">{{ formatBytes(selectedLog.response.byteLength) }}</span>
            <span v-if="selectedLog.response.truncated" class="log-truncated">已截断预览</span>
          </summary>
          <div class="log-response-content">
            <p v-if="selectedLog.response.contentType" class="log-response-type">{{ selectedLog.response.contentType }}</p>
            <pre class="log-response-body">{{ responseText(selectedLog) }}</pre>
            <p v-if="selectedLog.response.truncated" class="log-note">响应体较大，仅展示前 32 KB；代理仍按原样继续转发。</p>
          </div>
        </details>
      </div>
      <div v-else class="log-detail-empty">选择一条日志查看完整响应数据</div>
    </div>
  </section>
</template>
