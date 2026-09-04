<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMockConsole } from "./useMockConsole";

const {
  state, search, selectedId, draft, jsonError, expanded, showApi, showScene,
  showPackage, sceneEditMode, draftDirty, loading, loadError, apiName, serverReady, apiEditName,
  apiPriority, sceneName, editSceneName, editSceneStatus, editSceneDelay,
  editSceneColor, packageName, editingPackageId, toast, targetUrl, ruleSource,
  ruleField, ruleOperator, ruleValue, addingRule, operators, urlFields,
  methodFields, ruleHint, pkg, api, scene, activeSceneId, activeScene, filtered,
  selectApi, switchPkg, openApiCreate, openPackage, savePackage, deletePackage,
  saveTargetUrl, toggle, openApiEdit, saveApi, deleteApi, activate, addRule,
  removeRule, updateLogic, changeSource, saveJson, createApi, createScene,
  openSceneCreate, openSceneEdit, duplicateScene, saveScene, deleteScene, retryLoad,
} = useMockConsole();

const modalRef = ref<HTMLElement | null>(null);
const modalTrigger = ref<HTMLElement | null>(null);
const modalOpen = computed(() => showApi.value || showScene.value || showPackage.value);

function closeModal() {
  showApi.value = false;
  showScene.value = false;
  showPackage.value = false;
  sceneEditMode.value = false;
}

