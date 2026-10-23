<script setup lang="ts">
import { ref } from "vue";
import { VueDraggable } from "vue-draggable-plus";
import type { ConsoleController } from "../console-controller";
import type { Scene } from "../mock-admin-client";
import type { OpenContextMenu } from "../context-menu";
import JsonEditor from "./JsonEditor.vue";
import ResponseBranchPanel from "./ResponseBranchPanel.vue";
const { controller: c, openContextMenu } = defineProps<{ controller: ConsoleController; openContextMenu: OpenContextMenu }>();
const mobileListOpen = ref(false);
let scenarioOrderBeforeDrag: string[] | null = null;
function onScenarioDragStart() { scenarioOrderBeforeDrag = c.api.value?.scenarios.map((item) => item.id) || null; }
async function onScenarioDragEnd() {
  const current = c.api.value, previous = scenarioOrderBeforeDrag;
  scenarioOrderBeforeDrag = null;
  if (current && previous) await c.reorderScenarios(current.scenarios.map((item) => item.id), previous);
}
function openSceneContextFromKeyboard(event: KeyboardEvent, item: Scene) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom }), { type: "scene", item });
}
function selectScene(scene: Scene) { c.selectScene(scene); mobileListOpen.value = false; }
</script>

<template>
  <section v-if="c.api.value" class="scenario-panel response-scenarios" aria-label="响应配置">
    <div class="scenario-workspace">
      <div class="scene-list" :class="{ 'mobile-list-open': mobileListOpen }" aria-label="响应场景列表">
        <div class="scene-list-toolbar">
          <div class="response-mode" role="group" aria-label="编辑响应模式"><button :class="{ selected: c.responseEditorMode.value === 'fixed' }" :aria-pressed="c.responseEditorMode.value === 'fixed'" :disabled="c.responseSaving.value" @click="c.setResponseMode('fixed')">固定响应</button><button :class="{ selected: c.responseEditorMode.value === 'conditional' }" :aria-pressed="c.responseEditorMode.value === 'conditional'" :disabled="c.responseSaving.value" @click="c.setResponseMode('conditional')">条件分支</button></div>
          <button class="secondary" aria-label="新建场景" @click="c.openSceneCreate">＋ 新建</button>
        </div>
        <button class="scene-mobile-select secondary" :aria-expanded="mobileListOpen" @click="mobileListOpen = !mobileListOpen">{{ c.rulesOpen.value ? '分支规则' : c.scene.value?.name || '选择场景' }} ▾</button>
        <button v-if="c.responseEditorMode.value === 'conditional'" :class="['branch-nav', { selected: c.rulesOpen.value }]" @click="c.showBranchRules(); mobileListOpen = false"><span>⑂ 分支规则</span><span>{{ c.responseDraft.value.selection.branches.length }} 条</span></button>
        <VueDraggable v-model="c.api.value.scenarios" class="scene-list-items" tag="div" role="list" handle=".drag-handle" ghost-class="drag-ghost" chosen-class="drag-chosen" drag-class="drag-dragging" :animation="160" :delay="180" :delay-on-touch-only="true" :touch-start-threshold="5" :fallback-on-body="true" @contextmenu.prevent="openContextMenu($event, { type: 'scene-area' })" @start="onScenarioDragStart" @end="onScenarioDragEnd">
          <div v-for="item in c.api.value.scenarios" :key="item.id" :class="['scene-row', { selected: !c.rulesOpen.value && item.id === c.scene.value?.id }]" role="listitem" @contextmenu.stop.prevent="openContextMenu($event, { type: 'scene', item })" @keydown="openSceneContextFromKeyboard($event, item)">
            <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
            <button v-if="c.responseEditorMode.value === 'fixed'" :class="['toggle', 'compact-toggle', 'scene-toggle', { checked: item.id === c.responseDraft.value.activeScenarioId }]" :aria-label="item.id === c.responseDraft.value.activeScenarioId ? `停用场景 ${item.name}` : `启用场景 ${item.name}`" :aria-pressed="item.id === c.responseDraft.value.activeScenarioId" :disabled="c.responseSaving.value" @click="c.toggleScene(item)"><i aria-hidden="true"></i></button>
            <button type="button" class="scene-select" :aria-current="!c.rulesOpen.value && item.id === c.scene.value?.id ? 'true' : undefined" :title="item.name" @click="selectScene(item)">
              <span :class="['scene-dot', item.color || 'blue']" aria-hidden="true"></span><span class="scene-name">{{ item.name }}</span>
              <template v-if="c.responseEditorMode.value === 'conditional'"><span v-if="c.responseDraft.value.selection.branches.some(b => b.scenarioId === item.id)" class="active-badge">被引用</span><span v-if="c.responseDraft.value.selection.fallback.enabled && c.responseDraft.value.selection.fallback.scenarioId === item.id" class="active-badge">兜底</span></template>
              <span v-else-if="item.id === c.responseDraft.value.activeScenarioId" class="active-badge">{{ c.responseDraft.value.activeScenarioId !== c.activeSceneId.value ? '待保存选择' : c.responseModeInactive.value ? '固定选择' : '当前启用' }}</span>
            </button>
          </div>
        </VueDraggable>
        <div v-if="!c.api.value.scenarios.length" class="empty-scenes" @contextmenu.prevent="openContextMenu($event, { type: 'scene-area' })">暂无场景，点击「＋ 新建」创建完整响应</div>
      </div>
      <div class="response-detail">
        <div class="response-state" role="status"><span>当前生效：{{ c.api.value.responseSelection?.mode === 'conditional' ? '条件分支' : '固定响应' }}</span><span v-if="c.responseDirty.value" class="unsaved-state">有未保存修改</span><span v-else-if="c.responseModeInactive.value">查看{{ c.responseEditorMode.value === 'conditional' ? '条件分支' : '固定响应' }} · 未启用</span><button v-if="c.responseEditorMode.value === 'fixed' && (c.responseDirty.value || c.responseModeInactive.value)" class="primary" :disabled="c.responseSaving.value" @click="c.saveResponseSelection">{{ c.responseSaving.value ? '保存中…' : c.responseModeInactive.value ? c.responseDirty.value ? '保存并启用' : '启用固定响应' : '保存' }}</button></div>
        <p v-if="c.responseEditorMode.value === 'fixed' && c.responseError.value" class="response-error save-error" role="alert">{{ c.responseError.value }}</p>
        <ResponseBranchPanel v-show="c.rulesOpen.value && c.responseEditorMode.value === 'conditional'" :controller="c" />
        <div v-show="!c.rulesOpen.value" class="editor-panel">
          <button v-if="c.responseEditorMode.value === 'conditional'" class="back-to-branches icon-action" @click="c.showBranchRules">← 分支规则</button>
          <template v-if="c.scene.value">
            <div class="scene-detail-bar"><div class="scene-identity"><strong>{{ c.scene.value.name }}</strong><button class="icon-action" :aria-label="`编辑场景 ${c.scene.value.name}`" @click="c.openSceneEdit(c.scene.value)">编辑</button><button class="icon-action" :aria-label="`复制场景 ${c.scene.value.name}`" @click="c.duplicateScene(c.scene.value)">复制</button><button class="icon-action danger" :aria-label="`删除场景 ${c.scene.value.name}`" @click="c.deleteScene(c.scene.value)">删除</button></div><div class="scene-properties"><span>HTTP <b>{{ c.scene.value.status }}</b></span><span>延迟 <b>{{ c.scene.value.delayMs }} ms</b></span></div></div>
            <JsonEditor id="json-editor" :value="c.draft.value" :error="Boolean(c.jsonError.value)" aria-label="响应 JSON 编辑器" :aria-describedby="c.jsonError.value ? 'json-editor-error' : undefined" @update:value="c.draft.value = $event" @user-change="c.draftDirty.value = true" @save="c.saveJson" />
            <div v-if="c.jsonError.value" id="json-editor-error" class="json-error">⚠ {{ c.jsonError.value }}</div><div class="editor-footer"><span :class="['save-state', { dirty: c.draftDirty.value }]">{{ c.draftDirty.value ? '等待自动保存…' : '已同步' }}</span></div>
          </template>
          <div v-else class="empty-scenes">选择或新建一个响应场景</div>
        </div>
      </div>
    </div>
  </section>
</template>
