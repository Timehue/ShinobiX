/**
 * ShinobiX shared UI primitives.
 *
 * Canonical, token-based building blocks that replace the per-screen sprawl of
 * bespoke buttons / modals / tabs / close & back buttons / empty & loading
 * states. Styles live in styles/ui.css (imported by index.css). Prefer these
 * over rolling new one-off classes.
 */
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { CloseButton } from "./CloseButton";
export type { CloseButtonProps } from "./CloseButton";
export { BackButton } from "./BackButton";
export type { BackButtonProps } from "./BackButton";
export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";
export { Tabs } from "./Tabs";
export type { TabItem, TabsProps } from "./Tabs";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { LoadingState } from "./LoadingState";
export type { LoadingStateProps } from "./LoadingState";
export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";
export { Pill } from "./Pill";
export type { PillProps, PillTone } from "./Pill";
