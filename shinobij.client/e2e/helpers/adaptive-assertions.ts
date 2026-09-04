import { expect, type Locator, type Page } from "@playwright/test";

type OverflowAllowlist = {
    /** Small renderer-rounding allowance; normal DOM tests should keep 1px. */
    documentOverflowAllowance?: number;
    /** Actionable descendants of intentional horizontal scrollers. */
    horizontalScrollers?: string[];
    /** Fixed/sticky surfaces that intentionally extend beyond one viewport edge. */
    overlays?: string[];
    /** Paint-contained fixed-coordinate stages whose panned/scaled descendants may leave the camera frustum. */
    logicalStages?: string[];
};

export type ViewportSafetySnapshot = {
    viewport: { width: number; height: number };
    document: { clientWidth: number; scrollWidth: number };
    actionablesOutsideInlineViewport: string[];
    layoutOverflowContributors: string[];
    oversizedDialogs: string[];
    fixedOrStickyOutsideViewport: string[];
    closedOverlaysInterceptingInput: string[];
};

/**
 * Collects the responsive invariants shared by route-level visual tests.
 * Intentional horizontal surfaces must be explicitly allowlisted by their
 * scrolling container; hidden/offscreen application chrome is never ignored.
 */
export async function viewportSafetySnapshot(
    page: Page,
    allowlist: OverflowAllowlist = {},
): Promise<ViewportSafetySnapshot> {
    return page.evaluate((allowed) => {
        const width = document.documentElement.clientWidth;
        const height = window.visualViewport?.height ?? window.innerHeight;
        const horizontalScrollers = allowed.horizontalScrollers ?? [];
        const allowedOverlays = allowed.overlays ?? [];
        const logicalStages = allowed.logicalStages ?? [];
        const describe = (element: Element) => {
            const html = element as HTMLElement;
            const id = html.id ? `#${html.id}` : "";
            const classes = [...html.classList].slice(0, 3).map((name) => `.${name}`).join("");
            const label = html.getAttribute("aria-label") || html.textContent?.trim().replace(/\s+/g, " ").slice(0, 48);
            return `${html.tagName.toLowerCase()}${id}${classes}${label ? ` (${label})` : ""}`;
        };
        const visible = (element: Element) => {
            if (element.closest("[inert], [aria-hidden='true']")) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none"
                && style.visibility !== "hidden"
                && Number(style.opacity) > 0
                && rect.width > 0
                && rect.height > 0;
        };
        const isInsideAllowedScroller = (element: Element) => horizontalScrollers.some((selector) => {
            const scroller = element.closest(selector);
            if (!scroller) return false;
            const style = getComputedStyle(scroller);
            return ["auto", "scroll"].includes(style.overflowX) && scroller.scrollWidth > scroller.clientWidth;
        });
        const isInsideLogicalStage = (element: Element) => logicalStages.some((selector) => element.closest(selector));

        const actionableSelector = [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[role='button']",
            "[tabindex]:not([tabindex='-1'])",
        ].join(",");
        const actionablesOutsideInlineViewport = [...document.querySelectorAll(actionableSelector)]
            .filter(visible)
            .filter((element) => !isInsideAllowedScroller(element))
            .filter((element) => !isInsideLogicalStage(element))
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.right < -1 || rect.left > width + 1 || rect.left < -1 || rect.right > width + 1;
            })
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return `${describe(element)} [${rect.left.toFixed(1)},${rect.top.toFixed(1)} → ${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}]`;
            });

        const layoutOverflowContributors = [...document.querySelectorAll("body *")]
            .filter(visible)
            .filter((element) => !isInsideAllowedScroller(element))
            .filter((element) => !isInsideLogicalStage(element))
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.right > width + 1;
            })
            .slice(0, 20)
            .map(describe);

        const oversizedDialogs = [...document.querySelectorAll("[role='dialog'], [role='alertdialog']")]
            .filter(visible)
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1;
            })
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return `${describe(element)} [${rect.left.toFixed(1)},${rect.top.toFixed(1)} → ${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}]`;
            });

        const fixedOrStickyOutsideViewport = [...document.querySelectorAll("body *")]
            .filter(visible)
            .filter((element) => {
                const position = getComputedStyle(element).position;
                return position === "fixed" || position === "sticky";
            })
            .filter((element) => !allowedOverlays.some((selector) => element.matches(selector) || element.closest(selector)))
            .filter((element) => {
                const position = getComputedStyle(element).position;
                const rect = element.getBoundingClientRect();
                const outsideInlineViewport = rect.left < -1 || rect.right > width + 1;
                if (position === "fixed") {
                    return outsideInlineViewport || rect.top < -1 || rect.bottom > height + 1;
                }
                // Sticky elements remain in normal document flow until their
                // threshold is crossed. A tab rail below the fold is therefore
                // expected and scrollable, not escaped fixed chrome. Its inline
                // geometry and an impossible viewport-tall rail still fail.
                return outsideInlineViewport || rect.height > height + 1;
            })
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return `${describe(element)} [${rect.left.toFixed(1)},${rect.top.toFixed(1)} â†’ ${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}]`;
            });

        const closedOverlaysInterceptingInput = [...document.querySelectorAll([
            "[data-state='closed']",
            ".closed",
            "[hidden]",
            "[aria-hidden='true'][aria-modal='true']",
            "[aria-hidden='true'][role='dialog']",
            "[aria-hidden='true'][role='alertdialog']",
            "[aria-hidden='true'][role='menu']",
            "[aria-hidden='true'][role='listbox']",
            "[aria-hidden='true'][role='tooltip']",
            "[aria-hidden='true'].modal",
            "[aria-hidden='true'].dialog",
            "[aria-hidden='true'].drawer",
            "[aria-hidden='true'].sheet",
            "[aria-hidden='true'].overlay",
            "[aria-hidden='true'].backdrop",
            "[aria-hidden='true'].popover",
        ].join(","))]
            .filter((element) => !element.matches("[inert]") && !element.closest("[inert]"))
            .filter((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return ["absolute", "fixed", "sticky"].includes(style.position)
                    && style.pointerEvents !== "none"
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && Number(style.opacity) > 0
                    && rect.width > 0
                    && rect.height > 0;
            })
            .map(describe);

        return {
            viewport: { width, height },
            document: {
                clientWidth: width,
                scrollWidth: document.documentElement.scrollWidth,
            },
            actionablesOutsideInlineViewport,
            layoutOverflowContributors,
            oversizedDialogs,
            fixedOrStickyOutsideViewport,
            closedOverlaysInterceptingInput,
        };
    }, allowlist);
}

