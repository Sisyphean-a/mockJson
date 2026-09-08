<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { basicSetup } from "codemirror";
import { json } from "@codemirror/lang-json";
import { EditorState, Prec, RangeSetBuilder } from "@codemirror/state";
import { foldAll, indentUnit, unfoldAll } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet } from "@codemirror/view";

const props = withDefaults(defineProps<{
  value: string;
  error?: boolean;
}>(), {
  error: false,
});

const emit = defineEmits<{
  (event: "update:value", value: string): void;
  (event: "user-change"): void;
  (event: "save"): void;
}>();

const editorHost = ref<HTMLElement | null>(null);
const editorView = shallowRef<EditorView>();
const syncingExternalValue = ref(false);
let lastEmittedValue = props.value;
let validationTimer: ReturnType<typeof setTimeout> | undefined;
const validJson = ref(isValidJson(props.value));
const lineCount = ref(1);
const cursorLine = ref(1);
const cursorColumn = ref(1);

const jsonIndentSize = 4;
const jsonValidationDebounceMs = 120;
const indentDecorationCache = new Map<number, Decoration>();

function getIndentDecoration(indent: number) {
  let decoration = indentDecorationCache.get(indent);
  if (!decoration) {
    decoration = Decoration.line({
      attributes: {
        class: "cm-json-indented-line",
        style: `--json-indent: ${indent}ch`,
      },
    });
    indentDecorationCache.set(indent, decoration);
  }
  return decoration;
}

function buildIndentDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLineFrom = -1;

  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      if (line.from > lastLineFrom) {
        lastLineFrom = line.from;
        const whitespace = line.text.match(/^[ \t]+/)?.[0] || "";
        const indent = whitespace.replace(/\t/g, "    ").length;
        if (indent > 0) builder.add(line.from, line.from, getIndentDecoration(indent));
      }
      if (line.to >= range.to || line.to >= view.state.doc.length) break;
      position = line.to + 1;
    }
  }

  return builder.finish();
}

const indentGuidePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildIndentDecorations(view);
  }

  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (update.docChanged || update.viewportChanged) this.decorations = buildIndentDecorations(update.view);
  }
}, {
  decorations: (value) => value.decorations,
});

const selectionTextDecoration = Decoration.mark({
  class: "cm-json-selection",
});

function buildSelectionTextDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.state.selection.ranges) {
    if (!range.empty) builder.add(range.from, range.to, selectionTextDecoration);
  }
  return builder.finish();
}

const selectionTextPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildSelectionTextDecorations(view);
  }

  update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
    if (update.docChanged || update.selectionSet) this.decorations = buildSelectionTextDecorations(update.view);
  }
}, {
  decorations: (value) => value.decorations,
});

function isValidJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function updateCursorStatus(view: EditorView) {
  const position = view.state.selection.main.head;
  const line = view.state.doc.lineAt(position);
  lineCount.value = view.state.doc.lines;
  cursorLine.value = line.number;
  cursorColumn.value = position - line.from + 1;
}

function updateDocumentStatus(view: EditorView, value = view.state.doc.toString()) {
  updateCursorStatus(view);
  validJson.value = isValidJson(value);
}

function scheduleJsonValidation(value: string) {
  if (validationTimer) clearTimeout(validationTimer);
  validationTimer = setTimeout(() => {
    validationTimer = undefined;
    validJson.value = isValidJson(value);
  }, jsonValidationDebounceMs);
}

function addSearchControlHints(view: EditorView) {
  const panel = view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
  if (!panel || panel.dataset.searchHints === "true") return;

  const hints: Array<[string, string]> = [
    ['input[name="search"]', "查找"],
    ['input[name="replace"]', "替换"],
    ['button[name="next"]', "下一个匹配项（Enter）"],
    ['button[name="prev"]', "上一个匹配项（Shift+Enter）"],
    ['button[name="select"]', "选择全部匹配项"],
    ['button[name="replace"]', "替换当前匹配项（Enter）"],
    ['button[name="replaceAll"]', "全部替换"],
    ['button[name="close"]', "关闭（Escape）"],
  ];

  for (const [selector, title] of hints) {
    panel.querySelector<HTMLElement>(selector)?.setAttribute("title", title);
  }

  [
    "区分大小写（Alt+C）",
    "正则表达式（Alt+R）",
    "全词匹配（Alt+W）",
  ].forEach((title, index) => {
    panel.querySelectorAll<HTMLElement>("label")[index]?.setAttribute("title", title);
  });

  panel.dataset.searchHints = "true";
}

function scheduleSearchControlHints(view: EditorView) {
  if (!view.dom.querySelector(".cm-panel.cm-search")) return;
  requestAnimationFrame(() => addSearchControlHints(view));
}

