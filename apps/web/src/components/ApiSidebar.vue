<script setup lang="ts">
import type { ConsoleController } from "../console-controller";

type ApiSidebarController = Pick<ConsoleController, "openApiCreate" | "state" | "search" | "loading" | "loadError" | "filtered" | "selectedId" | "pkg" | "toggle" | "selectApi" | "retryLoad">;
const { controller: c } = defineProps<{ controller: ApiSidebarController }>();
</script>

<template>
  <aside>
    <div class="side-title">
      <span>逻辑接口</span>
      <button class="icon-btn" aria-label="新建逻辑接口" @click="c.openApiCreate">＋</button>
    </div>
    <div class="search"><span aria-hidden="true">⌕</span><input v-model="c.search.value" aria-label="搜索接口" placeholder="搜索接口..." /></div>
    <div class="api-list">
      <div v-if="c.loading.value" class="loading-state" role="status">正在加载配置…</div>
      <div v-else-if="c.loadError.value" class="load-error" role="alert">{{ c.loadError.value }}<br /><button @click="c.retryLoad">重试</button></div>
      <template v-else>
        <div v-for="item in c.filtered.value" :key="item.id" :class="['api-item', { active: item.id === c.selectedId.value }]">
          <button :class="['toggle', 'compact-toggle', { checked: item.enabled }]" :aria-label="item.enabled ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
          <button class="api-select" @click="c.selectApi(item)"><span class="api-name">{{ item.name }}</span></button>
        </div>
        <div v-if="c.pkg.value && c.search.value.trim() && !c.filtered.value.length" class="empty-side">
          没有找到匹配的接口<br /><button @click="c.search.value = ''">清除搜索</button>
        </div>
        <div v-else-if="!c.filtered.value.length" class="empty-side">
          {{ c.pkg.value ? "还没有接口" : "还没有测试包" }}<br /><button @click="c.openApiCreate">{{ c.pkg.value ? "创建第一个接口" : "创建测试包" }}</button>
        </div>
      </template>
    </div>
    <div class="side-foot">
      <div class="foot-label">当前包</div>
      <b>{{ c.pkg.value?.name || "未选择" }}</b><span>{{ c.pkg.value?.apis.length || 0 }} 个逻辑接口</span>
    </div>
  </aside>
</template>
