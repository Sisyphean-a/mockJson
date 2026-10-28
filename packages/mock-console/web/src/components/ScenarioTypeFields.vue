<script setup lang="ts">
import type { ScenarioResponseType } from "../../../shared/types";
const type = defineModel<ScenarioResponseType>("type", { required: true });
const paths = defineModel<string>("paths", { required: true });
</script>

<template>
  <div class="scene-type-fields">
    <label class="form-label" for="scene-response-type">响应类型</label>
    <select id="scene-response-type" v-model="type">
      <option value="mock">完整 Mock</option>
      <option value="real-overrides">真实响应 + 字段 Mock</option>
      <option value="mock-with-real">Mock 响应 + 真实字段</option>
    </select>
    <template v-if="type !== 'mock'">
      <label class="form-label" for="scene-field-paths">{{ type === 'real-overrides' ? '使用 Mock 值的字段' : '使用真实值的字段' }}</label>
      <textarea id="scene-field-paths" v-model="paths" rows="3" placeholder="/data/imageUrl" spellcheck="false" aria-describedby="scene-fields-hint"></textarea>
      <div class="scene-field-help">
        <span id="scene-fields-hint">每行一个路径</span>
        <details class="scene-field-rules">
          <summary>字段规则</summary>
          <ul>
            <li>两份 JSON 使用相同路径，如 <code>/data/imageUrl</code>。</li>
            <li>父级必须存在；数组用下标，如 <code>/items/0/url</code>，不按 ID 对齐。</li>
            <li>路径不能重复或包含父子路径。</li>
          </ul>
        </details>
      </div>
      <p class="scene-call-risk"><span aria-hidden="true">!</span>将实际调用接口，含提交操作；失败不回退。</p>
    </template>
  </div>
</template>

<style scoped>
.scene-type-fields { min-width: 0; }
textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: 8px 10px; color: var(--ink); background: var(--surface); font: 12px/1.6 var(--font-mono); }
textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.scene-field-help { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--ink-muted); font-size: 11px; }
.scene-field-rules { text-align: right; }
.scene-field-rules summary { cursor: pointer; color: var(--ink-muted); }
.scene-field-rules ul { margin: 8px 0 0; padding-left: 16px; text-align: left; font-size: 12px; line-height: 1.7; }
.scene-field-rules code { overflow-wrap: anywhere; }
.scene-type-fields .scene-call-risk { display: flex; align-items: baseline; gap: 6px; margin: 12px 0 0; color: var(--warning); font-size: 11px; line-height: 1.6; }
.scene-call-risk > span { display: inline-flex; justify-content: center; flex: 0 0 14px; border: 1px solid currentColor; border-radius: 50%; font-size: 10px; line-height: 12px; }
</style>
