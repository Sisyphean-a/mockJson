<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMockConsole } from "./useMockConsole";

const {
  state, search, selectedId, draft, jsonError, showApi, showScene,
  showPackage, sceneEditMode, draftDirty, loading, loadError, apiName, serverReady, apiEditName,
  apiPriority, sceneName, editSceneName, editSceneStatus, editSceneDelay,
  editSceneColor, packageName, editingPackageId, toast, targetUrl, ruleSource,
  ruleField, ruleOperator, ruleValue, addingRule, operators, urlFields,
  methodFields, ruleHint, pkg, api, scene, activeSceneId, activeScene, filtered,
  selectApi, selectScene, switchPkg, openApiCreate, openPackage, savePackage, deletePackage,
  saveTargetUrl, toggle, openApiEdit, saveApi, deleteApi, toggleScene, addRule,
  removeRule, updateLogic, changeSource, saveJson, createApi, createScene,
  openSceneCreate, openSceneEdit, duplicateScene, saveScene, deleteScene, retryLoad,
} = useMockConsole();

const mockPort = window.location.port === "22334" ? "22333" : window.location.port || "22333";
const localMockUrl = `http://127.0.0.1:${mockPort}`;
const lanMockUrl = `http://<电脑局域网 IP>:${mockPort}/原始路径`;

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
            <div v-for="item in filtered" :key="item.id" :class="['api-item', { active: item.id === selectedId }]">
              <button :class="['toggle', 'compact-toggle', { checked: item.enabled }]" :aria-label="item.enabled ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled" @click="toggle(item)"><i aria-hidden="true"></i></button>
              <button class="api-select" @click="selectApi(item)"><span class="api-name">{{ item.name }}</span></button>
            </div>
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
          <p>接入请求，再创建匹配条件和可快速切换的响应场景。</p>
          <section class="quick-start" aria-labelledby="quick-start-title">
            <div class="quick-start-heading">
              <div><span class="quick-start-kicker">首次使用</span><h2 id="quick-start-title">先把请求接入 Mock 服务</h2></div>
              <div class="mock-address"><span>本机入口</span><code>{{ localMockUrl }}</code></div>
            </div>
            <ol>
              <li>在 Reqable 等客户端中，把需要 Mock 的请求重写到 <code>{{ lanMockUrl }}</code>。</li>
              <li>保留原始路径、查询参数和业务 Header，再在这里配置对应的匹配条件。</li>
              <li>接口和场景都启用后，重新发起请求；未命中时会转发真实服务或明确报错。</li>
            </ol>
          </section>
          <button class="primary" @click="pkg ? openApiCreate() : openPackage()">＋ {{ pkg ? "新建逻辑接口" : "新建测试包" }}</button>
        </div>

        <template v-else>
          <div class="workspace">
            <section class="match-card" aria-labelledby="match-title">
              <div class="panel-heading">
                <div>
                  <span class="panel-context">逻辑接口 · {{ api!.name }}</span>
                  <h1 id="match-title">匹配条件</h1>
                </div>
                <div class="interface-actions">
                  <button class="text-action" @click="openApiEdit">编辑接口</button>
                  <button class="text-action danger" @click="deleteApi">删除接口</button>
                </div>
              </div>

              <div class="match-toolbar">
                <div class="logic-control">
                  <label :for="`logic-select-${api!.id}`">匹配方式</label>
                  <select :id="`logic-select-${api!.id}`" class="logic-select" :value="api!.matchMode" @change="updateLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR')">
                    <option value="AND">同时满足（AND）</option><option value="OR">满足任一（OR）</option>
                  </select>
                </div>
                <button class="add-rule" @click="addingRule = !addingRule">＋ 添加条件</button>
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
                <button class="primary small" @click="addRule">保存条件</button>
              </div>

              <div v-if="api!.matchRules.length" class="rules">
                <div class="rule rule-head" aria-hidden="true">
                  <span>来源</span><span>字段</span><span>条件</span><span>值</span><span>操作</span>
                </div>
                <div v-for="rule in api!.matchRules" :key="rule.id" class="rule">
                  <b>{{ rule.source === "header" ? "Header" : rule.source === "method" ? "Method" : "URL" }}</b>
                  <span>{{ rule.field }}</span><span class="operator">{{ operators.find((item) => item.value === rule.operator)?.label || rule.operator }}</span>
                  <code>{{ rule.value || "—" }}</code><button class="remove-rule" :aria-label="`删除匹配条件 ${rule.field}`" @click="removeRule(rule.id)">删除</button>
                </div>
              </div>
              <div v-else class="no-rules">未配置匹配条件，此接口不会处理任何请求。点击“添加条件”开始配置。</div>
            </section>

            <section class="scenario-panel" aria-labelledby="scenario-title">
              <div class="section-head">
                <div><h2 id="scenario-title">场景（响应状态）</h2><p>选择场景进行编辑，通过开关快速切换当前 Mock 响应</p></div>
                <button class="secondary" @click="openSceneCreate">＋ 新建场景</button>
              </div>

              <div v-if="api!.scenarios.length" class="scenario-workspace">
                <div class="scene-list" role="list" aria-label="响应场景列表">
                  <div v-for="item in api!.scenarios" :key="item.id" :class="['scene-row', { selected: item.id === scene?.id }]" role="listitem">
                    <button :class="['toggle', 'compact-toggle', 'scene-toggle', { checked: item.id === activeSceneId }]" :aria-label="item.id === activeSceneId ? `停用场景 ${item.name}` : `启用场景 ${item.name}`" :aria-pressed="item.id === activeSceneId" @click="toggleScene(item)"><i aria-hidden="true"></i></button>
                    <button type="button" class="scene-select" :aria-current="item.id === scene?.id ? 'true' : undefined" @click="selectScene(item)">
                      <span :class="['scene-dot', item.color || 'blue']" aria-hidden="true"></span>
                      <span class="scene-name">{{ item.name }}</span>
                      <span v-if="item.id === activeSceneId" class="active-badge">当前启用</span>
                      <span class="row-chevron" aria-hidden="true">›</span>
                    </button>
                  </div>
                  <div class="scene-list-foot">场景默认不启用；开关同一时间只启用一个场景</div>
                </div>

                <div v-if="scene" class="editor-panel">
                  <div class="scene-detail-bar">
                    <div class="scene-identity">
                      <span>场景名称</span><strong>{{ scene.name }}</strong>
                      <button class="icon-action" :aria-label="`编辑场景 ${scene.name}`" @click="openSceneEdit(scene)">编辑</button>
                      <button class="icon-action" :aria-label="`复制场景 ${scene.name}`" @click="duplicateScene(scene)">复制</button>
                      <button class="icon-action danger" :aria-label="`删除场景 ${scene.name}`" @click="deleteScene(scene)">删除</button>
                    </div>
                    <div class="scene-properties">
                      <span>HTTP 状态码 <b>{{ scene.status }}</b></span>
                      <span>延迟（ms）<b>{{ scene.delayMs }}</b></span>
                    </div>
                  </div>
                  <label id="response-editor-label" for="json-editor" class="response-label">响应体（JSON）</label>
                  <textarea id="json-editor" v-model="draft" class="json-editor" aria-labelledby="response-editor-label" spellcheck="false" @input="draftDirty = true"></textarea>
                  <div v-if="jsonError" class="json-error">⚠ {{ jsonError }}</div>
                  <div class="editor-footer">
                    <span :class="['save-state', { dirty: draftDirty }]">{{ draftDirty ? "有未保存的修改" : "响应内容已同步" }}</span>
                    <button class="primary" @click="saveJson">保存响应</button>
                  </div>
                </div>
              </div>
              <div v-else class="empty-scenes">暂无场景，创建一个完整 JSON 响应开始使用</div>
            </section>
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
