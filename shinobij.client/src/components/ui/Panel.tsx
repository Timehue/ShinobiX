import { createElement, type ElementType, type HTMLAttributes, type ReactNode } from "react";

export type PanelSurface = "base" | "steel" | "scroll" | "spirit" | "prestige";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  surface?: PanelSurface;
  interactive?: boolean;
  children: ReactNode;
}

/** Material-aware surface used by new and migrated game screens. */
export function Panel({
  as: Component = "section",
  surface = "base",
  interactive = false,
  className = "",
  children,
  ...rest
}: PanelProps) {
  return createElement(Component, {
    ...rest,
    className: `ui-panel ui-panel--${surface}${interactive ? " ui-panel--interactive" : ""} ${className}`.trim(),
  }, children);
}
