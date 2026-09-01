import type { KeyboardEvent } from "react";

/**
 * WAI-ARIA horizontal tab behavior shared by the game's tab strips.
 * Moving focus also activates the tab, matching the immediate-switch behavior
 * players already get with pointer input.
 */
export function handleHorizontalTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    const tabList = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
    const tabs = Array.from(
        tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabs.length === 0) return;

    event.preventDefault();
    const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
}