function openSearch() {
  if (!editorView.value) return;
  openSearchPanel(editorView.value);
  scheduleSearchControlHints(editorView.value);
}

function collapseAll() {
  if (!editorView.value) return;
  foldAll(editorView.value);
  editorView.value.focus();
}

function expandAll() {
  if (!editorView.value) return;
  unfoldAll(editorView.value);
  editorView.value.focus();
}

function formatJson() {
  const view = editorView.value;
  if (!view) return;

  const current = view.state.doc.toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch {
    validJson.value = false;
    view.focus();
    return;
  }
  validJson.value = true;
  const formatted = JSON.stringify(parsed, null, jsonIndentSize);
  if (formatted === current) {
    view.focus();
    return;
  }

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: formatted },
  });
  view.focus();
}

onMounted(() => {
  if (!editorHost.value) return;

  const view = new EditorView({
    state: EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        json(),
        indentUnit.of("    "),
        EditorState.tabSize.of(jsonIndentSize),
        EditorState.phrases.of({
          Find: "查找",
          Replace: "替换",
          next: "下一个",
          previous: "上一个",
          all: "全选",
          "match case": "区分大小写",
          regexp: "正则表达式",
          "by word": "全词匹配",
          replace: "替换",
          "replace all": "全部替换",
          close: "关闭",
        }),
        indentGuidePlugin,
        selectionTextPlugin,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "JSON 响应编辑器",
          autocapitalize: "off",
          autocomplete: "off",
          spellcheck: "false",
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "var(--surface-subtle)",
            color: "var(--ink)",
            fontSize: "12px",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono)",
            lineHeight: "1.55",
            scrollbarGutter: "stable",
          },
          ".cm-content": {
            minHeight: "100%",
            padding: "12px 0",
            fontFamily: "var(--font-mono)",
          },
          // Rule: 全局字体重置会作用到 CodeMirror 的标记 span，代码文本必须统一使用等宽字体。
          ".cm-line, .cm-line *": {
            fontFamily: "var(--font-mono)",
          },
          ".cm-line": {
            padding: "0 16px 0 8px",
            fontFamily: "var(--font-mono)",
          },
          ".cm-line.cm-json-indented-line": {
            backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(4ch - 1px), #d3deec calc(4ch - 1px), #d3deec 4ch)",
            backgroundPosition: "8px 0",
            backgroundRepeat: "no-repeat",
            backgroundSize: "var(--json-indent) 100%",
          },
          ".cm-gutters": {
            backgroundColor: "var(--surface-muted)",
            borderRight: "1px solid var(--line-soft)",
            color: "var(--ink-faint)",
          },
          ".cm-gutterElement": {
            padding: "0 10px 0 12px",
          },
          ".cm-activeLine": {
            backgroundColor: "#f1f5ff",
          },
          // Rule: 自绘选区和匹配高亮都必须保持明显的前景/背景对比。
          "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
            backgroundColor: "var(--accent) !important",
          },
          ".cm-json-selection, .cm-json-selection *": {
            backgroundColor: "var(--accent)",
            color: "#ffffff !important",
          },
          ".cm-selectionMatch, .cm-selectionMatch *": {
            backgroundColor: "#d7e3ff",
            color: "var(--ink-strong)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "var(--accent-soft)",
            color: "#5875af",
          },
          ".cm-foldPlaceholder": {
            backgroundColor: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            borderRadius: "4px",
            color: "var(--accent-strong)",
            margin: "0 3px",
            padding: "0 5px",
          },
          ".cm-searchMatch": {
            backgroundColor: "#d7e3ff",
          },
          ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "#9bb9f3",
            color: "var(--ink-strong)",
          },
          ".cm-panels": {
            backgroundColor: "var(--surface-muted)",
            borderTop: "1px solid var(--line)",
            color: "var(--ink)",
          },
          ".cm-panels input, .cm-panels button": {
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
          },
        }),
        Prec.high(keymap.of([
          {
            key: "Mod-s",
            run: () => {
              emit("save");
              return true;
            },
          },
          {
            key: "Mod-f",
            run: (target) => {
              openSearchPanel(target);
              scheduleSearchControlHints(target);
              return true;
            },
          },
        ])),
        EditorView.updateListener.of((update) => {
          scheduleSearchControlHints(update.view);
          if (update.docChanged) {
            const value = update.state.doc.toString();
            updateCursorStatus(update.view);
            scheduleJsonValidation(value);
            lastEmittedValue = value;
            emit("update:value", value);
            if (!syncingExternalValue.value) emit("user-change");
          } else if (update.selectionSet) {
            updateCursorStatus(update.view);
          }
        }),
      ],
    }),
    parent: editorHost.value,
  });

  editorView.value = view;
  updateDocumentStatus(view);
});

