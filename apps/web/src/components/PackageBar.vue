<script setup lang="ts">
import type { ConsoleController } from "../console-controller";

type PackageBarController = Pick<ConsoleController, "state" | "switchPkg" | "targetUrl" | "saveTargetUrl" | "openPackage" | "pkg" | "deletePackage" | "serverReady" | "loading">;
const { controller: c } = defineProps<{ controller: PackageBarController }>();
</script>

<template>
  <header>
    <div class="brand">
      <span class="brand-mark">✦</span>
      <div><strong>Mock Console</strong><small>本地接口模拟控制台</small></div>
    </div>
    <div class="top-actions">
      <label for="package-select">当前测试包</label>
      <select id="package-select" :value="c.state.value.currentPackageId || ''" @change="c.switchPkg(($event.target as HTMLSelectElement).value)">
        <option v-for="p in c.state.value.packages" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <div class="target-config">
        <label for="target-url">真实服务</label>
        <input id="target-url" v-model="c.targetUrl.value" placeholder="https://api.example.com" @keyup.enter="c.saveTargetUrl" />
        <button class="save-target" @click="c.saveTargetUrl">保存</button>
        <button class="save-target" @click="c.openPackage()">＋ 包</button>
        <button v-if="c.pkg.value" class="save-target" @click="c.openPackage(c.pkg.value)">编辑包</button>
        <button v-if="c.pkg.value" class="save-target" @click="c.deletePackage(c.pkg.value)">删除包</button>
      </div>
      <span :class="['server-dot', { off: !c.serverReady.value && !c.loading.value, pending: c.loading.value }]" aria-hidden="true"></span>
      <span :class="['server-status', { loading: c.loading.value, unavailable: !c.loading.value && !c.serverReady.value }]" role="status" aria-live="polite">{{ c.loading.value ? "连接中…" : c.serverReady.value ? "服务运行中" : "服务不可用" }}</span>
    </div>
  </header>
</template>
