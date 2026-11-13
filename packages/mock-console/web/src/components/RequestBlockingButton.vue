<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { discoverBlockingManager } from "../blocking-manager";

const dialog = ref<HTMLDialogElement>();
const frame = ref<HTMLIFrameElement>();
const managerUrl = ref("");
const error = ref("");
const loading = ref(false);
let controller: AbortController | undefined;
let readyTimer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  controller?.abort();
  clearTimeout(readyTimer);
  managerUrl.value = ""; error.value = ""; loading.value = true;
  const current = new AbortController();
  controller = current;
  try {
    const url = await discoverBlockingManager(window, current.signal);
    if (current.signal.aborted) return;
    managerUrl.value = url;
    readyTimer = setTimeout(() => {
      loading.value = false;
      error.value = "扩展管理页无法载入，请重新加载扩展并刷新控制台后重试。";
      managerUrl.value = "";
    }, 5000);
  } catch (cause) {
    if (current.signal.aborted) return;
    loading.value = false;
    error.value = cause instanceof Error ? cause.message : "无法连接扩展";
  }
}

function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !managerUrl.value || !event.data) return;
  if (event.data.type === "request-blocking-close") dialog.value?.close();
  if (event.data.type === "request-blocking-ready") { clearTimeout(readyTimer); loading.value = false; }
}
function open() { dialog.value?.showModal(); window.addEventListener("message", receive); void load(); }
function close() {
  controller?.abort(); clearTimeout(readyTimer); managerUrl.value = "";
  window.removeEventListener("message", receive);
}
onBeforeUnmount(close);
</script>

<template>
  <button class="header-manage" title="管理浏览器扩展的请求屏蔽规则，不影响 Mock 判定" @click="open">请求屏蔽</button>
  <Teleport to="body">
    <dialog ref="dialog" class="request-blocking-dialog" aria-labelledby="request-blocking-title" @close="close">
      <div class="blocking-heading"><strong id="request-blocking-title">请求屏蔽</strong><button aria-label="关闭请求屏蔽" @click="dialog?.close()">关闭</button></div>
      <p v-if="loading" class="blocking-status" role="status">正在连接扩展…</p>
      <div v-if="error" class="blocking-status" role="alert"><p>{{ error }}</p><button @click="load">重新连接</button></div>
      <iframe v-if="managerUrl" ref="frame" :src="managerUrl" title="请求屏蔽规则" />
    </dialog>
  </Teleport>
</template>

<style scoped>
.request-blocking-dialog { width: min(760px, calc(100vw - 24px)); height: min(740px, calc(100dvh - 24px)); max-height: calc(100dvh - 24px); padding: 0; border: 1px solid #e3e6ef; border-radius: 10px; color: #20243a; background: #fff; box-shadow: 0 12px 50px rgb(25 32 70 / 20%); }
.request-blocking-dialog[open] { display: flex; flex-direction: column; }
.request-blocking-dialog::backdrop { background: rgb(20 25 45 / 35%); }
.blocking-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #e3e6ef; }
.request-blocking-dialog button { min-height: 30px; padding: 4px 10px; border: 1px solid #e3e6ef; border-radius: 6px; background: #fff; color: #20243a; font: inherit; font-size: 13px; cursor: pointer; }
.request-blocking-dialog button:hover { background: #eef0ff; border-color: #b8c1f9; }
.request-blocking-dialog button:focus-visible { outline: 2px solid #5368e8; outline-offset: 2px; }
.blocking-status { padding: 4px 18px; font-size: 13px; color: #737b99; }
.blocking-status[role=alert] { color: #a82b40; }
iframe { flex: 1; min-height: 0; width: 100%; border: 0; }
</style>
