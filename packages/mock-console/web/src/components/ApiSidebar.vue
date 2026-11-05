<script setup lang="ts">
import { computed, ref } from "vue";
import { VueDraggable } from "vue-draggable-plus";
import type { ConsoleController } from "../console-controller";
import type { Api, ApiGroup } from "../mock-admin-client";
import type { OpenContextMenu } from "../context-menu";
import { orderApisAfterGroupDrop } from "../api-group-order";

type ApiSidebarController = Pick<ConsoleController, "openApiCreate" | "openApiGroupCreate" | "search" | "filtered" | "selectedId" | "pkg" | "toggle" | "selectApi" | "reorderApis" | "reorderApiGroups" | "setApiGroup">;
const { controller: c, openContextMenu } = defineProps<{ controller: ApiSidebarController; openContextMenu: OpenContextMenu }>();

type DragDataset = { dataset?: Record<string, string | undefined> };
type DragDatasetEvent = { item?: DragDataset; to?: DragDataset };

type GroupView = { key: string; id: string | null; name: string; apis: Api[]; archived: number };

const UNGROUPED_KEY = "";

// Rule: 接口展示顺序 = apiGroups 顺序 → 各组内 apis 数组顺序；扁平 apis 数组仍是持久化的唯一顺序来源，分组不参与匹配。
// Rule: 所有接口都已分组时隐藏“未分组”区；拖拽期间临时显示，作为放回未分组的落点。
const draggingApi = ref(false);
// Rule: 归档接口默认不出现在侧栏；展示时降低对比度，和普通接口区分。
const showArchived = ref(false);
const visibleApi = (api: Api) => showArchived.value || !api.archived;
const archivedCount = computed(() => (c.pkg.value?.apis ?? []).filter((api) => api.archived).length);
const flatView = computed(() => (c.pkg.value?.apis ?? []).filter(visibleApi));
const searchResults = computed(() => c.filtered.value.filter(visibleApi));

const groupViews = computed<GroupView[]>(() => {
  const pkg = c.pkg.value;
  const buckets = new Map<string, Api[]>();
  for (const group of pkg?.apiGroups ?? []) buckets.set(group.id, []);
  const ungrouped: Api[] = [];
  const archivedByGroup = new Map<string, number>();
  for (const api of pkg?.apis ?? []) {
    const key = api.groupId && buckets.has(api.groupId) ? api.groupId : UNGROUPED_KEY;
    if (!visibleApi(api)) {
      // Guarantee: 隐藏的归档成员仍计入分组，避免分组看起来像空组。
      archivedByGroup.set(key, (archivedByGroup.get(key) ?? 0) + 1);
      continue;
    }
    (key === UNGROUPED_KEY ? ungrouped : buckets.get(key)!).push(api);
  }
  const views: GroupView[] = (pkg?.apiGroups ?? []).map((group) => ({
    key: group.id, id: group.id, name: group.name, apis: buckets.get(group.id)!, archived: archivedByGroup.get(group.id) ?? 0,
  }));
  // Rule: 只有已建分组时才出现“未分组”区，未分组区始终排在全部分组之后。
  if (views.length && (ungrouped.length || draggingApi.value))
    views.push({ key: UNGROUPED_KEY, id: null, name: "未分组", apis: ungrouped, archived: archivedByGroup.get(UNGROUPED_KEY) ?? 0 });
  return views;
});

const orderedGroupViews = computed(() => groupViews.value.filter((view) => view.id !== null));
const ungroupedView = computed(() => groupViews.value.find((view) => view.id === null));

const groupsModel = computed({
  get: () => orderedGroupViews.value,
  set: (views: GroupView[]) => {
    const current = c.pkg.value;
    if (!current) return;
    const byId = new Map(current.apiGroups.map((group) => [group.id, group]));
    const ordered = views
      .map((view) => (view.id ? byId.get(view.id) : undefined))
      .filter((group): group is ApiGroup => Boolean(group));
    if (ordered.length === current.apiGroups.length) current.apiGroups = ordered;
  },
});

// Guarantee: 抓取拖拽前的全局布局，拖拽结束据此计算归属与顺序的增量保存。
let layoutBeforeDrag: { ids: string[]; groupBy: Map<string, string | null> } | null = null;
let groupsBeforeDrag: string[] | null = null;

