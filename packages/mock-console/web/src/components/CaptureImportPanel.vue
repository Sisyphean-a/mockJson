<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Pkg } from "../mock-admin-client";
import type { useCaptureImport } from "../use-capture-import";
import JsonEditor from "./JsonEditor.vue";

const { controller: c, pkg } = defineProps<{ controller: ReturnType<typeof useCaptureImport>; pkg?: Pkg }>();
defineEmits<{ close: []; createPackage: [] }>();

const activate = ref(false);
const requestUrl = computed(() => {
  const raw = c.draft.value?.request.url || "";
  const url = new URL(raw);
  return { host: url.host, path: url.pathname };
});
const originalStatus = computed(() => c.draft.value?.response.status || 0);
const statusTone = computed(() => {
  if (originalStatus.value >= 500) return "danger";
  if (originalStatus.value >= 300) return "warning";
  return "success";
});
const targetLabel = computed(() => c.selectedApi.value?.name || c.form.apiName || "新建逻辑接口");
const activationNote = computed(() => {
  const api = c.selectedApi.value;
  if (c.conditional.value) return "条件分支接口只能保存，之后在响应规则中引用此场景。";
  if (!activate.value) return "只创建场景，不改变当前 Mock。";
  if (!api) return "新接口将启用，并把固定响应切换到此场景。";
  if (api.passthrough) return "该接口当前为放行状态；启用后会解除放行并切换固定响应。";
  if (!api.enabled) return "该接口当前已停用；启用后会重新启用并切换固定响应。";
  return "启用后会把该接口的固定响应切换到本场景。";
});
const saveError = computed(() => c.error.value && c.error.value !== c.jsonError.value ? c.error.value : "");
const canActivate = computed(() => !c.conditional.value && !c.saving.value);
const canSave = computed(() => !c.saving.value && !c.jsonError.value && Boolean(pkg));

watch(() => c.conditional.value, (conditional) => {
  if (conditional) activate.value = false;
});

watch(() => c.draft.value?.id, () => {
  activate.value = false;
});

// Rule: 只同步自动生成的场景名，用户自行命名的场景保持不变。
watch(() => c.form.status, (status) => {
  if (!Number.isFinite(status)) return;
  if (!c.form.scenarioName.trim() || /^响应 \d+$/.test(c.form.scenarioName)) c.form.scenarioName = `响应 ${status}`;
});

function submit() {
  if (!canSave.value) return;
  c.save(activate.value);
}
</script>