export async function expectViewportSafe(
    page: Page,
    allowlist: OverflowAllowlist = {},
): Promise<void> {
    const snapshot = await viewportSafetySnapshot(page, allowlist);
    const documentOverflow = snapshot.document.scrollWidth - snapshot.document.clientWidth;
    expect(
        snapshot.document.scrollWidth,
        `document overflowed by ${documentOverflow}px; contributors outside explicit paint-contained stages: ${snapshot.layoutOverflowContributors.join(", ")}`,
    ).toBeLessThanOrEqual(snapshot.document.clientWidth + (allowlist.documentOverflowAllowance ?? 1));
    expect(snapshot.actionablesOutsideInlineViewport, "actionable elements escaped the inline viewport").toEqual([]);
    expect(snapshot.oversizedDialogs, "dialogs escaped the visible viewport").toEqual([]);
    expect(snapshot.fixedOrStickyOutsideViewport, "fixed/sticky UI escaped the visible viewport").toEqual([]);
    expect(snapshot.closedOverlaysInterceptingInput, "closed overlays can still intercept pointer input").toEqual([]);
}

export async function expectNoLargeOverlap(
    first: Locator,
    second: Locator,
    maximumArea = 1,
): Promise<void> {
    const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    expect(a, "first overlap target was not measurable").not.toBeNull();
    expect(b, "second overlap target was not measurable").not.toBeNull();
    if (!a || !b) return;
    const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(overlapWidth * overlapHeight, "primary controls overlapped").toBeLessThanOrEqual(maximumArea);
}

/** Verifies the end of a document-scrolling mobile screen can clear fixed nav. */
export async function expectFinalActionableClearsFixedNavigation(
    page: Page,
    content: Locator,
    navigation: Locator,
): Promise<void> {
    const finalActionable = content.locator([
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[role='button']",
    ].join(",")).filter({ visible: true }).last();
    await finalActionable.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    const [control, nav] = await Promise.all([finalActionable.boundingBox(), navigation.boundingBox()]);
    expect(control, "the final actionable was not measurable").not.toBeNull();
    expect(nav, "fixed navigation was not measurable").not.toBeNull();
    if (!control || !nav) return;
    expect(control.y + control.height, "the final actionable remained underneath fixed navigation")
        .toBeLessThanOrEqual(nav.y + 1);
}
