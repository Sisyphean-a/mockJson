<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ConsoleController } from "../console-controller";

type ConsoleModalsController = Pick<ConsoleController, "showApi" | "showScene" | "showPackage" | "showRealServices" | "sceneEditMode" | "editingPackageId" | "apiEditName" | "apiName" | "apiPriority" | "packageName" | "realServiceName" | "realServiceEditId" | "targetUrl" | "sceneName" | "editSceneName" | "editSceneStatus" | "editSceneDelay" | "editSceneColor" | "pkg" | "savePackage" | "saveApi" | "createApi" | "openNewRealService" | "openRealServiceEdit" | "selectRealService" | "saveRealService" | "deleteRealService" | "saveScene" | "createScene">;
const { controller: c } = defineProps<{ controller: ConsoleModalsController }>();
const modalRef = ref<HTMLElement | null>(null);
const modalTrigger = ref<HTMLElement | null>(null);
const modalOpen = computed(() => c.showApi.value || c.showScene.value || c.showPackage.value || c.showRealServices.value);

function closeModal() {
  c.showApi.value = false;
  c.showScene.value = false;
  c.showPackage.value = false;
  c.showRealServices.value = false;
  c.sceneEditMode.value = false;
}

function focusableElements() {
  if (!modalRef.value) return [] as HTMLElement[];
  return Array.from(modalRef.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0);
}

function handleKeydown(event: KeyboardEvent) {
  if (!modalOpen.value || !modalRef.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
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
    const first = modalRef.value?.querySelector<HTMLElement>("[autofocus]") || focusableElements()[0];
    (first || modalRef.value)?.focus();
  } else {
    if (modalTrigger.value?.isConnected) modalTrigger.value.focus();
    modalTrigger.value = null;
  }
});

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
    <div ref="modalRef" :class="['modal', { 'real-services-modal': c.showRealServices.value }]" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description" tabindex="-1">
      <button class="close" aria-label="关闭" @click="closeModal">×</button>
      <h2 id="modal-title">{{ c.showRealServices.value ? "管理真实服务" : c.showPackage.value ? (c.editingPackageId.value ? "编辑测试包" : "新建测试包") : c.showApi.value ? (c.apiEditName.value ? "编辑逻辑接口" : "新建逻辑接口") : c.sceneEditMode.value ? "编辑响应场景" : "新建响应场景" }}</h2>
      <p id="modal-description">{{ c.showRealServices.value ? "为当前测试包配置多个环境地址，切换后只影响未命中 Mock 时的真实转发。" : c.showPackage.value ? "按测试产品或版本管理独立的 Mock 配置。" : c.showApi.value ? "用业务名称和优先级标识一个可切换的接口。" : "每个场景保存一份完整的 JSON 响应。" }}</p>
      <template v-if="c.showRealServices.value">
        <div v-if="c.pkg.value?.realServices.length" class="real-service-list">
          <div v-for="service in c.pkg.value.realServices" :key="service.id" :class="['real-service-item', { active: service.id === c.pkg.value.activeRealServiceId }]">
            <div class="real-service-info">
              <div><strong>{{ service.name }}</strong><span v-if="service.id === c.pkg.value.activeRealServiceId" class="active-badge">当前使用</span></div>
              <code>{{ service.baseUrl || "未配置地址" }}</code>
            </div>
            <div class="real-service-actions">
              <button class="icon-action" :disabled="service.id === c.pkg.value.activeRealServiceId" @click="c.selectRealService(service.id)">使用</button>
              <button class="icon-action" @click="c.openRealServiceEdit(service)">编辑</button>
              <button class="icon-action danger" @click="c.deleteRealService(service)">删除</button>
            </div>
          </div>
        </div>
        <div v-else class="empty-real-services">还没有真实服务，新增后即可在顶部下拉框切换。</div>
        <div class="real-service-form">
          <h3>{{ c.realServiceEditId.value ? "编辑真实服务" : "新增真实服务" }}</h3>
          <label class="form-label" for="real-service-name">服务名称</label>
          <input id="real-service-name" v-model="c.realServiceName.value" autofocus placeholder="例如：测试环境" @keyup.enter="c.saveRealService" />
          <label class="form-label" for="real-service-url">基础地址</label>
          <input id="real-service-url" v-model="c.targetUrl.value" placeholder="https://api.example.com" @keyup.enter="c.saveRealService" />
          <div class="real-service-form-actions">
            <button v-if="c.realServiceEditId.value" class="secondary" @click="c.openNewRealService">新增服务</button>
            <button class="primary" @click="c.saveRealService">{{ c.realServiceEditId.value ? "保存修改" : "添加服务" }}</button>
          </div>
        </div>
      </template>
      <template v-else-if="c.showPackage.value">
        <label class="form-label" for="package-name">Package 名称</label>
        <input id="package-name" v-model="c.packageName.value" autofocus placeholder="例如：Android 测试包" @keyup.enter="c.savePackage" /><button class="primary full" @click="c.savePackage">保存</button>
      </template>
      <template v-else-if="c.showApi.value">
        <label class="form-label" for="api-name">接口名称</label>
        <input id="api-name" v-if="c.apiEditName.value" v-model="c.apiEditName.value" autofocus placeholder="接口名称" @keyup.enter="c.saveApi" />
        <input id="api-name" v-else v-model="c.apiName.value" autofocus placeholder="例如：借款首页" @keyup.enter="c.createApi" />
        <label v-if="c.apiEditName.value" class="form-label" for="api-priority">优先级</label>
        <input id="api-priority" v-if="c.apiEditName.value" v-model.number="c.apiPriority.value" type="number" min="0" placeholder="优先级" @keyup.enter="c.saveApi" />
        <button class="primary full" @click="c.apiEditName.value ? c.saveApi() : c.createApi()">保存</button>
      </template>
      <template v-else-if="c.sceneEditMode.value">
        <label class="form-label" for="edit-scene-name">场景名称</label>
        <input id="edit-scene-name" v-model="c.editSceneName.value" autofocus placeholder="场景名称" />
        <div class="scene-form-row">
          <div><label class="form-label" for="edit-scene-status">HTTP 状态码</label><input id="edit-scene-status" v-model.number="c.editSceneStatus.value" type="number" min="100" max="599" placeholder="例如 200" /></div>
          <div><label class="form-label" for="edit-scene-delay">延迟毫秒</label><input id="edit-scene-delay" v-model.number="c.editSceneDelay.value" type="number" min="0" max="30000" placeholder="例如 0" /></div>
        </div>
        <label class="form-label" for="edit-scene-color">状态颜色</label>
        <select id="edit-scene-color" v-model="c.editSceneColor.value"><option value="blue">蓝色</option><option value="green">绿色</option><option value="yellow">黄色</option><option value="red">红色</option><option value="gray">灰色</option></select>
        <button class="primary full" @click="c.saveScene">保存</button>
      </template>
      <template v-else>
        <label class="form-label" for="scene-name">场景名称</label>
        <input id="scene-name" v-model="c.sceneName.value" autofocus placeholder="例如：审核失败" @keyup.enter="c.createScene" /><button class="primary full" @click="c.createScene">创建</button>
      </template>
    </div>
  </div>
</template>
