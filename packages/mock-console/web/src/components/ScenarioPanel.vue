<script setup lang="ts">
import { VueDraggable } from "vue-draggable-plus";
import type { ConsoleController } from "../console-controller";
import type { Scene } from "../mock-admin-client";
import type { OpenContextMenu } from "../context-menu";
import JsonEditor from "./JsonEditor.vue";

type ScenarioPanelController = Pick<ConsoleController, "api" | "openSceneCreate" | "scene" | "activeSceneId" | "toggleScene" | "selectScene" | "openSceneEdit" | "duplicateScene" | "deleteScene" | "reorderScenarios" | "draft" | "draftDirty" | "jsonError" | "saveJson">;
const { controller: c, openContextMenu } = defineProps<{ controller: ScenarioPanelController; openContextMenu: OpenContextMenu }>();

let scenarioOrderBeforeDrag: string[] | null = null;

function onScenarioDragStart() {
  scenarioOrderBeforeDrag = c.api.value?.scenarios.map((item) => item.id) || null;
}

async function onScenarioDragEnd() {
  const current = c.api.value;
  const previous = scenarioOrderBeforeDrag;
  scenarioOrderBeforeDrag = null;
  if (!current || !previous) return;
  await c.reorderScenarios(current.scenarios.map((item) => item.id), previous);
}

function openSceneContextFromKeyboard(event: KeyboardEvent, item: Scene) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom }), { type: "scene", item });
}
</script>

<template>
  <section v-if="c.api.value" class="scenario-panel" aria-labelledby="scenario-title">
    <div v-if="c.api.value.scenarios.length" class="scenario-workspace">
      <div class="scene-list" aria-label="响应场景列表">
        <div class="section-head scene-list-head">
          <h2 id="scenario-title">响应场景</h2>
          <button class="secondary" aria-label="新建场景" @click="c.openSceneCreate">＋ 新建</button>
        </div>
        <VueDraggable
          v-model="c.api.value.scenarios"
          class="scene-list-items"
          tag="div"
          role="list"
          handle=".drag-handle"
          ghost-class="drag-ghost"
          chosen-class="drag-chosen"
          drag-class="drag-dragging"
          :animation="160"
          :delay="180"
          :delay-on-touch-only="true"
          :touch-start-threshold="5"
          :fallback-on-body="true"
          @contextmenu.prevent="openContextMenu($event, { type: 'scene-area' })"
          @start="onScenarioDragStart"
          @end="onScenarioDragEnd"
        >
          <div v-for="item in c.api.value.scenarios" :key="item.id" :class="['scene-row', { selected: item.id === c.scene.value?.id }]" role="listitem" @contextmenu.stop.prevent="openContextMenu($event, { type: 'scene', item })" @keydown="openSceneContextFromKeyboard($event, item)">
            <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
            <button :class="['toggle', 'compact-toggle', 'scene-toggle', { checked: item.id === c.activeSceneId.value }]" :aria-label="item.id === c.activeSceneId.value ? `停用场景 ${item.name}` : `启用场景 ${item.name}`" :aria-pressed="item.id === c.activeSceneId.value" @click="c.toggleScene(item)"><i aria-hidden="true"></i></button>
            <button type="button" class="scene-select" aria-haspopup="menu" :aria-current="item.id === c.scene.value?.id ? 'true' : undefined" @click="c.selectScene(item)">
              <span :class="['scene-dot', item.color || 'blue']" aria-hidden="true"></span>
              <span class="scene-name">{{ item.name }}</span>
              <span v-if="item.id === c.activeSceneId.value" class="active-badge">当前启用</span>
            </button>
          </div>
        </VueDraggable>
      </div>

      <div v-if="c.scene.value" class="editor-panel">
        <div class="scene-detail-bar">
          <div class="scene-identity">
            <strong>{{ c.scene.value.name }}</strong>
            <button class="icon-action" :aria-label="`编辑场景 ${c.scene.value.name}`" @click="c.openSceneEdit(c.scene.value)">编辑</button>
            <button class="icon-action" :aria-label="`复制场景 ${c.scene.value.name}`" @click="c.duplicateScene(c.scene.value)">复制</button>
            <button class="icon-action danger" :aria-label="`删除场景 ${c.scene.value.name}`" @click="c.deleteScene(c.scene.value)">删除</button>
          </div>
          <div class="scene-properties">
            <span>HTTP <b>{{ c.scene.value.status }}</b></span>
            <span>延迟 <b>{{ c.scene.value.delayMs }} ms</b></span>
          </div>
        </div>
        <JsonEditor
          id="json-editor"
          :value="c.draft.value"
          :error="Boolean(c.jsonError.value)"
          aria-label="响应 JSON 编辑器"
          :aria-describedby="c.jsonError.value ? 'json-editor-error' : undefined"
          @update:value="c.draft.value = $event"
          @user-change="c.draftDirty.value = true"
          @save="c.saveJson"
        />
        <div v-if="c.jsonError.value" id="json-editor-error" class="json-error">⚠ {{ c.jsonError.value }}</div>
        <div class="editor-footer">
          <span :class="['save-state', { dirty: c.draftDirty.value }]">{{ c.draftDirty.value ? "等待自动保存…" : "已同步" }}</span>
        </div>
      </div>
    </div>
    <div v-else class="scenario-empty">
      <div class="section-head">
        <h2 id="scenario-title">响应场景</h2>
        <button class="secondary" aria-label="新建场景" @click="c.openSceneCreate">＋ 新建</button>
      </div>
      <div class="empty-scenes" @contextmenu.prevent="openContextMenu($event, { type: 'scene-area' })">暂无场景，创建一个完整 JSON 响应开始使用</div>
    </div>
  </section>
</template>