function captureLayout() {
  const pkg = c.pkg.value;
  return {
    ids: pkg?.apis.map((item) => item.id) ?? [],
    groupBy: new Map((pkg?.apis ?? []).map((item) => [item.id, item.groupId ?? null])),
  };
}

function onApiDragStart() {
  layoutBeforeDrag = captureLayout();
  draggingApi.value = true;
}

async function onApiDragEnd(evt: DragDatasetEvent) {
  const before = layoutBeforeDrag;
  const current = c.pkg.value;
  layoutBeforeDrag = null;
  draggingApi.value = false;
  if (!before || !current) return;

  const draggedId = evt.item?.dataset?.apiId;
  if (!draggedId) return;
  const dragged = current.apis.find((item) => item.id === draggedId);
  if (!dragged) return;

  // Rule: 顺序以 update:model-value 写回模型的拖拽结果为准。库在 onUpdate 中会把 DOM 还原成旧顺序，
  // 等下一帧才由 Vue 按模型重绘，此处读 DOM 只会拿到旧顺序，导致组内排序被自己覆盖。
  const groupId = dragged.groupId ?? null;
  const previousGroup = before.groupBy.get(draggedId) ?? null;
  if (groupId !== previousGroup) await c.setApiGroup(dragged, groupId, previousGroup);
  await c.reorderApis(current.apis.map((item) => item.id), before.ids);
}

function readGroupKey(value: string | undefined) {
  if (value === undefined) return undefined;
  return value === UNGROUPED_KEY ? null : value;
}

// Effect: 归属变化的写入必须发生在扁平数组重排之前，两侧列表的 setter 以下次读取的归属为准。
// Rule: 模型必须立即采用拖拽后的组内顺序，否则 Vue 会按旧数组重渲染，松手即回弹。
function onGroupModel(groupId: string | null, apis: Api[]) {
  const current = c.pkg.value;
  if (!current) return;
  const wanted = groupId ?? null;
  for (const api of apis) if ((api.groupId ?? null) !== wanted) api.groupId = wanted;
  const next = orderApisAfterGroupDrop(current.apis, current.apiGroups, wanted, apis);
  current.apis.splice(0, current.apis.length, ...next);
}

// Rule: 平铺列表只渲染可见接口，拖拽结果按新顺序写回，被隐藏的归档接口保留在末尾。
function onFlatModel(apis: Api[]) {
  const current = c.pkg.value;
  if (!current) return;
  const shown = new Set(apis.map((api) => api.id));
  const hidden = current.apis.filter((api) => !shown.has(api.id));
  current.apis.splice(0, current.apis.length, ...apis, ...hidden);
}

function onGroupDragStart() {
  groupsBeforeDrag = c.pkg.value?.apiGroups.map((group) => group.id) ?? null;
}

async function onGroupDragEnd() {
  const previous = groupsBeforeDrag;
  const current = c.pkg.value;
  groupsBeforeDrag = null;
  if (!previous || !current) return;
  await c.reorderApiGroups(current.apiGroups.map((group) => group.id), previous);
}

const collapsedGroups = ref<Record<string, boolean>>({});
function toggleGroupCollapse(id: string) {
  collapsedGroups.value[id] = !collapsedGroups.value[id];
}

function groupHeaderTarget(id: string): ApiGroup | undefined {
  return c.pkg.value?.apiGroups.find((group) => group.id === id);
}

const itemGroupOptions = { name: "api-items", pull: true, put: true };
const sortableOptions = {
  "ghost-class": "drag-ghost",
  "chosen-class": "drag-chosen",
  "drag-class": "drag-dragging",
  animation: 160,
  delay: 180,
  "delay-on-touch-only": true,
  "touch-start-threshold": 5,
  "fallback-on-body": true,
};

function openApiContextFromKeyboard(event: KeyboardEvent, item: Api) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom }), { type: "api", item });
}

function openGroupContextFromKeyboard(event: KeyboardEvent, group: ApiGroup) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  openContextMenu(new MouseEvent("contextmenu", { clientX: rect.left + 16, clientY: rect.bottom }), { type: "api-group", item: group });
}
</script>

