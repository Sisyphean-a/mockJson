<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
type Rule = {
  id: string;
  source: "header" | "url";
  field: string;
  operator: string;
  value: string;
};
type Scene = {
  id: string;
  name: string;
  status: number;
  delayMs: number;
  responseBody: any;
  color?: string;
};
type Api = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "AND" | "OR";
  matchRules: Rule[];
  activeScenarioId: string | null;
  scenarios: Scene[];
};
type Pkg = { id: string; name: string; targetBaseUrl: string; apis: Api[] };
type State = { currentPackageId: string | null; packages: Pkg[] };
const state = ref<State>({ currentPackageId: null, packages: [] }),
  search = ref(""),
  selectedId = ref<string | null>(null),
  sceneId = ref<string | null>(null),
  draft = ref(""),
  jsonError = ref(""),
  expanded = ref(true),
  showApi = ref(false),
  showScene = ref(false),
  apiName = ref(""),
  sceneName = ref(""),
  toast = ref(""),
  targetUrl = ref("");
const ruleSource = ref<"header" | "url">("header"),
  ruleField = ref("apiName"),
  ruleOperator = ref("equals"),
  ruleValue = ref(""),
  addingRule = ref(false);
const operators = [
  { value: "equals", label: "等于" },
  { value: "notEquals", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "notContains", label: "不包含" },
  { value: "exists", label: "存在" },
  { value: "notExists", label: "不存在" },
];
const headerFields = [{ value: "apiName", label: "apiName（业务标识）" }],
  urlFields = [
    { value: "path", label: "path（路径，不含查询参数）" },
    { value: "host", label: "host（域名和端口）" },
    { value: "fullUrl", label: "fullUrl（包含查询参数）" },
  ];
