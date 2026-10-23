<script setup lang="ts">
import { computed, ref } from "vue";
import { VueDraggable } from "vue-draggable-plus";
import type { ConsoleController } from "../console-controller";
import type { ResponseBranch, ResponseCondition } from "../../../shared/types";
import ResponseConditionEditor from "./ResponseConditionEditor.vue";
const { controller: c } = defineProps<{ controller: ConsoleController }>();
const selection = computed(() => c.responseDraft.value.selection);
const creatingFor = ref<string | null>(null);
const sceneName = ref("");
const createError = ref("");
const creating = ref(false);
const trialBranches = computed(() => c.trialSelection.value?.branches ?? []);
const saveLabel = computed(() => c.responseSaving.value ? "保存中…" : c.responseModeInactive.value ? c.responseDirty.value ? "保存并启用" : "启用条件分支" : "保存");
const statusLabels = { matched: "命中", missed: "未命中", skipped: "未执行" };
const operatorLabels = { equals: "等于", notEquals: "不等于", contains: "包含", exists: "存在", notExists: "不存在", gt: ">", gte: "≥", lt: "<", lte: "≤" };
function sceneNameFor(id: string | null) { return c.api.value?.scenarios.find((s) => s.id === id)?.name || "未选择场景"; }
function summary(condition: ResponseCondition) {
  return `${condition.source === "header" ? "请求头" : "请求体"} ${condition.field || "（待填字段）"} ${operatorLabels[condition.operator]}${["exists", "notExists"].includes(condition.operator) ? "" : ` ${JSON.stringify(condition.value)}`}`;
}
function branchSummary(branch: ResponseBranch) {
  return branch.conditions.map((condition, index) => {
    const previous = branch.conditions[index - 1];
    const repeated = condition.operator === "equals" && previous?.operator === "equals" && previous.source === condition.source && previous.field === condition.field;
    return repeated ? JSON.stringify(condition.value) : summary(condition);
  }).join(branch.matchMode === "AND" ? " 且 " : " 或 ") || "尚无条件";
}
function errorAt(path: string) { return c.responseErrorPath.value === path ? c.responseError.value : ""; }
async function createScene(branch: ResponseBranch) {
  if (creating.value) return;
  creating.value = true; createError.value = "";
  try { await c.createBranchScene(branch, sceneName.value); creatingFor.value = null; sceneName.value = ""; }
  catch (error) { createError.value = error instanceof Error ? error.message : "创建失败"; }
  finally { creating.value = false; }
}
</script>

