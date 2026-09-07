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

function openSearch() {
  if (!editorView.value) return;
  openSearchPanel(editorView.value);
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
        indentGuidePlugin,
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
              return true;
            },
          },
        ])),
        EditorView.updateListener.of((update) => {
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
  overflow: hidden;
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

:deep(.cm-search) {
  padding: 6px 8px;
}

:deep(.cm-search input) {
  min-height: 26px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--ink);
  padding: 3px 6px;
}

:deep(.cm-search button) {
  min-height: 26px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--ink);
  padding: 3px 7px;
  cursor: pointer;
}

:deep(.cm-search button:hover) {
  border-color: var(--accent-line);
  color: var(--accent);
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