<template>
  <section class="capture-import" aria-labelledby="capture-title" :aria-busy="c.loading.value || c.saving.value">
    <div v-if="c.loading.value" class="capture-state" role="status" aria-live="polite">
      <div class="capture-state-mark" aria-hidden="true">✦</div>
      <h1 id="capture-title">正在读取响应草稿</h1>
      <p>草稿由浏览器扩展交接而来，只在服务内存中保留 15 分钟。</p>
    </div>

    <div v-else-if="!c.draft.value" class="capture-state">
      <div class="capture-state-mark" aria-hidden="true">↻</div>
      <h1 id="capture-title">响应草稿不可用</h1>
      <p role="alert">{{ c.error.value || "草稿可能已过期或服务已重启，请从浏览器扩展重新发送。" }}</p>
      <div class="capture-state-actions">
        <button class="secondary" @click="c.load">重新读取</button>
        <button class="secondary" @click="$emit('close')">返回配置</button>
      </div>
    </div>

    <div v-else-if="c.saved.value" class="capture-state">
      <div class="capture-state-mark is-success" aria-hidden="true">✓</div>
      <h1 id="capture-title">响应已保存{{ c.saved.value.activated ? "并启用" : "" }}</h1>
      <p>{{ c.saved.value.activated ? "接口已启用，固定响应已切换到新场景。" : "场景已创建，当前 Mock 未改变。" }}</p>
      <p v-if="c.error.value" class="capture-state-error" role="alert">{{ c.error.value }}</p>
      <div class="capture-state-actions">
        <button class="primary" :disabled="c.saving.value" @click="c.viewSaved">查看已保存场景</button>
        <button class="secondary" @click="$emit('close')">返回配置</button>
      </div>
    </div>

    <form v-else class="capture-form" @submit.prevent="submit">
      <header class="capture-header">
        <div class="capture-title-block">
          <p class="capture-kicker">浏览器扩展 · Mock Console</p>
          <h1 id="capture-title">保存为 Mock 场景</h1>
        </div>
        <div class="capture-source" aria-label="来源请求">
          <span class="capture-method">{{ c.draft.value.request.method }}</span>
          <code class="capture-url" :title="c.draft.value.request.url">
            <span class="capture-host">{{ requestUrl.host }}</span>{{ requestUrl.path }}
          </code>
          <span :class="['capture-source-status', `is-${statusTone}`]">
            <i aria-hidden="true"></i>
            原始响应 <strong>{{ originalStatus }}</strong>
          </span>
        </div>
        <button class="secondary" type="button" :disabled="c.saving.value" @click="$emit('close')">返回配置</button>
      </header>

      <div v-if="!pkg" class="capture-state capture-inline-state">
        <h2>先创建测试包</h2>
        <p>响应草稿会保留在本次会话中，创建测试包后即可继续保存。</p>
        <div class="capture-state-actions">
          <button class="primary" type="button" @click="$emit('createPackage')">新建测试包</button>
          <button class="secondary" type="button" @click="$emit('close')">返回配置</button>
        </div>
      </div>

      <template v-else>
        <div class="capture-layout">
          <section class="capture-editor-card" aria-labelledby="capture-response-title">
            <header class="capture-card-head">
              <div>
                <h2 id="capture-response-title">响应内容</h2>
                <p>仅保存 JSON 正文，不包含 Cookie 和请求头</p>
              </div>
            </header>
            <div class="capture-editor-body" :class="{ 'is-saving': c.saving.value }" :inert="c.saving.value">
              <JsonEditor :value="c.form.responseBody" :error="Boolean(c.jsonError.value)" @update:value="c.form.responseBody = $event" @save="submit" />
            </div>
          </section>

          <section class="capture-settings" aria-labelledby="capture-settings-title">
            <header class="capture-card-head">
              <div>
                <h2 id="capture-settings-title">保存设置</h2>
                <p>保存到「{{ pkg.name }}」· 顶部可切换</p>
              </div>
            </header>

            <fieldset class="capture-settings-body" :disabled="c.saving.value">
              <section class="capture-group">
                <h3>目标位置</h3>

                <label class="capture-label" for="capture-api">接口</label>
                <select id="capture-api" v-model="c.form.apiId">
                  <option value="">＋ 新建逻辑接口</option>
                  <option v-for="api in pkg.apis" :key="api.id" :value="api.id">{{ api.name }}{{ api.archived ? "（已归档）" : "" }}</option>
                </select>

                <template v-if="!c.form.apiId">
                  <label class="capture-label" for="capture-api-name">接口名称</label>
                  <input id="capture-api-name" v-model="c.form.apiName" required maxlength="200" />
                  <div class="capture-match">
                    <span class="capture-match-label">自动匹配</span>
                    <code :title="`${c.draft.value.request.method} ${requestUrl.host}${requestUrl.path}`"><b>{{ c.draft.value.request.method }}</b> {{ requestUrl.host }}{{ requestUrl.path }}</code>
                    <small>忽略查询参数</small>
                  </div>
                </template>
                <p v-else class="capture-note">追加到已有接口，不改动匹配规则、响应模式和其他场景。</p>
              </section>

              <section class="capture-group">
                <h3>场景</h3>
                <label class="capture-label" for="capture-scene">场景名称</label>
                <input id="capture-scene" v-model="c.form.scenarioName" required maxlength="200" />

                <div class="capture-numbers">
                  <div class="capture-field">
                    <label class="capture-label" for="capture-status">HTTP 状态</label>
                    <input id="capture-status" v-model.number="c.form.status" required type="number" min="200" max="599" aria-describedby="capture-status-hint" />
                  </div>
                  <div class="capture-field">
                    <label class="capture-label" for="capture-delay">延迟</label>
                    <div class="capture-suffix">
                      <input id="capture-delay" v-model.number="c.form.delayMs" required type="number" min="0" max="30000" />
                      <span aria-hidden="true">ms</span>
                    </div>
                  </div>
                </div>
                <p id="capture-status-hint" class="capture-field-hint">原始响应为 {{ originalStatus }}，支持 200–599。</p>
              </section>
            </fieldset>
          </section>
        </div>

        <footer class="capture-actions">
          <div class="capture-action-target">
            <span>保存到</span>
            <strong>{{ pkg.name }}</strong>
            <span aria-hidden="true">·</span>
            <span>{{ targetLabel }}</span>
          </div>
          <div class="capture-action-submit">
            <p v-if="saveError" class="capture-save-error" role="alert">{{ saveError }}</p>
            <label :class="['capture-check', { 'is-disabled': !canActivate }]">
              <input v-model="activate" type="checkbox" :disabled="!canActivate" />
              <span>
                <strong>保存后立即启用</strong>
                <small>{{ activationNote }}</small>
              </span>
            </label>
            <button class="primary" type="submit" :disabled="!canSave">
              {{ c.saving.value ? "保存中…" : activate ? "保存并启用" : "保存场景" }}
            </button>
          </div>
        </footer>
      </template>
    </form>
  </section>
</template>

