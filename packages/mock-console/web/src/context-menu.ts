import type { Api, Scene } from "./mock-admin-client";

export type ContextTarget =
  | { type: "api"; item: Api }
  | { type: "api-area" }
  | { type: "scene"; item: Scene }
  | { type: "scene-area" };

export type ContextMenuItem = {
  label: string;
  action: () => void | Promise<unknown>;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
};

export type ContextMenuState = {
  x: number;
  y: number;
  title: string;
  items: ContextMenuItem[];
};

export type OpenContextMenu = (event: MouseEvent, target: ContextTarget) => void;