watch(() => props.value, (value) => {
  const view = editorView.value;
  if (!view || value === lastEmittedValue) return;
  if (value === view.state.doc.toString()) {
    lastEmittedValue = value;
    return;
  }

  syncingExternalValue.value = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  });
  syncingExternalValue.value = false;
}, { flush: "sync" });

onBeforeUnmount(() => {
  if (validationTimer) clearTimeout(validationTimer);
  editorView.value?.destroy();
  editorView.value = undefined;
});
</script>

<template>
  <div
    class="json-editor-shell"
    :class="{ 'has-error': props.error || !validJson }"
    :aria-invalid="validJson ? undefined : 'true'"
  >
    <div class="json-editor-toolbar">
      <div class="json-editor-tools">
        <span class="json-editor-language">JSON</span>
        <button type="button" class="editor-tool" title="在响应体中查找（Ctrl/Cmd + F）" @click="openSearch">
          搜索 <kbd>Ctrl F</kbd>
        </button>
        <button type="button" class="editor-tool" title="格式化当前 JSON" :disabled="!validJson" @click="formatJson">格式化</button>
        <button type="button" class="editor-tool" title="折叠所有对象和数组" @click="collapseAll">全部折叠</button>
        <button type="button" class="editor-tool" title="展开所有对象和数组" @click="expandAll">全部展开</button>
      </div>
      <div class="json-editor-status" aria-live="polite">
        <span :class="['json-validity', { invalid: !validJson }]">
          <i aria-hidden="true"></i>{{ validJson ? "JSON 有效" : "JSON 格式有误" }}
        </span>
        <span class="json-editor-position">行 {{ cursorLine }} / {{ lineCount }} · 列 {{ cursorColumn }}</span>
      </div>
    </div>
    <div ref="editorHost" class="json-editor-surface"></div>
  </div>
</template>

<style scoped>
.json-editor-shell {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 310px;
  height: auto;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--ink);
  display: flex;
  flex-direction: column;
}

.json-editor-shell.has-error {
  border-color: #e6a3a0;
}

.json-editor-toolbar {
  min-height: 34px;
  flex: 0 0 auto;
  padding: 4px 8px 4px 10px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--surface-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.json-editor-tools,
.json-editor-status {
  display: flex;
  align-items: center;
  gap: 5px;
}

.json-editor-tools {
  min-width: 0;
  flex-wrap: wrap;
}

.json-editor-language {
  margin-right: 3px;
  color: var(--ink-muted);
  font: 700 10px/1.2 var(--font-mono);
  letter-spacing: 0.08em;
}

.editor-tool {
  min-height: 23px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #64748b;
  padding: 2px 7px;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
}

.editor-tool:hover:not(:disabled) {
  border-color: #cbdaf3;
  background: #edf4ff;
  color: #246bfd;
}

.editor-tool:disabled {
  color: #b7c1cf;
  cursor: not-allowed;
}

.editor-tool kbd {
  margin-left: 3px;
  color: #94a3b8;
  font: 10px/1 "JetBrains Mono", Consolas, monospace;
}

.json-editor-status {
  flex: 0 0 auto;
  color: var(--ink-faint);
  font-size: 10px;
  white-space: nowrap;
}

.json-validity {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--success);
}

.json-validity.invalid {
  color: var(--danger);
}

.json-validity i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.json-editor-position {
  padding-left: 7px;
  border-left: 1px solid var(--line);
}

.json-editor-surface {
  flex: 1 1 auto;
  min-height: 0;
  overflow: visible;
}

:deep(.cm-editor) {
  height: 100%;
}

:deep(.cm-editor.cm-focused) {
  outline: 0;
}

:deep(.cm-focused .cm-cursor) {
  border-left-color: #246bfd;
}

/* Rule: 搜索面板保持浮层形态，避免打开 Ctrl+F 后把编辑区域整体向下推。 */
:deep(.cm-panels-bottom) {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  bottom: auto !important;
  left: auto !important;
  z-index: 20;
  width: min(500px, calc(100% - 20px));
  border: 0 !important;
  background: transparent !important;
  pointer-events: none;
}

:deep(.cm-panels-bottom .cm-panel) {
  pointer-events: auto;
  overflow: visible;
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  background: var(--surface);
  box-shadow: var(--shadow-float);
}

:deep(.cm-panel.cm-search) {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(7, 28px);
  grid-template-rows: 30px 30px;
  gap: 6px;
  padding: 8px 10px;
  background: var(--surface);
  color: var(--ink);
}

:deep(.cm-panel.cm-search > .cm-textfield) {
  box-sizing: border-box;
  width: 100%;
  min-height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface-subtle);
  color: var(--ink-strong);
  padding: 4px 8px;
  font: 12px/1.2 var(--font-sans);
  outline: 0;
}

:deep(.cm-panel.cm-search > .cm-textfield:focus) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