<template>
  <div class="branch-workspace">
    <div class="branch-toolbar">
      <div class="branch-title-group"><h2>条件分支</h2><span>从上到下，首个命中生效</span></div>
      <div class="branch-actions"><button class="secondary" @click="c.trialOpen.value = !c.trialOpen.value">{{ c.trialOpen.value ? '← 返回规则' : '试算请求' }}</button><button class="primary" :title="creating ? '请等待场景创建完成' : !c.responseDirty.value && !c.responseModeInactive.value ? '没有未保存修改' : '保存并应用当前条件分支配置'" :disabled="c.responseSaving.value || creating || (!c.responseDirty.value && !c.responseModeInactive.value)" @click="c.saveResponseSelection">{{ saveLabel }}</button></div>
    </div>
    <p v-if="c.responseError.value && !c.responseErrorPath.value" class="response-error save-error" role="alert">保存未生效：{{ c.responseError.value }}</p>
    <div v-show="!c.trialOpen.value" class="branch-scroll">
      <fieldset class="branch-fields" :disabled="c.responseSaving.value || creating">
        <VueDraggable v-model="selection.branches" class="branch-flow" handle=".branch-drag" :disabled="c.responseSaving.value || creating" :animation="160" ghost-class="drag-ghost" @start="creatingFor = null">
          <article v-for="(branch, index) in selection.branches" :key="branch.id" class="response-branch">
            <div class="branch-heading">
              <span class="branch-drag" aria-hidden="true" title="拖动调整分支优先级">⠿</span><span class="branch-number">{{ index + 1 }}</span>
              <template v-if="c.expandedBranch.value === branch.id">
                <label class="branch-name-field"><span class="response-sr-only">分支名称</span><input v-model="branch.name" maxlength="200" placeholder="分支名称" :aria-invalid="!!errorAt(`branches.${index}.name`)" /></label>
                <button class="icon-action branch-icon-button" :aria-label="`收起分支 ${branch.name}`" :title="`收起分支 ${branch.name}`" aria-expanded="true" @click="c.expandedBranch.value = null"><svg class="branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 15 6-6 6 6" /></svg></button>
              </template>
              <button v-else class="branch-expand" :aria-label="`展开分支 ${branch.name}`" :title="`展开分支 ${branch.name}`" aria-expanded="false" @click="c.expandedBranch.value = branch.id"><span :title="branch.name">{{ branch.name || '未命名分支' }}</span><span class="branch-disclosure" aria-hidden="true"><svg class="branch-icon" viewBox="0 0 24 24" focusable="false"><path d="m6 9 6 6 6-6" /></svg></span></button>
              <button class="icon-action branch-icon-button" :disabled="index === 0" :title="index === 0 ? '已是第一条分支' : '上移分支'" :aria-label="`上移分支 ${branch.name}`" @click="c.moveBranch(index, -1)"><svg class="branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
              <button class="icon-action branch-icon-button" :disabled="index === selection.branches.length - 1" :title="index === selection.branches.length - 1 ? '已是最后一条分支' : '下移分支'" :aria-label="`下移分支 ${branch.name}`" @click="c.moveBranch(index, 1)"><svg class="branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14m-6-6 6 6 6-6" /></svg></button>
              <button class="icon-action branch-icon-button danger" :aria-label="`删除分支 ${branch.name}`" :title="`删除分支 ${branch.name}`" @click="c.deleteBranch(branch)"><svg class="branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" /></svg></button>
            </div>
            <p v-if="errorAt(`branches.${index}.name`)" class="response-error branch-name-error">{{ c.responseError.value }}</p>
            <div v-if="c.expandedBranch.value !== branch.id" class="branch-summary-row">
              <p class="branch-summary" :title="branchSummary(branch)">{{ branchSummary(branch) }}</p>
              <span class="branch-target-arrow" aria-hidden="true"><svg class="branch-icon" viewBox="0 0 24 24" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></span>
              <button class="branch-scene-link icon-action" :disabled="!branch.scenarioId" :aria-label="`查看场景 ${sceneNameFor(branch.scenarioId)}`" :title="sceneNameFor(branch.scenarioId)" @click="c.viewBranchScene(branch.scenarioId)">{{ sceneNameFor(branch.scenarioId) }}</button>
            </div>
            <div v-else class="branch-edit">
              <div class="branch-conditions">
                <div class="conditions-toolbar">
                  <label class="condition-mode"><span class="response-sr-only">条件组合</span><select v-model="branch.matchMode"><option value="OR">任一条件</option><option value="AND">全部条件</option></select></label>
                  <div class="condition-tools">
                    <details v-if="branch.conditions.some(condition => condition.source === 'body')" class="condition-help"><summary>字段写法</summary><p>JSON 字段用 /user/status 定位，数组用 /items/0/id。键名中的 / 写成 ~1，~ 写成 ~0。</p></details>
                    <button class="icon-action" @click="branch.conditions.push(c.newCondition())">＋ 添加条件</button>
                  </div>
                </div>
                <div class="condition-list-head condition-grid" aria-hidden="true"><span>来源</span><span>字段</span><span>判断</span><span>比较值</span><span></span></div>
                <ResponseConditionEditor v-for="(condition, ci) in branch.conditions" :key="condition.id" :condition="condition" :error="errorAt(`branches.${index}.conditions.${ci}`)"><button class="icon-action branch-icon-button danger" aria-label="移除条件" title="移除条件" @click="branch.conditions.splice(ci, 1)"><svg class="branch-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M6 18 18 6" /></svg></button></ResponseConditionEditor>
                <p v-if="errorAt(`branches.${index}.conditions`)" class="response-error">{{ c.responseError.value }}</p>
              </div>
              <div class="branch-response">
                <label class="branch-target-field"><span>返回场景</span><select v-model="branch.scenarioId" aria-label="目标响应场景"><option value="" disabled>请选择场景</option><option v-for="s in c.api.value?.scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
                <button class="icon-action" @click="creatingFor = branch.id; createError = ''; sceneName = ''">＋ 新建场景</button>
                <button class="icon-action" :disabled="!branch.scenarioId" :title="!branch.scenarioId ? '请先选择目标场景' : '查看目标场景'" @click="c.viewBranchScene(branch.scenarioId)">查看</button>
                <small v-if="errorAt(`branches.${index}.scenarioId`)" class="response-error">{{ c.responseError.value }}</small>
              </div>
              <form v-if="creatingFor === branch.id" class="inline-scene-create" @submit.prevent="createScene(branch)"><label>场景名称<input v-model="sceneName" autofocus required maxlength="200" /></label><button class="primary" type="submit" :disabled="creating">{{ creating ? '创建中…' : '创建并选用' }}</button><button class="secondary" type="button" @click="creatingFor = null">取消</button><p v-if="createError" class="response-error" role="alert">{{ createError }}</p></form>
            </div>
          </article>
        </VueDraggable>
        <button class="add-response-branch secondary" @click="c.addBranch">＋ 添加分支</button>
        <section class="branch-fallback">
          <h3>未命中时</h3>
          <label class="fallback-toggle"><input v-model="selection.fallback.enabled" type="checkbox" />兜底响应</label>
          <label v-if="selection.fallback.enabled" class="fallback-target"><span class="response-sr-only">兜底场景</span><select v-model="selection.fallback.scenarioId"><option :value="null" disabled>请选择兜底场景</option><option v-for="s in c.api.value?.scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
          <span v-else class="pass-decision">→ 放行真实请求</span>
          <p v-if="errorAt('fallback')" class="response-error">{{ c.responseError.value }}</p>
          <button v-if="selection.fallback.enabled && !c.api.value?.scenarios.length" class="icon-action" @click="c.openSceneCreate">＋ 新建场景</button>
        </section>
      </fieldset>
    </div>
    <section v-show="c.trialOpen.value" class="response-trial" aria-label="试算请求">
      <div class="trial-heading"><h3>试算当前接口</h3><span>{{ c.responseDirty.value || c.responseModeInactive.value ? '草稿试算' : '已保存配置试算' }}</span></div>
      <label>请求头（JSON 对象，值为文本）<textarea v-model="c.trialHeaders.value" spellcheck="false" rows="3"></textarea></label>
      <label>请求体状态<select v-model="c.trialAvailability.value"><option value="available">可读取</option><option value="absent">无法取得</option><option value="unavailable">读取失败</option><option value="upload">上传内容未采集</option></select></label>
      <label v-if="c.trialAvailability.value === 'available'">JSON 请求体<textarea v-model="c.trialBody.value" spellcheck="false" rows="5"></textarea></label>
      <button class="primary" @click="c.runTrial">开始试算</button><p v-if="c.trialError.value" class="response-error" role="alert">{{ c.trialError.value }}</p>
      <div v-if="c.trialResult.value" class="trial-result" aria-live="polite">
        <strong v-if="c.trialStale.value" class="response-error">结果已过期，请重新试算</strong>
        <h3>{{ c.trialResult.value.action === 'branch' ? `命中分支「${trialBranches.find(b => b.id === c.trialResult.value?.branchId)?.name || '已删除分支'}」` : c.trialResult.value.action === 'fallback' ? '返回兜底场景' : '放行真实请求' }}<template v-if="c.trialResult.value.scenarioId"> → {{ sceneNameFor(c.trialResult.value.scenarioId) }}</template></h3>
        <div v-for="result in c.trialResult.value.branches" :key="result.id" class="trial-branch"><strong>{{ trialBranches.find(b => b.id === result.id)?.name }} · {{ statusLabels[result.status] }}</strong><p v-for="(condition, i) in result.conditions" :key="i"><code>{{ trialBranches.find(b => b.id === result.id)?.conditions[i]?.field }}</code>：{{ condition.reason }}<template v-if="Object.hasOwn(condition, 'actual')">；实际 <code>{{ JSON.stringify(condition.actual) }}</code></template><template v-if="trialBranches.find(b => b.id === result.id)?.conditions[i]">；预期 <code>{{ summary(trialBranches.find(b => b.id === result.id)!.conditions[i]) }}</code></template></p></div>
        <p v-if="c.trialResult.value.action === 'pass'" class="field-hint">仅展示放行决定，不发送请求，也不承诺真实服务响应。Chrome 扩展由浏览器直接请求。</p>
        <p v-if="c.trialResult.value.action === 'pass' && !c.pkg.value?.realServices.find(s => s.id === c.pkg.value?.activeRealServiceId)?.baseUrl" class="response-error">当前代理未配置真实服务，实际代理放行将报告配置错误。</p>
      </div>
    </section>
  </div>
</template>
