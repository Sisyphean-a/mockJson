<script setup lang="ts">
import { ref } from "vue";
import type { Api } from "./mock-admin-client";
import { useMockConsole } from "./useMockConsole";
import ApiSidebar from "./components/ApiSidebar.vue";
import ConsoleModals from "./components/ConsoleModals.vue";
import ContextMenu from "./components/ContextMenu.vue";
import MatchPanel from "./components/MatchPanel.vue";
import PackageBar from "./components/PackageBar.vue";
import RequestLogPanel from "./components/RequestLogPanel.vue";
import ScenarioPanel from "./components/ScenarioPanel.vue";
import type { ContextMenuItem, ContextMenuState, ContextTarget } from "./context-menu";
import { createRuntimeEndpoints } from "./runtime-endpoints";

const endpoints = createRuntimeEndpoints(window.location);
const c = useMockConsole(endpoints);
const { localMockUrl, lanMockUrl } = endpoints;
const contextMenu = ref<ContextMenuState | null>(null);

function closeContextMenu() {
  contextMenu.value = null;
}

function editApi(api: Api) {
  if (c.selectApi(api)) c.openApiEdit();
}

function createSceneForApi(api: Api) {
  if (c.selectApi(api)) c.openSceneCreate();
}

function menuFor(target: ContextTarget): { title: string; items: ContextMenuItem[] } {
  if (target.type === "api") {
    return {
      title: target.item.name,
      items: [
        { label: "编辑接口", action: () => editApi(target.item) },
        { label: target.item.enabled ? "停用 Mock" : "启用 Mock", action: () => c.toggle(target.item) },
        { label: "新建响应场景", action: () => createSceneForApi(target.item) },
        { label: "删除接口", separator: true, danger: true, action: () => c.deleteApiTarget(target.item) },
      ],
    };
  }

  if (target.type === "api-area") {
    const items: ContextMenuItem[] = c.pkg.value
      ? [{ label: "新建逻辑接口", action: () => c.openApiCreate() }]
      : [{ label: "新建测试包", action: () => c.openPackage() }];
    if (c.search.value.trim()) {
      items.push({ label: "清除接口搜索", separator: true, action: () => { c.search.value = ""; } });
    }
    return { title: "逻辑接口区域", items };
  }

  if (target.type === "scene") {
    const active = c.activeSceneId.value === target.item.id;
    return {
      title: target.item.name,
      items: [
        { label: "打开场景", action: () => c.selectScene(target.item) },
        { label: "编辑场景", action: () => c.openSceneEdit(target.item) },
        { label: active ? "停用场景" : "启用场景", action: () => c.toggleScene(target.item) },
        { label: "复制场景", action: () => c.duplicateScene(target.item) },
        { label: "删除场景", separator: true, danger: true, action: () => c.deleteScene(target.item) },
      ],
    };
  }

  return {
    title: "响应场景区域",
    items: [{ label: "新建响应场景", action: () => c.openSceneCreate() }],
  };
}

function openContextMenu(event: MouseEvent, target: ContextTarget) {
  event.preventDefault();
  const menu = menuFor(target);
  contextMenu.value = { x: event.clientX, y: event.clientY, ...menu };
}
</script>

<template>
  <div class="app-shell">
    <PackageBar :controller="c" />
    <main :class="{ 'startup-state': c.loading.value || c.loadError.value, 'logs-mode': c.activeView.value === 'logs' }">
      <ApiSidebar v-if="!c.loading.value && !c.loadError.value && c.activeView.value === 'workspace'" :controller="c" :open-context-menu="openContextMenu" />
      <section class="content" :aria-busy="c.loading.value">
        <div v-if="c.loading.value" class="loading-panel" role="status" aria-live="polite">
          <div class="loading-mark" aria-hidden="true">✦</div>
          <p>正在加载配置…</p>
        </div>
        <div v-else-if="c.loadError.value" class="loading-panel load-error" role="alert">
          <p>{{ c.loadError.value }}</p>
          <button class="primary" @click="c.retryLoad">重试</button>
        </div>
        <RequestLogPanel v-else-if="c.activeView.value === 'logs'" :controller="c" />
        <div v-else-if="!c.api.value" class="welcome">
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
          <button class="primary" @click="c.pkg.value ? c.openApiCreate() : c.openPackage()">＋ {{ c.pkg.value ? "新建逻辑接口" : "新建测试包" }}</button>
        </div>
        <template v-else>
          <div class="workspace">
            <MatchPanel :controller="c" />
            <ScenarioPanel :controller="c" :open-context-menu="openContextMenu" />
          </div>
        </template>
      </section>
    </main>
    <div v-if="c.toast.value" class="toast">{{ c.toast.value }}</div>
    <ConsoleModals :controller="c" />
    <ContextMenu :state="contextMenu" @close="closeContextMenu" />
  </div>
</template>

<style src="./App.css"></style>