<template>
  <aside>
    <div class="side-title" @contextmenu.stop>
      <span>逻辑接口</span>
      <div class="side-title-actions">
        <button v-if="archivedCount" class="icon-btn archive-toggle" :aria-pressed="showArchived" :aria-label="showArchived ? '隐藏归档' : '展示归档'" :title="showArchived ? '隐藏归档' : '展示归档'" @click="showArchived = !showArchived">
          <svg v-if="showArchived" class="side-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="4" rx="1.5" /><path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8" /><path d="M12 10.5v6m-2.5-2.5L12 16.5l2.5-2.5" /></svg>
          <svg v-else class="side-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="4" rx="1.5" /><path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8" /><path d="M12 16.5v-6m-2.5 2.5L12 10.5l2.5 2.5" /></svg>
        </button>
        <button class="icon-btn" :disabled="!c.pkg.value" aria-label="新建接口分组" title="新建接口分组" @click="c.openApiGroupCreate"><svg class="side-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="11" height="11" rx="2" /><rect x="10" y="10" width="11" height="11" rx="2" /></svg></button>
        <button class="icon-btn accent" aria-label="新建逻辑接口" title="新建逻辑接口" @click="c.openApiCreate">＋</button>
      </div>
    </div>
    <div class="api-region" @contextmenu.prevent="openContextMenu($event, { type: 'api-area' })">
      <div class="search" @contextmenu.stop><span aria-hidden="true">⌕</span><input v-model="c.search.value" aria-label="搜索接口" placeholder="搜索接口..." /></div>

      <div v-if="c.search.value.trim()" class="api-list">
        <div v-for="item in searchResults" :key="item.id" :class="['api-item', { active: item.id === c.selectedId.value, 'is-off': !item.enabled, 'is-archived': item.archived }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
          <button class="api-select" aria-haspopup="menu" :aria-current="item.id === c.selectedId.value ? 'true' : undefined" @click="c.selectApi(item)"><span class="api-name" :title="item.name">{{ item.name }}</span></button>
          <button :class="['toggle', 'compact-toggle', { checked: item.enabled && !item.passthrough }]" :aria-label="item.enabled && !item.passthrough ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled && !item.passthrough" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
        </div>
        <div v-if="searchResults.length" class="sort-hint">清除搜索后可拖拽排序</div>
      </div>

      <div v-else-if="orderedGroupViews.length" class="api-scroll">
        <VueDraggable v-model="groupsModel" class="api-groups" handle=".group-drag-handle" draggable=".group-block" :group="{ name: 'api-groups' }" v-bind="sortableOptions" @start="onGroupDragStart" @end="onGroupDragEnd">
          <section v-for="view in orderedGroupViews" :key="view.key" class="group-block" :data-group-id="view.key">
            <div class="group-header" tabindex="0" @click="toggleGroupCollapse(view.key)" @keydown.enter.prevent="toggleGroupCollapse(view.key)" @keydown.space.prevent="toggleGroupCollapse(view.key)" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api-group', item: groupHeaderTarget(view.key)! })" @keydown="openGroupContextFromKeyboard($event, groupHeaderTarget(view.key)!)">
              <span class="drag-handle group-drag-handle" aria-hidden="true" title="长按拖拽分组排序">⠿</span>
              <span aria-hidden="true" class="group-chevron" :class="{ collapsed: collapsedGroups[view.key] }"></span>
              <span class="group-name" :title="view.name">{{ view.name }}</span>
              <span class="group-count">{{ view.apis.length }}</span>
            </div>
            <VueDraggable
              :model-value="view.apis"
              class="group-items"
              :class="{ collapsed: collapsedGroups[view.key], 'has-hidden': !view.apis.length && view.archived > 0 }"
              :data-group-id="view.key"
              :group="itemGroupOptions"
              handle=".drag-handle"
              v-bind="sortableOptions"
              @update:model-value="(value: Api[]) => onGroupModel(view.id!, value)"
              @start="onApiDragStart"
              @end="onApiDragEnd"
            >
              <div v-for="item in view.apis" :key="item.id" :data-api-id="item.id" :class="['api-item', { active: item.id === c.selectedId.value, 'is-off': !item.enabled, 'is-archived': item.archived }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
                <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
                <button class="api-select" aria-haspopup="menu" :aria-current="item.id === c.selectedId.value ? 'true' : undefined" @click="c.selectApi(item)"><span class="api-name" :title="item.name">{{ item.name }}</span></button>
                <button :class="['toggle', 'compact-toggle', { checked: item.enabled && !item.passthrough }]" :aria-label="item.enabled && !item.passthrough ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled && !item.passthrough" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
              </div>
            </VueDraggable>
          </section>
        </VueDraggable>
        <section v-if="ungroupedView" :data-group-id="UNGROUPED_KEY" class="group-block ungrouped">
          <div class="group-header" tabindex="0" @click="toggleGroupCollapse(UNGROUPED_KEY)" @keydown.enter.prevent="toggleGroupCollapse(UNGROUPED_KEY)" @keydown.space.prevent="toggleGroupCollapse(UNGROUPED_KEY)">
            <span class="group-handle-gap" aria-hidden="true"></span>
            <span aria-hidden="true" class="group-chevron" :class="{ collapsed: collapsedGroups[UNGROUPED_KEY] }"></span>
            <span class="group-name">未分组</span>
            <span class="group-count">{{ ungroupedView.apis.length }}</span>
          </div>
          <VueDraggable
            :model-value="ungroupedView.apis"
            class="group-items"
            :class="{ collapsed: collapsedGroups[UNGROUPED_KEY] }"
            :data-group-id="UNGROUPED_KEY"
            :group="itemGroupOptions"
            handle=".drag-handle"
            v-bind="sortableOptions"
            @update:model-value="(value: Api[]) => onGroupModel(null, value)"
            @start="onApiDragStart"
            @end="onApiDragEnd"
          >
            <div v-for="item in ungroupedView.apis" :key="item.id" :data-api-id="item.id" :class="['api-item', { active: item.id === c.selectedId.value, 'is-off': !item.enabled, 'is-archived': item.archived }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
              <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
              <button class="api-select" aria-haspopup="menu" :aria-current="item.id === c.selectedId.value ? 'true' : undefined" @click="c.selectApi(item)"><span class="api-name" :title="item.name">{{ item.name }}</span></button>
              <button :class="['toggle', 'compact-toggle', { checked: item.enabled && !item.passthrough }]" :aria-label="item.enabled && !item.passthrough ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled && !item.passthrough" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
            </div>
          </VueDraggable>
        </section>
      </div>

      <VueDraggable
        v-else-if="c.pkg.value && flatView.length"
        :model-value="flatView"
        class="api-list"
        handle=".drag-handle"
        v-bind="sortableOptions"
        @update:model-value="onFlatModel"
        @start="onApiDragStart"
        @end="onApiDragEnd"
      >
        <div v-for="item in flatView" :key="item.id" :data-api-id="item.id" :class="['api-item', { active: item.id === c.selectedId.value, 'is-off': !item.enabled, 'is-archived': item.archived }]" @contextmenu.stop.prevent="openContextMenu($event, { type: 'api', item })" @keydown="openApiContextFromKeyboard($event, item)">
          <span class="drag-handle" aria-hidden="true" title="长按拖拽排序">⠿</span>
          <button class="api-select" aria-haspopup="menu" :aria-current="item.id === c.selectedId.value ? 'true' : undefined" @click="c.selectApi(item)"><span class="api-name" :title="item.name">{{ item.name }}</span></button>
          <button :class="['toggle', 'compact-toggle', { checked: item.enabled && !item.passthrough }]" :aria-label="item.enabled && !item.passthrough ? `停用接口 ${item.name}` : `启用接口 ${item.name}`" :aria-pressed="item.enabled && !item.passthrough" @click="c.toggle(item)"><i aria-hidden="true"></i></button>
        </div>
      </VueDraggable>
      <div v-else class="api-list"></div>

      <div v-if="c.pkg.value && c.search.value.trim() && !searchResults.length" class="empty-side">
        没有找到匹配的接口<br /><button class="secondary" @click="c.search.value = ''">清除搜索</button>
      </div>
      <div v-else-if="!flatView.length" class="empty-side">
        <template v-if="archivedCount">全部接口都已归档<br /><button class="secondary" @click="showArchived = true">展示归档</button></template>
        <template v-else>{{ c.pkg.value ? "还没有接口" : "还没有测试包" }}<br /><button class="secondary" @click="c.openApiCreate">{{ c.pkg.value ? "创建第一个接口" : "创建测试包" }}</button></template>
      </div>
    </div>
    <div class="side-foot" @contextmenu.stop>
      <div class="foot-label">当前包</div>
      <b>{{ c.pkg.value?.name || "未选择" }}</b><span>{{ c.pkg.value?.apis.length || 0 }} 个逻辑接口</span>
    </div>
  </aside>
</template>
