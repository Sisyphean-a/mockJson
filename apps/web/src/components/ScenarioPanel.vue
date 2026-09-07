<script setup lang="ts">
import type { ConsoleController } from "../console-controller";
import JsonEditor from "./JsonEditor.vue";

type ScenarioPanelController = Pick<ConsoleController, "api" | "openSceneCreate" | "scene" | "activeSceneId" | "toggleScene" | "selectScene" | "openSceneEdit" | "duplicateScene" | "deleteScene" | "draft" | "draftDirty" | "jsonError" | "saveJson">;
const { controller: c } = defineProps<{ controller: ScenarioPanelController }>();
</script>

<template>
  <section v-if="c.api.value" class="scenario-panel" aria-labelledby="scenario-title">
    <div class="section-head">
      <div><h2 id="scenario-title">场景（响应状态）</h2><p>选择场景进行编辑，通过开关快速切换当前 Mock 响应</p></div>
      <button class="secondary" @click="c.openSceneCreate">＋ 新建场景</button>
    </div>

    <div v-if="c.api.value.scenarios.length" class="scenario-workspace">
      <div class="scene-list" role="list" aria-label="响应场景列表">
        <div v-for="item in c.api.value.scenarios" :key="item.id" :class="['scene-row', { selected: item.id === c.scene.value?.id }]" role="listitem">
          <button :class="['toggle', 'compact-toggle', 'scene-toggle', { checked: item.id === c.activeSceneId.value }]" :aria-label="item.id === c.activeSceneId.value ? `停用场景 ${item.name}` : `启用场景 ${item.name}`" :aria-pressed="item.id === c.activeSceneId.value" @click="c.toggleScene(item)"><i aria-hidden="true"></i></button>
          <button type="button" class="scene-select" :aria-current="item.id === c.scene.value?.id ? 'true' : undefined" @click="c.selectScene(item)">
            <span :class="['scene-dot', item.color || 'blue']" aria-hidden="true"></span>
            <span class="scene-name">{{ item.name }}</span>
            <span v-if="item.id === c.activeSceneId.value" class="active-badge">当前启用</span>
          </button>
        </div>
        <div class="scene-list-foot">场景默认不启用；开关同一时间只启用一个场景</div>
      </div>

      <div v-if="c.scene.value" class="editor-panel">
        <div class="scene-detail-bar">
          <div class="scene-identity">
            <span>场景名称</span><strong>{{ c.scene.value.name }}</strong>
            <button class="icon-action" :aria-label="`编辑场景 ${c.scene.value.name}`" @click="c.openSceneEdit(c.scene.value)">编辑</button>
            <button class="icon-action" :aria-label="`复制场景 ${c.scene.value.name}`" @click="c.duplicateScene(c.scene.value)">复制</button>
            <button class="icon-action danger" :aria-label="`删除场景 ${c.scene.value.name}`" @click="c.deleteScene(c.scene.value)">删除</button>
          </div>
          <div class="scene-properties">
            <span>HTTP 状态码 <b>{{ c.scene.value.status }}</b></span>
            <span>延迟（ms）<b>{{ c.scene.value.delayMs }}</b></span>
          </div>
        </div>
        <label id="response-editor-label" class="response-label">响应体（JSON）</label>
        <JsonEditor
          id="json-editor"
          :value="c.draft.value"
          :error="Boolean(c.jsonError.value)"
          aria-labelledby="response-editor-label"
          :aria-describedby="c.jsonError.value ? 'json-editor-error' : undefined"
          @update:value="c.draft.value = $event"
          @user-change="c.draftDirty.value = true"
        />
        <div v-if="c.jsonError.value" id="json-editor-error" class="json-error">⚠ {{ c.jsonError.value }}</div>
        <div class="editor-footer">
          <span :class="['save-state', { dirty: c.draftDirty.value }]">{{ c.draftDirty.value ? "有未保存的修改" : "响应内容已同步" }}</span>
          <button class="primary" @click="c.saveJson">保存响应</button>
        </div>
      </div>
    </div>
    <div v-else class="empty-scenes">暂无场景，创建一个完整 JSON 响应开始使用</div>
  </section>
</template>
