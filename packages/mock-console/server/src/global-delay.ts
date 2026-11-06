import type { GlobalDelay } from "../../shared/types.js";

// Rule: 固定与随机延迟都覆盖场景延迟；随机值在每次请求判定时只取一次。
export function effectiveDelayMs(
  globalDelay: GlobalDelay | undefined,
  scenarioDelayMs: number,
  random: () => number = Math.random,
) {
  if (!globalDelay || globalDelay.mode === "off") return scenarioDelayMs;
  if (globalDelay.mode === "fixed") return globalDelay.fixedMs;
  const span = globalDelay.maxMs - globalDelay.minMs + 1;
  return globalDelay.minMs + Math.floor(random() * span);
}