const ruleHint = computed(() => {
  if (ruleSource.value === "header")
    return "Reqable 转发请求时保留该 Header，服务就可以按它匹配。";
  if (ruleField.value === "path") return "推荐使用：例如 /api/chile/loan。";
  if (ruleField.value === "host")
    return "注意：Reqable 改写目标后，Host 可能变成本机地址。";
  return "包含完整路径和 ? 后面的查询参数，例如 case=failed。";
});
const pkg = computed(() =>
  state.value.packages.find((p) => p.id === state.value.currentPackageId),
);
const api = computed(() =>
  pkg.value?.apis.find((a) => a.id === selectedId.value),
);
const scene = computed(() =>
  api.value?.scenarios.find((s) => s.id === sceneId.value),
);
const activeSceneId = computed(
  () => api.value?.activeScenarioId || api.value?.scenarios[0]?.id || null,
);
const activeScene = computed(() =>
  api.value?.scenarios.find((s) => s.id === activeSceneId.value),
);
const filtered = computed(
  () =>
    pkg.value?.apis.filter((a) =>
      a.name.toLowerCase().includes(search.value.toLowerCase()),
    ) || [],
);
async function call(path: string, options: RequestInit = {}) {
  const r = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!r.ok) throw new Error((await r.json()).error || "请求失败");
  return r.json();
}
async function load() {
  state.value = await call("/__mock_admin/state");
  if (!selectedId.value) selectedId.value = pkg.value?.apis[0]?.id || null;
  if (!sceneId.value) sceneId.value = activeSceneId.value;
}
watch(
  scene,
  (s) => {
    draft.value = s ? JSON.stringify(s.responseBody, null, 2) : "";
    jsonError.value = "";
  },
  { immediate: true },
);
watch(pkg, () => {
  selectedId.value = pkg.value?.apis[0]?.id || null;
  sceneId.value = activeSceneId.value;
  targetUrl.value = pkg.value?.targetBaseUrl || "";
});
function selectApi(a: Api) {
  selectedId.value = a.id;
  sceneId.value = a.activeScenarioId || a.scenarios[0]?.id || null;
}
async function switchPkg(id: string) {
  await call("/__mock_admin/current-package/" + id, { method: "POST" });
  state.value = await call("/__mock_admin/state");
  selectedId.value = null;
  await load();
}
async function saveTargetUrl() {
  if (!pkg.value) return;
  const value = targetUrl.value.trim();
  if (value) {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      notice("真实服务地址必须是 http:// 或 https:// 地址");
      return;
    }
  }
  await call("/__mock_admin/packages/" + pkg.value.id, {
    method: "PATCH",
    body: JSON.stringify({ targetBaseUrl: value }),
  });
  pkg.value.targetBaseUrl = value;
  notice(value ? "真实服务地址已保存" : "已清空真实服务地址");
}
async function toggle(a: Api) {
  await call("/__mock_admin/apis/" + a.id, {
    method: "PATCH",
    body: JSON.stringify({ enabled: !a.enabled }),
  });
  a.enabled = !a.enabled;
  notice(a.enabled ? "Mock 已开启" : "已关闭 Mock，将转发真实服务");
}
async function activate(s: Scene) {
  if (!api.value) return;
  await call(`/__mock_admin/apis/${api.value.id}/activate/${s.id}`, {
    method: "POST",
  });
  api.value.activeScenarioId = s.id;
  sceneId.value = s.id;
  notice("场景已切换");
}
async function addRule() {
  if (
    !api.value ||
    (ruleOperator.value !== "exists" &&
      ruleOperator.value !== "notExists" &&
      !ruleValue.value.trim())
  )
    return;
  const rules = [
    ...api.value.matchRules,
    {
      id: crypto.randomUUID(),
      source: ruleSource.value,
      field: ruleField.value,
      operator: ruleOperator.value,
      value: ruleValue.value.trim(),
    },
  ];
  try {
    await call("/__mock_admin/apis/" + api.value.id, {
      method: "PATCH",
      body: JSON.stringify({ matchRules: rules }),
    });
    api.value.matchRules = rules;
    ruleValue.value = "";
    addingRule.value = false;
    notice("匹配条件已添加");
  } catch (e: any) {
    notice(e.message);
  }
}
async function removeRule(id: string) {
  if (!api.value) return;
  const rules = api.value.matchRules.filter((r) => r.id !== id);
  await call("/__mock_admin/apis/" + api.value.id, {
    method: "PATCH",
    body: JSON.stringify({ matchRules: rules }),
  });
  api.value.matchRules = rules;
  notice("匹配条件已删除");
}
async function updateLogic(mode: "AND" | "OR") {
  if (!api.value) return;
  await call("/__mock_admin/apis/" + api.value.id, {
    method: "PATCH",
    body: JSON.stringify({ matchMode: mode }),
  });
  api.value.matchMode = mode;
  notice("规则关系已更新");
}
function changeSource() {
  ruleField.value = ruleSource.value === "header" ? "apiName" : "path";
}
async function saveJson() {
  try {
    const body = JSON.parse(draft.value);
    await call("/__mock_admin/scenarios/" + scene.value!.id, {
      method: "PATCH",
      body: JSON.stringify({ responseBody: body }),
    });
    scene.value!.responseBody = body;
    notice("场景已保存");
    jsonError.value = "";
  } catch (e: any) {
    jsonError.value = e.message || "JSON 格式错误";
  }
}
async function createApi() {
  if (!pkg.value || !apiName.value.trim()) return;
  const a = await call("/__mock_admin/packages/" + pkg.value.id + "/apis", {
    method: "POST",
    body: JSON.stringify({ name: apiName.value }),
  });
  pkg.value.apis.push(a);
  apiName.value = "";
  showApi.value = false;
  selectApi(a);
  notice("接口已创建");
}
async function createScene() {
  if (!api.value || !sceneName.value.trim()) return;
  const s = await call("/__mock_admin/apis/" + api.value.id + "/scenarios", {
    method: "POST",
    body: JSON.stringify({
      name: sceneName.value,
      responseBody: {},
      activate: true,
    }),
  });
  api.value.scenarios.push(s);
  api.value.activeScenarioId = s.id;
  sceneName.value = "";
  showScene.value = false;
  sceneId.value = s.id;
  notice("场景已创建");
}
function notice(t: string) {
  toast.value = t;
  setTimeout(() => (toast.value = ""), 1800);
}
onMounted(load);
</script>
<template>
  <div class="app-shell">
    <header>
      <div class="brand">
        <span class="brand-mark">✦</span>
        <div>
          <strong>Mock Console</strong><small>本地接口模拟控制台</small>
        </div>
      </div>
      <div class="top-actions">
        <label>当前测试包</label
        ><select
          :value="state.currentPackageId || ''"
          @change="switchPkg(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="p in state.packages" :value="p.id">
            {{ p.name }}
          </option>
        </select>
        <div class="target-config">
          <span>真实服务</span>
          <input
            v-model="targetUrl"
            placeholder="https://api.example.com"
            @keyup.enter="saveTargetUrl"
          />
          <button class="save-target" @click="saveTargetUrl">保存</button>
        </div>
        <span class="server-dot"></span
        ><span class="server-status">服务运行中</span>
      </div>
    </header>
    <main>
      <aside>
        <div class="side-title">
          <span>逻辑接口</span
          ><button class="icon-btn" @click="showApi = true">＋</button>
        </div>
        <div class="search">
          <span>⌕</span><input v-model="search" placeholder="搜索接口..." />
        </div>
        <div class="api-list">
          <button
            v-for="a in filtered"
            :class="['api-item', { active: a.id === selectedId }]"
            @click="selectApi(a)"
          >
            <span class="api-icon">{ }</span
            ><span class="api-name">{{ a.name }}</span
            ><span :class="['status-dot', a.enabled ? 'on' : 'off']"></span>
          </button>
          <div v-if="!filtered.length" class="empty-side">
            还没有接口<br /><button @click="showApi = true">
              创建第一个接口
            </button>
          </div>
        </div>
        <div class="side-foot">
          <div class="foot-label">当前包</div>
          <b>{{ pkg?.name || "未选择" }}</b
          ><span>{{ pkg?.apis.length || 0 }} 个逻辑接口</span>
        </div>
      </aside>
      <section class="content">
        <div v-if="!api" class="welcome">
          <div class="welcome-icon">✦</div>
          <h1>开始配置 Mock 接口</h1>
          <p>创建一个逻辑接口，再为它添加可快速切换的响应场景。</p>
          <button class="primary" @click="showApi = true">
            ＋ 新建逻辑接口
          </button>
        </div>
        <template v-else
          ><div class="page-head">
            <div>
              <div class="eyebrow">逻辑接口</div>
              <h1>{{ api.name }}</h1>
              <p>配置匹配条件与响应场景</p>
            </div>
            <div class="head-toggle">
              <span>{{ api.enabled ? "Mock 已开启" : "Mock 已关闭" }}</span
              ><button
                :class="['toggle', { checked: api.enabled }]"
                @click="toggle(api)"
              >
                <i></i>
              </button>
            </div>
          </div>
          <div class="match-card">
            <div
              class="card-title"
              @click="api.matchRules.length && (expanded = !expanded)"
            >
              <span class="chevron">⌄</span><span>匹配条件</span
              ><em>{{ api.matchRules.length }} 条规则</em
              ><span class="logic-label">规则关系</span
              ><select
                class="logic-select"
                :value="api.matchMode"
                @click.stop
                @change="
                  updateLogic(
                    ($event.target as HTMLSelectElement).value as 'AND' | 'OR',
                  )
                "
              >
                <option value="AND">AND（全部满足）</option>
                <option value="OR">OR（任一满足）</option></select
              ><button class="add-rule" @click.stop="addingRule = !addingRule">
                ＋ 添加条件
              </button>
            </div>
            <div v-if="addingRule" class="rule-form">
              <select v-model="ruleSource" @change="changeSource">
                <option value="header">Header</option>
                <option value="url">URL</option></select
              ><select v-model="ruleField">
                <option
                  v-for="f in ruleSource === 'header'
                    ? headerFields
                    : urlFields"
                  :value="f.value"
                >
                  {{ f.label }}
                </option></select
              ><select v-model="ruleOperator">
                <option v-for="o in operators" :value="o.value">
                  {{ o.label }}
                </option></select
              ><input
                v-model="ruleValue"
                :placeholder="
                  ruleOperator === 'exists' || ruleOperator === 'notExists'
                    ? '此操作不需要填写值'
                    : '输入匹配值'
                "
                @keyup.enter="addRule"
              />
              <div class="rule-hint">{{ ruleHint }}</div>
              <button class="primary small" @click="addRule">保存</button>
            </div>
            <div v-if="expanded && api.matchRules.length" class="rules">
              <div v-for="r in api.matchRules" class="rule">
                <b>{{ r.source === "header" ? "Header" : "URL" }}</b
                ><span>{{ r.field }}</span
                ><span class="operator">{{
                  operators.find((o) => o.value === r.operator)?.label ||
                  r.operator
                }}</span
                ><code>{{ r.value || "—" }}</code
                ><button class="remove-rule" @click="removeRule(r.id)">
                  ×
                </button>
              </div>
            </div>
            <div v-if="!api.matchRules.length" class="no-rules">
              未配置匹配条件，此接口将匹配所有请求。点击“添加条件”开始配置。
            </div>
          </div>
          <div class="section-head">
            <div>
              <h2>响应场景</h2>
              <p>
                当前使用：<strong v-if="activeScene">{{
                  activeScene.name
                }}</strong
                ><span v-else>未选择场景</span> · 点击其他场景即可立即切换
              </p>
            </div>
            <button class="secondary" @click="showScene = true">
              ＋ 新建场景
            </button>
          </div>
          <div class="scene-grid">
            <button
              v-for="s in api.scenarios"
              :class="['scene-card', { selected: s.id === activeSceneId }]"
              @click="activate(s)"
            >
              <span :class="['scene-dot', s.color || 'blue']"></span
              ><strong>{{ s.name }}</strong
              ><span class="scene-meta"
                >HTTP {{ s.status }} · {{ s.delayMs }}ms</span
              ><span v-if="s.id === activeSceneId" class="active-badge">
                当前使用
              </span>
            </button>
            <div v-if="!api.scenarios.length" class="empty-scenes">
              暂无场景，创建一个完整 JSON 响应开始使用
            </div>
          </div>
          <div v-if="scene" class="editor-panel">
            <div class="editor-head">
              <div>
                <h2>响应内容 <span>JSON</span></h2>
                <p>当前编辑：{{ scene.name }}</p>
              </div>
              <button class="primary small" @click="saveJson">保存响应</button>
            </div>
            <textarea
              v-model="draft"
              spellcheck="false"
              class="json-editor"
            ></textarea>
            <div v-if="jsonError" class="json-error">⚠ {{ jsonError }}</div>
          </div></template
        >
      </section>
    </main>
    <div v-if="toast" class="toast">✓ {{ toast }}</div>
    <div
      v-if="showApi || showScene"
      class="modal-backdrop"
      @click.self="
        showApi = false;
        showScene = false;
      "
    >
      <div class="modal">
        <button
          class="close"
          @click="
            showApi = false;
            showScene = false;
          "
        >
          ×
        </button>
        <h2>{{ showApi ? "新建逻辑接口" : "新建响应场景" }}</h2>
        <p>
          {{
            showApi
              ? "用业务名称标识一个可切换的接口。"
              : "每个场景保存一份完整的 JSON 响应。"
          }}
        </p>
        <input
          v-if="showApi"
          v-model="apiName"
          autofocus
          placeholder="例如：借款首页"
          @keyup.enter="createApi"
        /><input
          v-else
          v-model="sceneName"
          autofocus
          placeholder="例如：审核失败"
          @keyup.enter="createScene"
        /><button
          class="primary full"
          @click="showApi ? createApi() : createScene()"
        >
          创建
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
:global(*) {
  box-sizing: border-box;
  font-family:
    "Noto Sans SC", "Google Sans Flex", "Google Sans", Avenir, "PingFang SC",
    "Microsoft YaHei", sans-serif;
}
:global(body) {
  margin: 0;
  background: #f5f7fb;
  color: #172033;
  font-family:
    "Noto Sans SC", "Google Sans Flex", "Google Sans", Avenir, "PingFang SC",
    "Microsoft YaHei", sans-serif;
}
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
header {
  height: 64px;
  background: #fff;
  border-bottom: 1px solid #e7ebf2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
}
.brand {
  display: flex;
  gap: 11px;
  align-items: center;
}
.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  display: grid;
  place-items: center;
}
.brand strong {
  display: block;
  font-size: 16px;
}
.brand small {
  display: block;
  color: #94a3b8;
  font-size: 11px;
  margin-top: 2px;
}
.top-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #64748b;
  font-size: 12px;
}
.top-actions select {
  border: 1px solid #dbe2ed;
  border-radius: 6px;
  padding: 8px 28px 8px 10px;
  background: #fff;
  color: #1e293b;
}
.target-config {
  display: flex;
  align-items: center;
  gap: 6px;
}
.target-config span {
  color: #94a3b8;
  white-space: nowrap;
}
.target-config input {
  width: 220px;
  border: 1px solid #dbe2ed;
  border-radius: 6px;
  padding: 8px 9px;
  color: #475569;
  background: #fff;
  outline: none;
  font-size: 12px;
}
.save-target {
  border: 1px solid #dbe2ed;
  border-radius: 6px;
  background: #fff;
  color: #2563eb;
  padding: 8px 10px;
  cursor: pointer;
}
.server-dot,
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  display: inline-block;
}
.server-status {
  color: #16a34a;
}
main {
  display: flex;
  flex: 1;
  min-height: 0;
}
aside {
  width: 258px;
  background: #fff;
  border-right: 1px solid #e7ebf2;
  display: flex;
  flex-direction: column;
  padding: 22px 14px;
}
.side-title {
  display: flex;
  justify-content: space-between;
  padding: 0 9px 16px;
  font-weight: 600;
}
.icon-btn {
  border: 0;
  background: #eff4ff;
  color: #2563eb;
  border-radius: 6px;
  font-size: 20px;
  width: 26px;
  height: 26px;
  line-height: 20px;
  cursor: pointer;
}
.search {
  background: #f7f8fa;
  border: 1px solid #edf0f4;
  border-radius: 6px;
  padding: 7px 9px;
  display: flex;
  gap: 6px;
  color: #94a3b8;
}
.search input {
  border: 0;
  background: transparent;
  outline: 0;
  width: 100%;
  font-size: 12px;
}
.api-list {
  overflow: auto;
  margin-top: 14px;
}
.api-item {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 11px 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
}
.api-item.active {
  background: #eff4ff;
  color: #1d4ed8;
  font-weight: 600;
}
.api-icon {
  flex: 0 0 18px;
  width: 18px;
  overflow: hidden;
  white-space: nowrap;
  font-family: monospace;
  color: #94a3b8;
}
.api-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-dot.off {
  background: #cbd5e1;
}
.empty-side {
  text-align: center;
  color: #94a3b8;
  padding: 40px 10px;
  line-height: 2;
}
.empty-side button {
  border: 0;
  color: #2563eb;
  background: none;
  cursor: pointer;
}
.side-foot {
  margin-top: auto;
  border-top: 1px solid #edf0f4;
  padding: 18px 9px 0;
  display: grid;
  gap: 5px;
  font-size: 12px;
}
.foot-label {
  color: #94a3b8;
}
.side-foot span {
  color: #94a3b8;
}
.content {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  overflow: auto;
  padding: clamp(24px, 3vw, 52px);
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.eyebrow {
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 11px;
  margin-bottom: 8px;
}
h1 {
  font-size: 27px;
  margin: 0 0 7px;
  letter-spacing: -0.02em;
}
h2 {
  font-size: 15px;
  margin: 0 0 5px;
}
.page-head p,
.section-head p,
.editor-head p,
.welcome p {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
}
.head-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 12px;
}
.toggle {
  width: 34px;
  height: 20px;
  border: 0;
  border-radius: 12px;
  background: #cbd5e1;
  padding: 2px;
  cursor: pointer;
}
.toggle i {
  display: block;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: 0.2s;
}
.toggle.checked {
  background: #2563eb;
}
.toggle.checked i {
  transform: translateX(14px);
}
.match-card,
.editor-panel {
  margin-top: 28px;
  background: #fff;
  border: 1px solid #e8ecf2;
  border-radius: 8px;
}
.card-title {
  border: 0;
  background: none;
  padding: 16px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  color: #334155;
  cursor: pointer;
}
.card-title em {
  font-style: normal;
  color: #94a3b8;
  font-size: 11px;
}
.logic-label {
  margin-left: auto;
  color: #94a3b8;
  font-size: 11px;
}
.logic-select {
  border: 1px solid #dbe2ed;
  border-radius: 5px;
  color: #475569;
  font-size: 11px;
  padding: 5px 7px;
  background: #fff;
}
.add-rule {
  border: 1px solid #dbe2ed;
  border-radius: 5px;
  color: #2563eb;
  background: #fff;
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
}
.rule-form {
  border-top: 1px solid #edf0f4;
  padding: 12px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rule-form select,
.rule-form input {
  min-width: 100px;
  border: 1px solid #dbe2ed;
  border-radius: 5px;
  padding: 7px 8px;
  color: #475569;
  background: #fff;
  font-size: 12px;
}
.rule-form input {
  flex: 1;
  min-width: 180px;
}
.rule-hint {
  flex: 1 0 100%;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.5;
}
.remove-rule {
  border: 0;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  margin-left: auto;
}
.chevron {
  color: #94a3b8;
}
.rules {
  border-top: 1px solid #edf0f4;
  padding: 12px 16px;
  display: grid;
  gap: 8px;
}
.rule {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12px;
}
.rule b {
  color: #7c3aed;
  background: #f4efff;
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 10px;
}
.rule span {
  color: #475569;
}
.rule .operator {
  color: #94a3b8;
}
.rule code {
  background: #f8fafc;
  padding: 4px 8px;
  border-radius: 4px;
  color: #2563eb;
}
.no-rules {
  padding: 0 16px 16px;
  color: #94a3b8;
  font-size: 12px;
}
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  margin: 34px 0 14px;
}
.secondary {
  border: 1px solid #dbe2ed;
  background: #fff;
  color: #2563eb;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}
.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.scene-card {
  position: relative;
  border: 1px solid #e7ebf2;
  background: #fff;
  border-radius: 7px;
  padding: 15px;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 8px;
  color: #334155;
}
.scene-card.selected {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px #eff4ff;
}
.scene-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
}
.scene-dot.green {
  background: #16a34a;
}
.scene-dot.yellow {
  background: #ca8a04;
}
.scene-dot.red {
  background: #dc2626;
}
.scene-dot.gray {
  background: #94a3b8;
}
.scene-meta {
  font-size: 11px;
  color: #94a3b8;
}
.active-badge {
  position: absolute;
  right: 10px;
  top: 12px;
  color: #2563eb;
  font-size: 10px;
}
.empty-scenes {
  grid-column: 1/-1;
  border: 1px dashed #dbe2ed;
  padding: 30px;
  text-align: center;
  color: #94a3b8;
}
.editor-panel {
  padding: 18px;
}
.editor-head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 14px;
}
.editor-head h2 span {
  font: 10px monospace;
  color: #7c3aed;
  background: #f4efff;
  border-radius: 3px;
  padding: 3px 5px;
  margin-left: 5px;
}
.json-editor {
  width: 100%;
  height: 320px;
  resize: vertical;
  background: #1e1e2e;
  color: #dbe4f0;
  border: 0;
  border-radius: 6px;
  padding: 16px;
  font:
    12px/1.6 "JetBrains Mono",
    monospace;
  outline: 0;
}
.primary {
  background: #2563eb;
  color: #fff;
  border: 0;
  border-radius: 6px;
  padding: 9px 14px;
  cursor: pointer;
}
.primary:hover {
  background: #1d4ed8;
}
.small {
  padding: 7px 12px;
  font-size: 12px;
}
.welcome {
  text-align: center;
  padding: 18vh 20px;
  color: #334155;
}
.welcome-icon {
  margin: auto auto 18px;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: #eff4ff;
  color: #2563eb;
  display: grid;
  place-items: center;
  font-size: 27px;
}
.welcome h1 {
  font-size: 24px;
}
.welcome .primary {
  margin-top: 25px;
}
.toast {
  position: fixed;
  right: 28px;
  bottom: 26px;
  background: #172033;
  color: #fff;
  border-radius: 7px;
  padding: 11px 16px;
  box-shadow: 0 8px 24px #0002;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0f172a66;
  display: grid;
  place-items: center;
}
.modal {
  position: relative;
  background: #fff;
  border-radius: 10px;
  width: 380px;
  padding: 28px;
  box-shadow: 0 20px 60px #0003;
}
.modal h2 {
  font-size: 18px;
}
.modal p {
  color: #94a3b8;
  font-size: 12px;
  margin: 8px 0 20px;
}
.modal input {
  width: 100%;
  border: 1px solid #dbe2ed;
  padding: 10px;
  border-radius: 6px;
  outline: 0;
  margin-bottom: 14px;
}
.full {
  width: 100%;
}
.close {
  position: absolute;
  right: 14px;
  top: 12px;
  border: 0;
  background: none;
  font-size: 22px;
  color: #94a3b8;
  cursor: pointer;
}
.json-error {
  color: #dc2626;
  font-size: 12px;
  margin-top: 8px;
}
@media (max-width: 760px) {
  header {
    padding: 0 16px;
  }
  .top-actions label,
  .server-status,
  .target-config span {
    display: none;
  }
  .target-config input {
    width: 150px;
  }
  main {
    flex-direction: column;
  }
  aside {
    width: 100%;
    height: 232px;
    flex: 0 0 232px;
    border-right: 0;
    border-bottom: 1px solid #e7ebf2;
    padding: 16px 14px;
  }
  .api-list {
    min-height: 0;
  }
  .side-foot {
    display: none;
  }
  .content {
    width: 100%;
    padding: 24px 18px;
  }
  .page-head {
    gap: 18px;
    flex-direction: column;
  }
  .card-title {
    flex-wrap: wrap;
  }
  .logic-label {
    margin-left: 0;
  }
}
</style>
