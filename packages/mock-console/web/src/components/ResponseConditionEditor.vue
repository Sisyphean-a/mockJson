<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ResponseCondition } from "../../../shared/types";
const { condition: c, error } = defineProps<{ condition: ResponseCondition; error?: string }>();
const labels = { equals: "等于", notEquals: "不等于", contains: "包含", exists: "存在", notExists: "不存在", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于" };
const valueType = computed(() => c.value === null ? "null" : typeof c.value);
const numericText = ref(typeof c.value === "number" ? String(c.value) : "");
watch(() => c.value, (value) => {
  if (typeof value === "number" && Number.isFinite(value) && Number(numericText.value) !== value) numericText.value = String(value);
});
function inputNumber(event: Event) {
  numericText.value = (event.target as HTMLInputElement).value;
  const text = numericText.value.trim();
  c.value = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
}
const unary = computed(() => c.operator === "exists" || c.operator === "notExists");
const operators = computed(() => Object.entries(labels).filter(([key]) =>
  !["gt", "gte", "lt", "lte"].includes(key) || valueType.value === "number"
).filter(([key]) => key !== "contains" || valueType.value === "string"));
function setType(type: string) {
  c.value = type === "number" ? 0 : type === "boolean" ? true : type === "null" ? null : "";
  if (type === "number") numericText.value = "0";
  if (!operators.value.some(([key]) => key === c.operator)) c.operator = "equals";
}
function setSource(event: Event) {
  c.source = (event.target as HTMLSelectElement).value as ResponseCondition["source"];
  c.field = "";
  if (c.source === "header") setType("string");
}
</script>

<template>
  <div class="response-condition">
    <div class="condition-fields condition-grid">
      <label class="condition-source"><span class="response-sr-only">来源</span><select :value="c.source" @change="setSource"><option value="body">JSON 请求体</option><option value="header">请求头</option></select></label>
      <label class="condition-field"><span class="response-sr-only">字段</span><input v-model="c.field" :placeholder="c.source === 'header' ? '如 X-Scenario' : '如 /user/status'" :aria-invalid="!!error" :aria-describedby="error ? `${c.id}-error` : undefined" /></label>
      <label class="condition-operator"><span class="response-sr-only">判断方式</span><select v-model="c.operator"><option v-for="[key, label] in operators" :key="key" :value="key">{{ label }}</option></select></label>
      <div :class="['condition-comparison', { 'with-type': c.source === 'body' && !unary }]">
        <template v-if="!unary">
          <label v-if="c.source === 'body'" class="condition-type"><span class="response-sr-only">值类型</span><select :value="valueType" @change="setType(($event.target as HTMLSelectElement).value)"><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔</option><option value="null">空值 null</option></select></label>
          <label v-if="valueType !== 'null'" class="condition-value"><span class="response-sr-only">比较值</span>
            <input v-if="valueType === 'string'" v-model="c.value" aria-label="文本比较值" />
            <input v-else-if="valueType === 'number'" inputmode="decimal" :value="numericText" aria-label="数字比较值" @input="inputNumber" />
            <select v-else-if="valueType === 'boolean'" v-model="c.value" aria-label="布尔比较值"><option :value="true">true</option><option :value="false">false</option></select>
          </label>
        </template>
      </div>
      <slot />
    </div>
    <p v-if="error" :id="`${c.id}-error`" class="response-error" role="alert">{{ error }}</p>
  </div>
</template>