<style scoped>
.capture-import {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.capture-form {
  width: 100%;
  max-width: 1720px;
  height: 100%;
  min-height: 620px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.capture-header {
  flex: 0 0 auto;
  min-height: 68px;
  padding: 11px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-panel);
  display: flex;
  align-items: center;
  gap: 18px;
}

.capture-title-block {
  flex: 0 0 auto;
  min-width: 250px;
}

.capture-kicker {
  margin: 0 0 4px;
  color: var(--ink-muted);
  font-size: 11px;
  font-weight: 600;
}

.capture-header h1 {
  margin: 0;
  color: var(--ink-strong);
  font-size: 21px;
  line-height: 1.2;
  letter-spacing: -.02em;
}

.capture-header .secondary {
  flex: 0 0 auto;
  min-height: var(--control-height);
  margin-left: auto;
  padding: 0 12px;
}

.capture-source {
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--control-height);
  padding-left: 18px;
  border-left: 1px solid var(--line-soft);
  display: flex;
  align-items: center;
  gap: 10px;
}

.capture-method {
  flex: 0 0 auto;
  min-width: 46px;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font: 650 11px/1.4 var(--font-mono);
  text-align: center;
}

.capture-url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font: 12px/1.5 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-host {
  color: var(--ink-muted);
}

.capture-source-status {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 11px;
  white-space: nowrap;
}

.capture-source-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-faint);
}

.capture-source-status.is-success i { background: var(--success); }
.capture-source-status.is-warning i { background: var(--warning); }
.capture-source-status.is-danger i { background: var(--danger); }

.capture-source-status strong {
  color: var(--ink-strong);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.capture-layout {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 372px;
  gap: 12px;
}

.capture-editor-card,
.capture-settings {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-panel);
  display: flex;
  flex-direction: column;
}

.capture-card-head {
  flex: 0 0 auto;
  min-height: 52px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.capture-settings .capture-card-head {
  min-height: 44px;
}

.capture-card-head h2 {
  margin: 0;
  color: var(--ink-strong);
  font-size: 13px;
  font-weight: 650;
}

.capture-card-head p {
  margin: 3px 0 0;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.45;
}

.capture-editor-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.capture-editor-body.is-saving {
  opacity: .72;
}

.capture-editor-body :deep(.json-editor-shell) {
  flex: 1 1 auto;
  min-height: 0;
  border: 0;
  border-radius: 0;
  background: var(--surface-subtle);
}

.capture-editor-body :deep(.json-editor-toolbar) {
  padding-left: 16px;
  padding-right: 16px;
  background: var(--surface-subtle);
}

.capture-settings-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  margin: 0;
  padding: 0 16px 12px;
  border: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.capture-group {
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}

.capture-group:last-child {
  padding-bottom: 4px;
  border-bottom: 0;
}

.capture-group h3 {
  margin: 0 0 8px;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 650;
}

.capture-label {
  display: block;
  margin: 0 0 4px;
  color: var(--ink-muted);
  font-size: 11px;
}

.capture-settings input:not([type="checkbox"]),
.capture-settings select {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: var(--control-height);
  margin: 0 0 10px;
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
}

.capture-settings select {
  padding-right: 25px;
}

.capture-settings input:focus,
.capture-settings select:focus {
  border-color: var(--accent);
}

.capture-match {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  margin: 8px 0 10px;
  padding: 6px 9px;
  border: 1px solid var(--accent-line);
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  text-align: left;
}

.capture-match-label {
  flex: 0 0 auto;
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 650;
}

.capture-match code {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--ink-strong);
  font: 11px/1.5 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-match code b {
  color: var(--accent-strong);
  font-weight: 700;
}

.capture-match small {
  flex: 0 0 auto;
  color: var(--ink-muted);
  font-size: 10px;
}

.capture-note,
.capture-field-hint {
  margin: 0 0 10px;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.55;
}

.capture-note {
  margin-bottom: 0;
  padding: 8px 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}

.capture-numbers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.capture-field {
  min-width: 0;
}

.capture-field .capture-label {
  white-space: nowrap;
}

.capture-suffix {
  position: relative;
}

.capture-suffix input {
  padding-right: 30px;
}

.capture-suffix span {
  position: absolute;
  top: 50%;
  right: 9px;
  color: var(--ink-faint);
  font-size: 10px;
  pointer-events: none;
  transform: translateY(-50%);
}

.capture-field-hint {
  margin-bottom: 0;
}

.capture-actions {
  flex: 0 0 auto;
  min-height: 62px;
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: rgb(255 255 255 / 96%);
  box-shadow: var(--shadow-panel);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  position: sticky;
  bottom: 0;
  z-index: 2;
}

.capture-action-target {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--ink-muted);
  font-size: 11px;
}