:deep(.cm-panel.cm-search > .cm-textfield[name="search"]) {
  grid-column: 1;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > .cm-textfield[name="replace"]) {
  grid-column: 1 / 5;
  grid-row: 2;
}

:deep(.cm-panel.cm-search > .cm-button) {
  box-sizing: border-box;
  width: 28px;
  min-height: 30px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  position: relative;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 0;
  line-height: 1;
  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
}

:deep(.cm-panel.cm-search > .cm-button:hover) {
  box-shadow: 0 1px 3px rgb(33 52 79 / 12%);
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

:deep(.cm-panel.cm-search > .cm-button:focus-visible),
:deep(.cm-panel.cm-search > label:focus-within) {
  outline: 2px solid var(--accent-line);
  outline-offset: 1px;
}

:deep(.cm-panel.cm-search > button[name="next"]) {
  grid-column: 2;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > button[name="next"]::before) {
  content: "↓";
  font-size: 19px;
}

:deep(.cm-panel.cm-search > button[name="prev"]) {
  grid-column: 3;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > button[name="prev"]::before) {
  content: "↑";
  font-size: 19px;
}

:deep(.cm-panel.cm-search > button[name="select"]) {
  grid-column: 4;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > button[name="select"]::before) {
  content: "☷";
  font-size: 18px;
}

:deep(.cm-panel.cm-search > label) {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-height: 30px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 0;
  line-height: 1;
  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
}

:deep(.cm-panel.cm-search > label:hover) {
  box-shadow: 0 1px 3px rgb(33 52 79 / 12%);
}

:deep(.cm-panel.cm-search > label input[type="checkbox"]) {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  opacity: 0;
}

:deep(.cm-panel.cm-search > label::before) {
  font-size: 12px;
  font-weight: 700;
}

:deep(.cm-panel.cm-search > label:nth-of-type(1)::before) {
  content: "Aa";
}

:deep(.cm-panel.cm-search > label:nth-of-type(2)::before) {
  content: ".*";
}

:deep(.cm-panel.cm-search > label:nth-of-type(3)::before) {
  content: "ab";
}

:deep(.cm-panel.cm-search > label:hover),
:deep(.cm-panel.cm-search > label:has(input:checked)) {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

:deep(.cm-panel.cm-search > label:nth-of-type(1)) {
  grid-column: 5;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > label:nth-of-type(2)) {
  grid-column: 6;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > label:nth-of-type(3)) {
  grid-column: 7;
  grid-row: 1;
}

:deep(.cm-panel.cm-search > button[name="replace"]) {
  grid-column: 5;
  grid-row: 2;
}

:deep(.cm-panel.cm-search > button[name="replace"]::before) {
  content: "↵";
  font-size: 18px;
}

:deep(.cm-panel.cm-search > button[name="replaceAll"]) {
  grid-column: 6;
  grid-row: 2;
}

:deep(.cm-panel.cm-search > button[name="replaceAll"]::before) {
  content: "⇄";
  font-size: 18px;
}

:deep(.cm-panel.cm-search > br) {
  display: none;
}

:deep(.cm-panel.cm-search > button[name="close"]) {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  min-height: 30px;
  font-size: 0 !important;
}

:deep(.cm-panel.cm-search > button[name="close"]::before) {
  content: "×";
  font-size: 24px;
  font-weight: 300;
}

:deep(.cm-panel.cm-search > .cm-button[title]::after),
:deep(.cm-panel.cm-search > label[title]::after) {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 40;
  max-width: 220px;
  padding: 6px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--ink-strong);
  box-shadow: var(--shadow-float);
  color: var(--surface);
  content: attr(title);
  font: 11px/1.3 var(--font-sans);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 4px);
  transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
  visibility: hidden;
  white-space: nowrap;
}

:deep(.cm-panel.cm-search > .cm-button[title]:hover::after),
:deep(.cm-panel.cm-search > .cm-button[title]:focus-visible::after),
:deep(.cm-panel.cm-search > label[title]:hover::after),
:deep(.cm-panel.cm-search > label[title]:focus-within::after) {
  opacity: 1;
  transform: translate(-50%, 0);
  visibility: visible;
}

@media (prefers-reduced-motion: reduce) {
  :deep(.cm-panel.cm-search > .cm-button),
  :deep(.cm-panel.cm-search > label),
  :deep(.cm-panel.cm-search > .cm-button[title]::after),
  :deep(.cm-panel.cm-search > label[title]::after) {
    transition: none;
  }
}

@media (max-width: 760px) {
  .json-editor-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .json-editor-status {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 560px) {
  .json-editor-shell {
    min-height: 360px;
    height: 360px;
  }

  .editor-tool kbd,
  .json-editor-position {
    display: none;
  }
}
</style>
