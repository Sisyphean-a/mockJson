<script setup lang="ts">
import type { ConsoleController } from "../console-controller";

type PackageBarController = Pick<ConsoleController, "state" | "switchPkg" | "targetUrl" | "saveTargetUrl" | "openPackage" | "pkg" | "deletePackage" | "serverReady" | "loading" | "activeView" | "showWorkspace" | "showLogs">;
const { controller: c } = defineProps<{ controller: PackageBarController }>();
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
      <div class="package-select">
        <label for="package-select">当前测试包</label>
        <select id="package-select" :value="c.state.value.currentPackageId || ''" @change="c.switchPkg(($event.target as HTMLSelectElement).value)">
          <option v-for="p in c.state.value.packages" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="target-config">
        <label for="target-url">真实服务</label>
        <input id="target-url" v-model="c.targetUrl.value" placeholder="https://api.example.com" @keyup.enter="c.saveTargetUrl" />
        <button class="save-target" @click="c.saveTargetUrl">保存</button>
      </div>
      <div class="package-actions">
        <button class="save-target package-add" @click="c.openPackage()">＋ 包</button>
        <button v-if="c.pkg.value" class="save-target" @click="c.openPackage(c.pkg.value)">编辑包</button>
        <button v-if="c.pkg.value" class="save-target" @click="c.deletePackage(c.pkg.value)">删除包</button>
      </div>
      <div class="server-status-group">
        <span :class="['server-dot', { off: !c.serverReady.value && !c.loading.value, pending: c.loading.value }]" aria-hidden="true"></span>
        <span :class="['server-status', { loading: c.loading.value, unavailable: !c.loading.value && !c.serverReady.value }]" role="status" aria-live="polite">{{ c.loading.value ? "连接中…" : c.serverReady.value ? "服务运行中" : "服务不可用" }}</span>
      </div>
    </div>
  </header>
</template>
