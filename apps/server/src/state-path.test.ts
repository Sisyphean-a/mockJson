import test from "node:test";
import assert from "node:assert/strict";
import { resolveStateFile } from "./state-path.js";

test("显式配置优先于默认用户数据目录", () => {
  assert.equal(
    resolveStateFile({ MOCK_STATE_FILE: "E:\\mock-state.json" }, "win32", "C:\\Users\\test"),
    "E:\\mock-state.json",
  );
});

test("Windows 默认使用 LOCALAPPDATA 下的运行态文件", () => {
  assert.equal(
    resolveStateFile({ LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "win32", "C:\\Users\\test"),
    "C:\\Users\\test\\AppData\\Local\\mock-console\\state.json",
  );
});

test("非 Windows 使用 XDG 数据目录", () => {
  assert.equal(
    resolveStateFile({ XDG_DATA_HOME: "/tmp/user-data" }, "linux", "/home/test"),
    "/tmp/user-data/mock-console/state.json",
  );
});
