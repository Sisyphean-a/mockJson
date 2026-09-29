<script setup lang="ts">
import type { ConsoleController } from "../console-controller";

type PackageBarController = Pick<ConsoleController, "state" | "switchPkg" | "pkg" | "selectRealService" | "openRealServices" | "openPackageManager" | "serverReady" | "loading" | "activeView" | "showWorkspace" | "showLogs">;
const { controller: c } = defineProps<{ controller: PackageBarController }>();

async function switchPackage(event: Event) {
  const select = event.target as HTMLSelectElement;
  await c.switchPkg(select.value);
  select.value = c.state.value.currentPackageId || "";
}

async function switchEnvironment(event: Event) {
  const select = event.target as HTMLSelectElement;
  await c.selectRealService(select.value);
  select.value = c.pkg.value?.activeRealServiceId || "";
}
</script>

<template>
  <header>
    <div class="brand">
      <span class="brand-mark">✦</span>
      <div><strong>Mock Console</strong><small>本地接口模拟控制台</small></div>
    </div>
    <nav class="view-tabs" aria-label="控制台视图" role="tablist">
      <button :class="['view-tab', { active: c.activeView.value === 'workspace' }]" :aria-selected="c.activeView.value === 'workspace'" role="tab" @click="c.showWorkspace">接口配置</button>
      <button :class="['view-tab', { active: c.activeView.value === 'logs' }]" :aria-selected="c.activeView.value === 'logs'" role="tab" @click="c.showLogs">请求日志</button>
    </nav>
    <div class="top-actions">
      <div class="header-control">
        <div class="header-control-row">
          <label for="package-select">包</label>
          <select id="package-select" :value="c.state.value.currentPackageId || ''" @change="switchPackage">
            <option v-if="!c.state.value.packages.length" value="">未创建测试包</option>
            <option v-for="p in c.state.value.packages" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button class="header-manage" aria-label="管理测试包" title="管理测试包" @click="c.openPackageManager">管理</button>
        </div>
      </div>
      <div class="header-control environment-control">
        <div class="header-control-row">
          <label for="real-service-select" title="未命中 Mock 时的转发环境">环境</label>
          <select id="real-service-select" :value="c.pkg.value?.activeRealServiceId || ''" :disabled="!c.pkg.value?.realServices.length" :title="c.pkg.value?.realServices.find((item) => item.id === c.pkg.value?.activeRealServiceId)?.baseUrl || '未配置真实服务'" @change="switchEnvironment">
            <option v-if="!c.pkg.value?.realServices.length" value="">未配置</option>
            <option v-for="service in c.pkg.value?.realServices || []" :key="service.id" :value="service.id">{{ service.name }}{{ service.baseUrl ? '' : ' · 未配置地址' }}</option>
          </select>
          <button class="header-manage" :disabled="!c.pkg.value" aria-label="管理转发环境" title="管理转发环境" @click="c.openRealServices">管理</button>
        </div>
      </div>
      <div class="server-status-group">
        <span :class="['server-dot', { off: !c.serverReady.value && !c.loading.value, pending: c.loading.value }]" aria-hidden="true"></span>
        <span :class="['server-status', { loading: c.loading.value, unavailable: !c.loading.value && !c.serverReady.value }]" role="status" aria-live="polite">{{ c.loading.value ? "连接中…" : c.serverReady.value ? "服务运行中" : "服务不可用" }}</span>
      </div>
    </div>
  </header>
</template>
