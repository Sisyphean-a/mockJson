export const DEFAULT_DETAIL_RATIO = 0.42;
const MIN_DETAIL_HEIGHT = 180;
const MIN_LIST_HEIGHT = 120;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

// Rule: 详情占比始终给列表和详情保留可用空间，小窗口下优先保证详情最小高度。
export function clampDetailRatio(ratio: number, workspaceHeight: number, splitterHeight = 7) {
  if (!Number.isFinite(ratio)) return DEFAULT_DETAIL_RATIO;
  if (!Number.isFinite(workspaceHeight) || workspaceHeight <= 0) return DEFAULT_DETAIL_RATIO;
  const min = Math.min(MAX_RATIO, Math.max(MIN_RATIO, MIN_DETAIL_HEIGHT / workspaceHeight));
  const max = Math.max(min, Math.min(MAX_RATIO, (workspaceHeight - splitterHeight - MIN_LIST_HEIGHT) / workspaceHeight));
  return Math.min(max, Math.max(min, ratio));
}

export function detailRatioFromPointer(clientY: number, workspaceTop: number, workspaceHeight: number, splitterHeight = 7) {
  if (!Number.isFinite(workspaceHeight) || workspaceHeight <= 0) return DEFAULT_DETAIL_RATIO;
  const detailHeight = workspaceTop + workspaceHeight - clientY - splitterHeight / 2;
  return clampDetailRatio(detailHeight / workspaceHeight, workspaceHeight, splitterHeight);
}
