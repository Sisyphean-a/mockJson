<script setup lang="ts">
import { useMockConsole } from "./useMockConsole";

const {
  state, search, selectedId, draft, jsonError, expanded, showApi, showScene,
  showPackage, sceneEditMode, draftDirty, apiName, serverReady, apiEditName,
  apiPriority, sceneName, editSceneName, editSceneStatus, editSceneDelay,
  editSceneColor, packageName, editingPackageId, toast, targetUrl, ruleSource,
  ruleField, ruleOperator, ruleValue, addingRule, operators, urlFields,
  methodFields, ruleHint, pkg, api, scene, activeSceneId, activeScene, filtered,
  selectApi, switchPkg, openApiCreate, openPackage, savePackage, deletePackage,
  saveTargetUrl, toggle, openApiEdit, saveApi, deleteApi, activate, addRule,
  removeRule, updateLogic, changeSource, saveJson, createApi, createScene,
  openSceneCreate, openSceneEdit, duplicateScene, saveScene, deleteScene,
} = useMockConsole();
</script>

<template>
  <div class="app-shell">
    <header>
      <div class="brand">
        <span class="brand-mark">✦</span>
        <div><strong>Mock Console</strong><small>本地接口模拟控制台</small></div>
      </div>
      <div class="top-actions">
        <label>当前测试包</label>
        <select :value="state.currentPackageId || ''" @change="switchPkg(($event.target as HTMLSelectElement).value)">
          <option v-for="p in state.packages" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div class="target-config">
          <span>真实服务</span>
          <input v-model="targetUrl" placeholder="https://api.example.com" @keyup.enter="saveTargetUrl" />
          <button class="save-target" @click="saveTargetUrl">保存</button>
          <button class="save-target" @click="openPackage()">＋ 包</button>
          <button v-if="pkg" class="save-target" @click="openPackage(pkg)">编辑包</button>
          <button v-if="pkg" class="save-target" @click="deletePackage(pkg)">删除包</button>
        </div>
        <span :class="['server-dot', { off: !serverReady }]"></span>
        <span class="server-status">{{ serverReady ? "服务运行中" : "服务不可用" }}</span>
      </div>
    </header>

    <main>
      <aside>
        <div class="side-title">
          <span>逻辑接口</span>
          <button class="icon-btn" @click="openApiCreate">＋</button>
        </div>
        <div class="search"><span>⌕</span><input v-model="search" placeholder="搜索接口..." /></div>
        <div class="api-list">
          <button v-for="item in filtered" :key="item.id" :class="['api-item', { active: item.id === selectedId }]" @click="selectApi(item)">
            <span class="api-icon">{ }</span><span class="api-name">{{ item.name }}</span><span :class="['status-dot', item.enabled ? 'on' : 'off']"></span>
          </button>
          <div v-if="!filtered.length" class="empty-side">
            {{ pkg ? "还没有接口" : "还没有测试包" }}<br /><button @click="openApiCreate">{{ pkg ? "创建第一个接口" : "创建测试包" }}</button>
          </div>
        </div>
        <div class="side-foot">
          <div class="foot-label">当前包</div>
          <b>{{ pkg?.name || "未选择" }}</b><span>{{ pkg?.apis.length || 0 }} 个逻辑接口</span>
        </div>
      </aside>

      <section class="content">
        <div v-if="!api" class="welcome">
          <div class="welcome-icon">✦</div>
          <h1>开始配置 Mock 接口</h1>
          <p>创建一个逻辑接口，再为它添加可快速切换的响应场景。</p>
          <button class="primary" @click="pkg ? openApiCreate() : openPackage()">＋ {{ pkg ? "新建逻辑接口" : "新建测试包" }}</button>
        </div>

        <template v-else>
          <div class="page-head">
            <div><div class="eyebrow">逻辑接口</div><h1>{{ api!.name }}</h1><p>配置匹配条件与响应场景</p></div>
            <div class="head-actions">
              <button class="secondary" @click="openApiEdit">编辑接口</button>
              <button class="secondary danger" @click="deleteApi">删除接口</button>
            </div>
            <div class="head-toggle">
              <span>{{ api!.enabled ? "Mock 已开启" : "Mock 已关闭" }}</span>
              <button :class="['toggle', { checked: api!.enabled }]" @click="toggle(api!)"><i></i></button>
            </div>
          </div>

          <div class="match-card">
            <div class="card-title" @click="api!.matchRules.length && (expanded = !expanded)">
              <span class="chevron">⌄</span><span>匹配条件</span><em>{{ api!.matchRules.length }} 条规则</em>
              <span class="logic-label">规则关系</span>
              <select class="logic-select" :value="api!.matchMode" @click.stop @change="updateLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')">
                <option value="AND">AND（全部满足）</option><option value="OR">OR（任一满足）</option>
              </select>
              <button class="add-rule" @click.stop="addingRule = !addingRule">＋ 添加条件</button>
            </div>
            <div v-if="addingRule" class="rule-form">
              <select v-model="ruleSource" @change="changeSource">
                <option value="header">Header</option><option value="url">URL</option><option value="method">Method</option>
              </select>
              <select v-if="ruleSource !== 'header'" v-model="ruleField">
                <option v-for="field in ruleSource === 'url' ? urlFields : methodFields" :key="field.value" :value="field.value">{{ field.label }}</option>
              </select>
              <input v-else v-model="ruleField" placeholder="Header 名称，例如 Authorization" />
              <select v-model="ruleOperator"><option v-for="operator in operators" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select>
              <input v-model="ruleValue" :placeholder="ruleOperator === 'exists' || ruleOperator === 'notExists' ? '此操作不需要填写值' : '输入匹配值'" @keyup.enter="addRule" />
              <div class="rule-hint">{{ ruleHint }}</div>
              <button class="primary small" @click="addRule">保存</button>
            </div>
            <div v-if="expanded && api!.matchRules.length" class="rules">
              <div v-for="rule in api!.matchRules" :key="rule.id" class="rule">
                <b>{{ rule.source === "header" ? "Header" : rule.source === "method" ? "Method" : "URL" }}</b>
                <span>{{ rule.field }}</span><span class="operator">{{ operators.find((item) => item.value === rule.operator)?.label || rule.operator }}</span>
                <code>{{ rule.value || "—" }}</code><button class="remove-rule" @click="removeRule(rule.id)">×</button>
              </div>
            </div>
            <div v-if="!api!.matchRules.length" class="no-rules">未配置匹配条件，此接口将匹配所有请求。点击“添加条件”开始配置。</div>
          </div>

          <div class="section-head">
            <div><h2>响应场景</h2><p>当前使用：<strong v-if="activeScene">{{ activeScene.name }}</strong><span v-else>未选择场景</span> · 点击其他场景即可立即切换</p></div>
            <button class="secondary" @click="openSceneCreate">＋ 新建场景</button>
          </div>
          <div class="scene-grid">
            <div v-for="item in api!.scenarios" :key="item.id" :class="['scene-card', { selected: item.id === activeSceneId }]" role="button" tabindex="0" @click="activate(item)" @keyup.enter="activate(item)">
              <span :class="['scene-dot', item.color || 'blue']"></span><strong>{{ item.name }}</strong>
              <span class="scene-meta">HTTP {{ item.status }} · {{ item.delayMs }}ms</span>
              <span v-if="item.id === activeSceneId" class="active-badge">当前使用</span>
              <span class="scene-actions"><button type="button" @click.stop="openSceneEdit(item)">编辑</button><button type="button" @click.stop="duplicateScene(item)">复制</button><button type="button" @click.stop="deleteScene(item)">删除</button></span>
            </div>
            <div v-if="!api!.scenarios.length" class="empty-scenes">暂无场景，创建一个完整 JSON 响应开始使用</div>
          </div>

          <div v-if="scene" class="editor-panel">
            <div class="editor-head"><div><h2>响应内容 <span>JSON</span></h2><p>当前编辑：{{ scene.name }}</p></div><button class="primary small" @click="saveJson">保存响应</button></div>
            <textarea v-model="draft" class="json-editor" spellcheck="false" @input="draftDirty = true"></textarea>
            <div v-if="jsonError" class="json-error">⚠ {{ jsonError }}</div>
          </div>
        </template>
      </section>
    </main>

    <div v-if="toast" class="toast">{{ toast }}</div>
    <div v-if="showApi || showScene || showPackage" class="modal-backdrop" @click.self="showApi = false; showScene = false; showPackage = false; sceneEditMode = false">
      <div class="modal">
        <button class="close" @click="showApi = false; showScene = false; showPackage = false; sceneEditMode = false">×</button>
        <h2>{{ showPackage ? (editingPackageId ? "编辑测试包" : "新建测试包") : showApi ? (apiEditName ? "编辑逻辑接口" : "新建逻辑接口") : sceneEditMode ? "编辑响应场景" : "新建响应场景" }}</h2>
        <p>{{ showPackage ? "按测试产品或版本管理独立的 Mock 配置。" : showApi ? "用业务名称和优先级标识一个可切换的接口。" : "每个场景保存一份完整的 JSON 响应。" }}</p>
        <template v-if="showPackage">
          <input v-model="packageName" autofocus placeholder="例如：Android 测试包" @keyup.enter="savePackage" /><button class="primary full" @click="savePackage">保存</button>
        </template>
        <template v-else-if="showApi">
          <input v-if="apiEditName" v-model="apiEditName" autofocus placeholder="接口名称" @keyup.enter="saveApi" />
          <input v-else v-model="apiName" autofocus placeholder="例如：借款首页" @keyup.enter="createApi" />
          <input v-if="apiEditName" v-model.number="apiPriority" type="number" min="0" placeholder="优先级" @keyup.enter="saveApi" />
          <button class="primary full" @click="apiEditName ? saveApi() : createApi()">保存</button>
        </template>
        <template v-else-if="sceneEditMode">
          <input v-model="editSceneName" autofocus placeholder="场景名称" />
          <div class="scene-form-row"><input v-model.number="editSceneStatus" type="number" min="100" max="599" placeholder="HTTP 状态码" /><input v-model.number="editSceneDelay" type="number" min="0" max="30000" placeholder="延迟毫秒" /></div>
          <select v-model="editSceneColor"><option value="blue">蓝色</option><option value="green">绿色</option><option value="yellow">黄色</option><option value="red">红色</option><option value="gray">灰色</option></select>
          <button class="primary full" @click="saveScene">保存</button>
        </template>
        <template v-else>
          <input v-model="sceneName" autofocus placeholder="例如：审核失败" @keyup.enter="createScene" /><button class="primary full" @click="createScene">创建</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style src="./App.css"></style>
