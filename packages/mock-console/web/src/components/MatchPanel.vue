<script setup lang="ts">
import type { ConsoleController } from "../console-controller";

type MatchPanelController = Pick<ConsoleController, "api" | "updateLogic" | "addingRule" | "ruleSource" | "changeSource" | "ruleField" | "urlFields" | "methodFields" | "ruleOperator" | "operators" | "ruleValue" | "ruleHint" | "addRule" | "removeRule">;
const { controller: c } = defineProps<{ controller: MatchPanelController }>();
</script>

<template>
  <section v-if="c.api.value" class="match-card" aria-labelledby="match-title">
    <div class="panel-heading">
      <div class="panel-title">
        <h1 id="match-title">匹配条件</h1>
        <span class="panel-context">{{ c.api.value.name }}</span>
      </div>
      <div class="match-controls">
        <div class="logic-control">
          <label :for="`logic-select-${c.api.value.id}`">匹配方式</label>
          <select :id="`logic-select-${c.api.value.id}`" class="logic-select" :value="c.api.value.matchMode" @change="c.updateLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')">
            <option value="AND">同时满足（AND）</option><option value="OR">满足任一（OR）</option>
          </select>
        </div>
        <button class="add-rule" @click="c.addingRule.value = !c.addingRule.value">＋ 添加条件</button>
      </div>
    </div>

    <div v-if="c.addingRule.value" class="rule-form">
      <select v-model="c.ruleSource.value" aria-label="匹配来源" @change="c.changeSource">
        <option value="header">Header</option><option value="url">URL</option><option value="method">Method</option>
      </select>
      <select v-if="c.ruleSource.value !== 'header'" v-model="c.ruleField.value" aria-label="匹配字段">
        <option v-for="field in c.ruleSource.value === 'url' ? c.urlFields : c.methodFields" :key="field.value" :value="field.value">{{ field.label }}</option>
      </select>
      <input v-else v-model="c.ruleField.value" aria-label="Header 名称" placeholder="Header 名称，例如 Authorization" />
      <select v-model="c.ruleOperator.value" aria-label="匹配运算符"><option v-for="operator in c.operators" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select>
      <input v-model="c.ruleValue.value" aria-label="匹配值" :placeholder="c.ruleOperator.value === 'exists' || c.ruleOperator.value === 'notExists' ? '此操作不需要填写值' : '输入匹配值'" @keyup.enter="c.addRule" />
      <div class="rule-hint">{{ c.ruleHint.value }}</div>
      <button class="primary small" @click="c.addRule">保存条件</button>
    </div>

    <div v-if="c.api.value.matchRules.length" class="rules">
      <div class="rule rule-head" aria-hidden="true">
        <span>来源</span><span>字段</span><span>条件</span><span>值</span><span>操作</span>
      </div>
      <div v-for="rule in c.api.value.matchRules" :key="rule.id" class="rule">
        <b class="rule-source">{{ rule.source === "header" ? "Header" : rule.source === "method" ? "Method" : "URL" }}</b>
        <span class="rule-field">{{ rule.field }}</span>
        <span class="operator">{{ c.operators.find((item) => item.value === rule.operator)?.label || rule.operator }}</span>
        <code class="rule-value">{{ rule.value || "—" }}</code>
        <button class="remove-rule" :aria-label="`删除匹配条件 ${rule.field}`" @click="c.removeRule(rule.id)">删除</button>
      </div>
    </div>
    <div v-else class="no-rules">未添加匹配条件</div>
  </section>
</template>
