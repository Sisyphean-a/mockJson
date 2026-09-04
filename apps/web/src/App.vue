<script setup lang="ts">
import { useMockConsole } from "./useMockConsole";
import ApiSidebar from "./components/ApiSidebar.vue";
import ConsoleModals from "./components/ConsoleModals.vue";
import MatchPanel from "./components/MatchPanel.vue";
import PackageBar from "./components/PackageBar.vue";
import ScenarioPanel from "./components/ScenarioPanel.vue";
import { createRuntimeEndpoints } from "./runtime-endpoints";

const endpoints = createRuntimeEndpoints(window.location);
const c = useMockConsole(endpoints);
const { localMockUrl, lanMockUrl } = endpoints;
</script>

<template>
  <div class="app-shell">
    <PackageBar :controller="c" />
    <main :class="{ 'startup-state': c.loading.value || c.loadError.value }">
      <ApiSidebar v-if="!c.loading.value && !c.loadError.value" :controller="c" />
      <section class="content" :aria-busy="c.loading.value">
        <div v-if="c.loading.value" class="loading-panel" role="status" aria-live="polite">
          <div class="loading-mark" aria-hidden="true">✦</div>
          <p>正在加载配置…</p>
        </div>
        <div v-else-if="c.loadError.value" class="loading-panel load-error" role="alert">
          <p>{{ c.loadError.value }}</p>
          <button class="primary" @click="c.retryLoad">重试</button>
        </div>
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
            <ScenarioPanel :controller="c" />
          </div>
        </template>
      </section>
    </main>
    <div v-if="c.toast.value" class="toast">{{ c.toast.value }}</div>
    <ConsoleModals :controller="c" />
  </div>
</template>

<style src="./App.css"></style>
