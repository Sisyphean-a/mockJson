<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ContextMenuItem, ContextMenuState } from "../context-menu";

const props = defineProps<{ state: ContextMenuState | null }>();
const emit = defineEmits<{ close: [] }>();

const menuRef = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
const position = ref({ left: 0, top: 0 });
const positionStyle = computed(() => ({ left: `${position.value.left}px`, top: `${position.value.top}px` }));

function firstEnabledIndex(items: ContextMenuItem[]) {
  return items.findIndex((item) => !item.disabled);
}

async function focusActiveItem() {
  await nextTick();
  menuRef.value?.querySelector<HTMLElement>(`[data-menu-index="${activeIndex.value}"]`)?.focus();
}

function updatePosition() {
  const state = props.state;
  const menu = menuRef.value;
  if (!state || !menu) return;

  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - menu.offsetWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - menu.offsetHeight - margin);
  position.value = {
    left: Math.min(Math.max(margin, state.x), maxLeft),
    top: Math.min(Math.max(margin, state.y), maxTop),
  };
}

function moveFocus(direction: 1 | -1) {
  const items = props.state?.items || [];
  if (!items.length) return;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (activeIndex.value + direction * offset + items.length) % items.length;
    if (!items[index].disabled) {
      activeIndex.value = index;
      void focusActiveItem();
      return;
    }
  }
}

function activate(item: ContextMenuItem) {
  if (item.disabled) return;
  emit("close");
  void item.action();
}

function handlePointerDown(event: PointerEvent) {
  if (!menuRef.value?.contains(event.target as Node)) emit("close");
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.state) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveFocus(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(-1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const items = props.state.items;
    const enabled = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.disabled);
    const target = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
    if (target) {
      activeIndex.value = target.index;
      void focusActiveItem();
    }
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && props.state.items[activeIndex.value]) {
    event.preventDefault();
    activate(props.state.items[activeIndex.value]);
  }
}

function closeOnViewportChange() {
  if (props.state) emit("close");
}

watch(() => props.state, async (state) => {
  if (!state) return;
  const first = firstEnabledIndex(state.items);
  activeIndex.value = first >= 0 ? first : 0;
  position.value = { left: state.x, top: state.y };
  await nextTick();
  updatePosition();
  await focusActiveItem();
}, { flush: "post" });

onMounted(() => {
  document.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", closeOnViewportChange);
  window.addEventListener("scroll", closeOnViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handlePointerDown);
  document.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", closeOnViewportChange);
  window.removeEventListener("scroll", closeOnViewportChange, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.state"
      ref="menuRef"
      class="context-menu"
      :style="positionStyle"
      role="menu"
      :aria-label="props.state.title"
      tabindex="-1"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <div class="context-menu-title">{{ props.state.title }}</div>
      <template v-for="(item, index) in props.state.items" :key="`${item.label}-${index}`">
        <div v-if="item.separator" class="context-menu-separator" role="separator"></div>
        <button
          class="context-menu-item"
          :class="{ danger: item.danger }"
          :data-menu-index="index"
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          @mouseenter="activeIndex = index"
          @click="activate(item)"
        >
          <span>{{ item.label }}</span>
          <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>
