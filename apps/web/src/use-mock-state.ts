import { computed, ref, watch } from "vue";
import type { MockAdminClient, Api, Pkg, Scene, State } from "./mock-admin-client";

export function useMockState(client: MockAdminClient) {
  const state = ref<State>({ currentPackageId: null, packages: [] });
  const selectedId = ref<string | null>(null);
  const sceneId = ref<string | null>(null);
  const search = ref("");
  const loading = ref(true);
  const loadError = ref("");
  const serverReady = ref(false);

  const pkg = computed(() => state.value.packages.find((item) => item.id === state.value.currentPackageId));
  const api = computed(() => pkg.value?.apis.find((item) => item.id === selectedId.value));
  const scene = computed(() => api.value?.scenarios.find((item) => item.id === sceneId.value));
  const activeSceneId = computed(() => {
    if (!api.value) return null;
    return api.value.scenarios.some((item) => item.id === api.value?.activeScenarioId)
      ? api.value.activeScenarioId
      : null;
  });
  const activeScene = computed(() => api.value?.scenarios.find((item) => item.id === activeSceneId.value));
  const filtered = computed(() => pkg.value?.apis.filter((item) => item.name.toLowerCase().includes(search.value.toLowerCase())) || []);

  async function load() {
    loading.value = true;
    loadError.value = "";
    try {
      state.value = await client.getState();
      serverReady.value = true;
      synchronizeSelection();
    } catch (error) {
      serverReady.value = false;
      loadError.value = error instanceof Error ? error.message : "无法加载配置";
      throw error;
    } finally {
      loading.value = false;
    }
  }

  function synchronizeSelection() {
    const current = pkg.value;
    if (!current) {
      selectedId.value = null;
      sceneId.value = null;
      return;
    }
    if (!current.apis.some((item) => item.id === selectedId.value)) selectedId.value = current.apis[0]?.id || null;
    const selected = current.apis.find((item) => item.id === selectedId.value);
    if (!selected?.scenarios.some((item) => item.id === sceneId.value))
      sceneId.value = selected?.activeScenarioId || selected?.scenarios[0]?.id || null;
  }

  function selectApi(item: Api, canLeave = () => true) {
    if (!canLeave()) return false;
    selectedId.value = item.id;
    sceneId.value = item.activeScenarioId || item.scenarios[0]?.id || null;
    return true;
  }

  function selectScene(item: Scene, canLeave = () => true) {
    if (sceneId.value === item.id || !canLeave()) return false;
    sceneId.value = item.id;
    return true;
  }

  function replaceApi(updated: Api) {
    const current = pkg.value;
    const index = current?.apis.findIndex((item) => item.id === updated.id) ?? -1;
    if (current && index >= 0) current.apis[index] = updated;
  }

  watch(pkg, () => { synchronizeSelection(); });

  return {
    state, search, selectedId, sceneId, loading, loadError, serverReady,
    pkg, api, scene, activeSceneId, activeScene, filtered,
    load, selectApi, selectScene, replaceApi, synchronizeSelection,
  };
}
