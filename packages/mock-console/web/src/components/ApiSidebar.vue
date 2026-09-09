<script setup lang="ts">
import { VueDraggable } from "vue-draggable-plus";
import type { ConsoleController } from "../console-controller";
import type { Api } from "../mock-admin-client";
import type { OpenContextMenu } from "../context-menu";

type ApiSidebarController = Pick<ConsoleController, "openApiCreate" | "state" | "search" | "filtered" | "selectedId" | "pkg" | "toggle" | "selectApi" | "reorderApis">;
const { controller: c, openContextMenu } = defineProps<{ controller: ApiSidebarController; openContextMenu: OpenContextMenu }>();

let apiOrderBeforeDrag: string[] | null = null;

function onApiDragStart() {
  apiOrderBeforeDrag = c.pkg.value?.apis.map((item) => item.id) || null;
}

async function onApiDragEnd() {
  const current = c.pkg.value;
  const previous = apiOrderBeforeDrag;
  apiOrderBeforeDrag = null;
  if (!current || !previous) return;
  await c.reorderApis(current.apis.map((item) => item.id), previous);
}

function openApiContextFromKeyboard(event: KeyboardEvent, item: Api) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom }), { type: "api", item });
}
</script>

<template>
  <aside>
    <div class="side-title" @contextmenu.stop>
      <span>逻辑接口</span>
      <button class="icon-btn" aria-label="新建逻辑接口" @click="c.openApiCreate">＋</button>
    </div>
    <div class="api-region" @contextmenu.prevent="openContextMenu($event, { type: 'api-area' })">
      <div class="search" @contextmenu.stop><span aria-hidden="true">⌕</span><input v-model="c.search.value" aria-label="搜索接口" placeholder="搜索接口..." /></div>
      <VueDraggable
        v-if="c.pkg.value && !c.search.value.trim() && c.pkg.value.apis.length"
        v-model="c.pkg.value.apis"
        class="api-list"
        handle=".drag-handle"
        ghost-class="drag-ghost"
        chosen-class="drag-chosen"
        drag-class="drag-dragging"
        :animation="160"
        :delay="180"
        :delay-on-touch-only="true"
        :touch-start-threshold="5"
        :fallback-on-body="true"
        @start="onApiDragStart"
        @end="onApiDragEnd"
      >
        <div v-for="item in c.pkg.value.apis" :key="item.id" :class="['api-item', { active: item.id === c.selectedId.value }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
          <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
          <button :class="['toggle', 'compact-toggle', { checked: item.enabled }]" :aria-label="item.enabled ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
          <button class="api-select" aria-haspopup="menu" @click="c.selectApi(item)"><span class="api-name">{{ item.name }}</span></button>
        </div>
      </VueDraggable>
      <div v-else class="api-list">
        <div v-for="item in c.filtered.value" :key="item.id" :class="['api-item', { active: item.id === c.selectedId.value }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
          <span v-if="!c.search.value.trim()" class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
          <button :class="['toggle', 'compact-toggle', { checked: item.enabled }]" :aria-label="item.enabled ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
          <button class="api-select" aria-haspopup="menu" @click="c.selectApi(item)"><span class="api-name">{{ item.name }}</span></button>
        </div>
        <div v-if="c.search.value.trim() && c.filtered.value.length" class="sort-hint">清除搜索后可拖拽排序</div>
      </div>
      <div v-if="c.pkg.value && c.search.value.trim() && !c.filtered.value.length" class="empty-side">
        没有找到匹配的接口<br /><button @click="c.search.value = ''">清除搜索</button>
      </div>
      <div v-else-if="!c.filtered.value.length" class="empty-side">
        {{ c.pkg.value ? "还没有接口" : "还没有测试包" }}<br /><button @click="c.openApiCreate">{{ c.pkg.value ? "创建第一个接口" : "创建测试包" }}</button>
      </div>
    </div>
    <div class="side-foot" @contextmenu.stop>
      <div class="foot-label">当前包</div>
      <b>{{ c.pkg.value?.name || "未选择" }}</b><span>{{ c.pkg.value?.apis.length || 0 }} 个逻辑接口</span>
    </div>
  </aside>
</template>
