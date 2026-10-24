<script setup lang="ts">
import type { Pkg } from "../mock-admin-client";
import type { useCaptureImport } from "../use-capture-import";
import JsonEditor from "./JsonEditor.vue";

const { controller: c, pkg } = defineProps<{ controller: ReturnType<typeof useCaptureImport>; pkg?: Pkg }>();
defineEmits<{ close: []; createPackage: [] }>();
</script>

<template>
  <section class="capture-import" aria-labelledby="capture-title" :aria-busy="c.loading.value || c.saving.value">
    <header class="capture-heading">
      <div><span class="capture-kicker">浏览器扩展 → Mock Console</span><h1 id="capture-title">保存为 Mock 场景</h1></div>
      <button class="secondary" :disabled="c.saving.value" @click="$emit('close')">返回配置</button>
    </header>
    <p class="capture-intro">将选中的响应变成可重复使用的场景。仅保存不会改变当前 Mock；确认后再启用。</p>
    <p v-if="c.error.value" class="capture-error" role="alert">{{ c.error.value }}</p>
    <p v-if="c.loading.value" role="status">正在读取扩展响应…</p>
    <div v-else-if="!c.draft.value" class="capture-empty">
      <p>草稿仅在本次服务内存中保留 15 分钟；过期或重启后，请从扩展重新发送。</p>
      <button class="secondary" @click="c.load">重试读取</button>
    </div>
    <div v-else-if="c.saved.value" class="capture-empty">
      <h2>此响应已保存{{ c.saved.value.activated ? '并启用' : '为场景' }}</h2>
      <p>不会重复创建。可返回对应接口继续编辑。</p>
      <button class="primary" :disabled="c.saving.value" @click="c.viewSaved">查看已保存场景</button>
    </div>
    <template v-else>
      <div class="capture-source">
        <strong>{{ c.draft.value.request.method }}</strong>
        <code :title="c.draft.value.request.url">{{ c.draft.value.request.url }}</code>
        <span>原响应 {{ c.draft.value.response.status }}</span>
      </div>
      <div v-if="!pkg" class="capture-empty">
        <p>还没有当前测试包。先创建测试包，响应草稿会保留在这里。</p>
        <button class="primary" @click="$emit('createPackage')">新建测试包</button>
      </div>
      <form v-else class="capture-layout" @submit.prevent="c.save(false)">
        <fieldset class="capture-fields" :disabled="c.saving.value">
          <h2>保存到哪里</h2>
          <label class="form-label" for="capture-package">当前测试包</label>
          <input id="capture-package" :value="pkg.name" readonly />
          <label class="form-label" for="capture-api">目标逻辑接口</label>
          <select id="capture-api" v-model="c.form.apiId">
            <option value="">＋ 新建逻辑接口</option>
            <option v-for="api in pkg.apis" :key="api.id" :value="api.id">{{ api.name }}</option>
          </select>
          <template v-if="!c.form.apiId">
            <label class="form-label" for="capture-api-name">接口名称</label>
            <input id="capture-api-name" v-model="c.form.apiName" required maxlength="200" />
            <p class="capture-hint">自动创建 AND 匹配：Method + Host + Path，忽略查询参数。保存后可在接口配置中调整。</p>
          </template>
          <p v-else class="capture-hint">追加完整响应，不改动该接口的匹配规则或已有场景。</p>
          <label class="form-label" for="capture-scene">场景名称</label>
          <input id="capture-scene" v-model="c.form.scenarioName" required maxlength="200" />
          <div class="capture-numbers">
            <div><label class="form-label" for="capture-status">HTTP 状态码</label><input id="capture-status" v-model.number="c.form.status" required type="number" min="200" max="599" /></div>
            <div><label class="form-label" for="capture-delay">延迟（ms）</label><input id="capture-delay" v-model.number="c.form.delayMs" required type="number" min="0" max="30000" /></div>
          </div>
          <p v-if="c.conditional.value" class="capture-hint">此接口使用条件分支：仅保存场景，再到响应规则中引用；不会切换为固定响应。</p>
          <p v-else class="capture-hint">「保存并启用」会启用接口，并将固定响应切换到此场景；扩展白名单和开关保持不变。</p>
          <div class="capture-buttons">
            <button class="primary" type="submit" :disabled="Boolean(c.jsonError.value)">{{ c.saving.value ? '保存中…' : '保存场景' }}</button>
            <button class="secondary" type="button" :disabled="c.conditional.value || Boolean(c.jsonError.value)" @click="c.save(true)">保存并启用</button>
          </div>
        </fieldset>
        <div class="capture-response">
          <h2>完整 JSON 响应</h2>
          <p class="capture-hint">可直接编辑；这里只保存响应内容，不携带请求 Cookie、请求头或请求体。</p>
          <p v-if="c.jsonError.value" class="capture-error" role="alert">{{ c.jsonError.value }}</p>
          <div class="capture-editor" :inert="c.saving.value" :class="{ 'capture-editor-saving': c.saving.value }">
            <JsonEditor :value="c.form.responseBody" :error="Boolean(c.jsonError.value)" @update:value="c.form.responseBody = $event" @save="c.save(false)" />
          </div>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.capture-import { width: 100%; min-height: 0; overflow: auto; padding: 24px; }
.capture-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.capture-kicker { color: var(--accent); font-size: 11px; font-weight: 650; }
.capture-heading h1 { margin: 6px 0 0; font-size: 22px; letter-spacing: -.04em; }
.capture-intro { margin: 10px 0 20px; color: var(--ink-muted); font-size: 12px; }
.capture-source { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-block: 1px solid var(--line); font-size: 12px; }
.capture-source strong { color: var(--accent); }
.capture-source code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: var(--font-mono); }
.capture-source span { flex-shrink: 0; color: var(--ink-muted); }
.capture-layout { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 28px; margin-top: 22px; }
.capture-fields { min-width: 0; padding: 0; margin: 0; border: 0; }
.capture-import h2 { margin: 0 0 16px; font-size: 14px; }
.capture-fields input, .capture-fields select { display: block; width: 100%; min-height: var(--control-height); margin: 0 0 14px; padding: 7px 9px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink); }
.capture-fields input:focus, .capture-fields select:focus { outline: 2px solid var(--accent-line); border-color: var(--accent); }
.capture-fields input[readonly] { background: var(--surface-subtle); color: var(--ink-muted); }
.capture-hint { color: var(--ink-muted); font-size: 11px; line-height: 1.7; margin: 0 0 16px; }
.capture-numbers { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.capture-buttons { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 20px; }
.capture-error { color: var(--danger); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.capture-empty { padding: 24px 0; color: var(--ink-muted); font-size: 12px; }
.capture-response { min-width: 0; display: flex; flex-direction: column; }
.capture-editor { display: flex; flex-direction: column; min-height: 300px; height: min(520px, 58vh); border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
.capture-editor-saving { pointer-events: none; opacity: .7; }
@media (max-width: 800px) {
  .capture-import { padding: 16px; }
  .capture-layout { grid-template-columns: 1fr; gap: 24px; }
  .capture-source { flex-wrap: wrap; }
  .capture-source code { flex-basis: 75%; }
  .capture-editor { height: 380px; }
}
</style>
