import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

type StatePathEnv = Partial<Pick<NodeJS.ProcessEnv, "MOCK_STATE_FILE" | "LOCALAPPDATA" | "XDG_DATA_HOME">>;

export function resolveStateFile(
  env: StatePathEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
) {
  const override = env.MOCK_STATE_FILE?.trim();
  if (override) return override;

  const pathApi = platform === "win32" ? win32 : posix;
  const base = platform === "win32"
    ? env.LOCALAPPDATA?.trim() || pathApi.join(home, "AppData", "Local")
    : platform === "darwin"
      ? pathApi.join(home, "Library", "Application Support")
      : env.XDG_DATA_HOME?.trim() || pathApi.join(home, ".local", "share");
  return pathApi.join(base, "mock-console", "state.json");
}