function focusableModalElements() {
  if (!modalRef.value) return [] as HTMLElement[];
  return Array.from(modalRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
}

function handleModalKeydown(event: KeyboardEvent) {
  if (!modalOpen.value || !modalRef.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;

  const elements = focusableModalElements();
  if (!elements.length) {
    event.preventDefault();
    modalRef.value.focus();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const index = elements.indexOf(active as HTMLElement);
  if (!modalRef.value.contains(active) || index === -1) {
    event.preventDefault();
    (event.shiftKey ? elements[elements.length - 1] : elements[0]).focus();
  } else if (event.shiftKey && index === 0) {
    event.preventDefault();
    elements[elements.length - 1].focus();
  } else if (!event.shiftKey && index === elements.length - 1) {
    event.preventDefault();
    elements[0].focus();
  }
}

watch(modalOpen, async (open) => {
  if (open) {
    modalTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    const first = modalRef.value?.querySelector<HTMLElement>("[autofocus]") || focusableModalElements()[0];
    (first || modalRef.value)?.focus();
  } else {
    if (modalTrigger.value?.isConnected) modalTrigger.value.focus();
    modalTrigger.value = null;
  }
});

onMounted(() => document.addEventListener("keydown", handleModalKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleModalKeydown));
</script>

<template>
  <div class="app-shell">
    <header>
      <div class="brand">
        <span class="brand-mark">✦</span>
        <div><strong>Mock Console</strong><small>本地接口模拟控制台</small></div>
      </div>
      <div class="top-actions">
        <label for="package-select">当前测试包</label>
        <select id="package-select" :value="state.currentPackageId || ''" @change="switchPkg(($event.target as HTMLSelectElement).value)">
          <option v-for="p in state.packages" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <div class="target-config">
          <label for="target-url">真实服务</label>
          <input id="target-url" v-model="targetUrl" placeholder="https://api.example.com" @keyup.enter="saveTargetUrl" />
          <button class="save-target" @click="saveTargetUrl">保存</button>
          <button class="save-target" @click="openPackage()">＋ 包</button>
          <button v-if="pkg" class="save-target" @click="openPackage(pkg)">编辑包</button>
          <button v-if="pkg" class="save-target" @click="deletePackage(pkg)">删除包</button>
        </div>
        <span :class="['server-dot', { off: !serverReady && !loading, pending: loading }]" aria-hidden="true"></span>
        <span :class="['server-status', { loading, unavailable: !loading && !serverReady }]" role="status" aria-live="polite">{{ loading ? "连接中…" : serverReady ? "服务运行中" : "服务不可用" }}</span>
      </div>
    </header>

    <main>
      <aside>
        <div class="side-title">
          <span>逻辑接口</span>
          <button class="icon-btn" aria-label="新建逻辑接口" @click="openApiCreate">＋</button>
        </div>
        <div class="search"><span aria-hidden="true">⌕</span><input v-model="search" aria-label="搜索接口" placeholder="搜索接口..." /></div>
        <div class="api-list">
          <div v-if="loading" class="loading-state" role="status">正在加载配置…</div>
          <div v-else-if="loadError" class="load-error" role="alert">{{ loadError }}<br /><button @click="retryLoad">重试</button></div>
          <template v-else>
            <button v-for="item in filtered" :key="item.id" :class="['api-item', { active: item.id === selectedId }]" @click="selectApi(item)">
              <span class="api-icon" aria-hidden="true">{ }</span><span class="api-name">{{ item.name }}</span><span :class="['status-dot', item.enabled ? 'on' : 'off']" aria-hidden="true"></span>
            </button>
            <div v-if="pkg && search.trim() && !filtered.length" class="empty-side">
              没有找到匹配的接口<br /><button @click="search = ''">清除搜索</button>
            </div>
            <div v-else-if="!filtered.length" class="empty-side">
              {{ pkg ? "还没有接口" : "还没有测试包" }}<br /><button @click="openApiCreate">{{ pkg ? "创建第一个接口" : "创建测试包" }}</button>
            </div>
          </template>
        </div>
        <div class="side-foot">
          <div class="foot-label">当前包</div>
          <b>{{ pkg?.name || "未选择" }}</b><span>{{ pkg?.apis.length || 0 }} 个逻辑接口</span>
        </div>
      </aside>

      <section class="content" :aria-busy="loading">
        <div v-if="loading" class="loading-panel" role="status" aria-live="polite">
          <div class="loading-mark" aria-hidden="true">✦</div>
          <p>正在加载配置…</p>
        </div>
        <div v-else-if="loadError" class="loading-panel load-error" role="alert">
          <p>{{ loadError }}</p>
          <button class="primary" @click="retryLoad">重试</button>
        </div>
        <div v-else-if="!api" class="welcome">
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
              <button :class="['toggle', { checked: api!.enabled }]" :aria-label="api!.enabled ? '关闭 Mock' : '开启 Mock'" :aria-pressed="api!.enabled" @click="toggle(api!)"><i aria-hidden="true"></i></button>
            </div>
          </div>

          <div class="match-card">
            <div class="card-title" @click="api!.matchRules.length && (expanded = !expanded)">
              <span class="chevron">⌄</span><span>匹配条件</span><em>{{ api!.matchRules.length }} 条规则</em>
              <label class="logic-label" :for="`logic-select-${api!.id}`">规则关系</label>
              <select :id="`logic-select-${api!.id}`" class="logic-select" :value="api!.matchMode" @click.stop @change="updateLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')">
                <option value="AND">AND（全部满足）</option><option value="OR">OR（任一满足）</option>
              </select>
              <button class="add-rule" @click.stop="addingRule = !addingRule">＋ 添加条件</button>
            </div>
            <div v-if="addingRule" class="rule-form">
              <select v-model="ruleSource" aria-label="匹配来源" @change="changeSource">
                <option value="header">Header</option><option value="url">URL</option><option value="method">Method</option>
              </select>
              <select v-if="ruleSource !== 'header'" v-model="ruleField" aria-label="匹配字段">
                <option v-for="field in ruleSource === 'url' ? urlFields : methodFields" :key="field.value" :value="field.value">{{ field.label }}</option>
              </select>
              <input v-else v-model="ruleField" aria-label="Header 名称" placeholder="Header 名称，例如 Authorization" />
              <select v-model="ruleOperator" aria-label="匹配运算符"><option v-for="operator in operators" :key="operator.value" :value="operator.value">{{ operator.label }}</option></select>
              <input v-model="ruleValue" aria-label="匹配值" :placeholder="ruleOperator === 'exists' || ruleOperator === 'notExists' ? '此操作不需要填写值' : '输入匹配值'" @keyup.enter="addRule" />
              <div class="rule-hint">{{ ruleHint }}</div>
              <button class="primary small" @click="addRule">保存</button>
            </div>
            <div v-if="expanded && api!.matchRules.length" class="rules">
              <div v-for="rule in api!.matchRules" :key="rule.id" class="rule">
                <b>{{ rule.source === "header" ? "Header" : rule.source === "method" ? "Method" : "URL" }}</b>
                <span>{{ rule.field }}</span><span class="operator">{{ operators.find((item) => item.value === rule.operator)?.label || rule.operator }}</span>
                <code>{{ rule.value || "—" }}</code><button class="remove-rule" :aria-label="`删除匹配条件 ${rule.field}`" @click="removeRule(rule.id)">×</button>
              </div>
            </div>
            <div v-if="!api!.matchRules.length" class="no-rules">未配置匹配条件，此接口将匹配所有请求。点击“添加条件”开始配置。</div>
          </div>

          <div class="section-head">
            <div><h2>响应场景</h2><p>当前使用：<strong v-if="activeScene">{{ activeScene.name }}</strong><span v-else>未选择场景</span> · 点击其他场景即可立即切换</p></div>
            <button class="secondary" @click="openSceneCreate">＋ 新建场景</button>
          </div>
          <div class="scene-grid">
            <div v-for="item in api!.scenarios" :key="item.id" :class="['scene-card', { selected: item.id === activeSceneId }]">
              <button type="button" class="scene-select" :aria-pressed="item.id === activeSceneId" @click="activate(item)">
                <span :class="['scene-dot', item.color || 'blue']" aria-hidden="true"></span><strong>{{ item.name }}</strong>
                <span class="scene-meta">HTTP {{ item.status }} · {{ item.delayMs }}ms</span>
                <span v-if="item.id === activeSceneId" class="active-badge">当前使用</span>
              </button>
              <span class="scene-actions"><button type="button" :aria-label="`编辑场景 ${item.name}`" @click="openSceneEdit(item)">编辑</button><button type="button" :aria-label="`复制场景 ${item.name}`" @click="duplicateScene(item)">复制</button><button type="button" :aria-label="`删除场景 ${item.name}`" @click="deleteScene(item)">删除</button></span>
            </div>
            <div v-if="!api!.scenarios.length" class="empty-scenes">暂无场景，创建一个完整 JSON 响应开始使用</div>
          </div>

          <div v-if="scene" class="editor-panel">
            <div class="editor-head"><div><h2 id="response-editor-label">响应内容 <span>JSON</span></h2><p>当前编辑：{{ scene.name }}</p></div><button class="primary small" @click="saveJson">保存响应</button></div>
            <textarea id="json-editor" v-model="draft" class="json-editor" aria-labelledby="response-editor-label" spellcheck="false" @input="draftDirty = true"></textarea>
            <div v-if="jsonError" class="json-error">⚠ {{ jsonError }}</div>
          </div>
        </template>
      </section>
    </main>

    <div v-if="toast" class="toast">{{ toast }}</div>
    <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
      <div ref="modalRef" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description" tabindex="-1">
        <button class="close" aria-label="关闭" @click="closeModal">×</button>
        <h2 id="modal-title">{{ showPackage ? (editingPackageId ? "编辑测试包" : "新建测试包") : showApi ? (apiEditName ? "编辑逻辑接口" : "新建逻辑接口") : sceneEditMode ? "编辑响应场景" : "新建响应场景" }}</h2>
        <p id="modal-description">{{ showPackage ? "按测试产品或版本管理独立的 Mock 配置。" : showApi ? "用业务名称和优先级标识一个可切换的接口。" : "每个场景保存一份完整的 JSON 响应。" }}</p>
        <template v-if="showPackage">
          <label class="form-label" for="package-name">Package 名称</label>
          <input id="package-name" v-model="packageName" autofocus placeholder="例如：Android 测试包" @keyup.enter="savePackage" /><button class="primary full" @click="savePackage">保存</button>
        </template>
        <template v-else-if="showApi">
          <label class="form-label" for="api-name">接口名称</label>
          <input id="api-name" v-if="apiEditName" v-model="apiEditName" autofocus placeholder="接口名称" @keyup.enter="saveApi" />
          <input id="api-name" v-else v-model="apiName" autofocus placeholder="例如：借款首页" @keyup.enter="createApi" />
          <label v-if="apiEditName" class="form-label" for="api-priority">优先级</label>
          <input id="api-priority" v-if="apiEditName" v-model.number="apiPriority" type="number" min="0" placeholder="优先级" @keyup.enter="saveApi" />
          <button class="primary full" @click="apiEditName ? saveApi() : createApi()">保存</button>
        </template>
        <template v-else-if="sceneEditMode">
          <label class="form-label" for="edit-scene-name">场景名称</label>
          <input id="edit-scene-name" v-model="editSceneName" autofocus placeholder="场景名称" />
          <div class="scene-form-row">
            <div><label class="form-label" for="edit-scene-status">HTTP 状态码</label><input id="edit-scene-status" v-model.number="editSceneStatus" type="number" min="100" max="599" placeholder="例如 200" /></div>
            <div><label class="form-label" for="edit-scene-delay">延迟毫秒</label><input id="edit-scene-delay" v-model.number="editSceneDelay" type="number" min="0" max="30000" placeholder="例如 0" /></div>
          </div>
          <label class="form-label" for="edit-scene-color">状态颜色</label>
          <select id="edit-scene-color" v-model="editSceneColor"><option value="blue">蓝色</option><option value="green">绿色</option><option value="yellow">黄色</option><option value="red">红色</option><option value="gray">灰色</option></select>
          <button class="primary full" @click="saveScene">保存</button>
        </template>
        <template v-else>
          <label class="form-label" for="scene-name">场景名称</label>
          <input id="scene-name" v-model="sceneName" autofocus placeholder="例如：审核失败" @keyup.enter="createScene" /><button class="primary full" @click="createScene">创建</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style src="./App.css"></style>