.capture-action-target strong {
  max-width: 200px;
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-action-target span:last-child {
  max-width: 340px;
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-check {
  min-width: 0;
  max-width: 390px;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  cursor: pointer;
}

.capture-check input {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  margin: 2px 0 0;
  accent-color: var(--accent);
}

.capture-check > span {
  min-width: 0;
}

.capture-check strong {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 600;
}

.capture-check small {
  display: block;
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.5;
}

.capture-check.is-disabled {
  cursor: default;
}

.capture-check.is-disabled strong {
  color: var(--ink-faint);
}

.capture-action-submit {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.capture-save-error {
  flex-basis: 100%;
  order: -1;
  max-width: 520px;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.5;
  text-align: right;
}

.capture-actions .primary {
  min-height: var(--control-height);
  padding: 0 18px;
  font-size: 13px;
}

.capture-actions .primary:disabled {
  opacity: .55;
  cursor: not-allowed;
  box-shadow: none;
}

.capture-state {
  width: 100%;
  max-width: 560px;
  min-height: 280px;
  margin: 8vh auto 0;
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-panel);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.capture-state h1,
.capture-state h2 {
  margin: 0;
  color: var(--ink-strong);
  font-size: 18px;
  letter-spacing: -.02em;
}

.capture-state p {
  max-width: 48ch;
  margin: 0;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.7;
}

.capture-state-mark {
  width: 40px;
  height: 40px;
  margin-bottom: 2px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
  font-size: 18px;
}

.capture-state-mark.is-success {
  background: #eaf7f0;
  color: var(--success);
}

.capture-state-actions {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.capture-state-actions .primary,
.capture-state-actions .secondary {
  min-height: var(--control-height);
  padding: 0 14px;
}

.capture-state .capture-state-error {
  color: var(--danger);
  overflow-wrap: anywhere;
}

.capture-inline-state {
  flex: 1 1 auto;
  max-width: none;
  min-height: 280px;
  margin: 0;
}

@media (max-width: 1180px) {
  .capture-layout {
    grid-template-columns: minmax(0, 1fr) 340px;
  }

  .capture-header {
    min-height: 60px;
    padding: 8px 14px;
    gap: 14px;
  }

  .capture-header h1 {
    font-size: 19px;
  }

  .capture-kicker {
    margin-bottom: 2px;
    font-size: 10px;
  }

  .capture-title-block {
    min-width: 210px;
  }

  .capture-source {
    padding-left: 14px;
  }

  .capture-settings-body {
    padding-bottom: 10px;
  }

  .capture-group {
    padding: 11px 0;
  }

  .capture-settings input:not([type="checkbox"]),
  .capture-settings select {
    margin-bottom: 8px;
  }
}

@media (max-width: 980px) {
  .capture-header {
    flex-wrap: wrap;
  }

  .capture-source {
    order: 3;
    flex-basis: 100%;
    padding: 8px 0 0;
    border-left: 0;
    border-top: 1px solid var(--line-soft);
  }
}

@media (max-width: 900px) {
  .capture-import {
    height: auto;
    overflow: visible;
    padding: 14px;
  }

  .capture-form {
    height: auto;
    min-height: 0;
  }

  .capture-layout {
    grid-template-columns: 1fr;
  }

  .capture-editor-card {
    min-height: 440px;
  }

  .capture-settings-body {
    overflow: visible;
  }
  .capture-actions {
    position: static;
  }
}

@media (max-width: 600px) {
  .capture-import {
    padding: 10px;
  }

  .capture-header {
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
  }

  .capture-header h1 {
    font-size: 19px;
  }

  .capture-title-block {
    min-width: 0;
  }

  .capture-header .secondary {
    min-height: var(--control-height-sm);
    padding: 0 8px;
    font-size: 12px;
  }

  .capture-method {
    min-width: 40px;
    padding: 3px 5px;
  }

  .capture-card-head {
    padding: 10px 12px;
  }

  .capture-settings-body {
    padding: 0 12px 12px;
  }

  .capture-editor-card {
    min-height: 360px;
  }

  .capture-actions {
    display: block;
    padding: 9px 10px;
  }

  .capture-action-target {
    display: none;
  }

  .capture-action-submit {
    width: 100%;
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 10px;
  }

  .capture-check {
    flex: 1 1 180px;
    max-width: none;
  }

  .capture-save-error {
    max-width: none;
    text-align: left;
  }

  .capture-actions .primary {
    flex: 0 0 auto;
    width: auto;
    min-width: 104px;
    min-height: 38px;
  }

  .capture-state {
    margin-top: 4vh;
    padding: 24px 16px;
  }
}

@media (max-height: 720px) and (min-width: 901px) {
  .capture-form {
    min-height: 560px;
  }
}
</style>
