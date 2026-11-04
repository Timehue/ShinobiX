import type { Page } from '@playwright/test';

/** DOM bounds and elementFromPoint use layout CSS pixels, including at page scale 0.85. */
export function visibleViewport(page: Page) {
    return page.evaluate(() => ({
        left: window.visualViewport?.offsetLeft ?? 0,
        top: window.visualViewport?.offsetTop ?? 0,
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
        layoutWidth: document.documentElement.clientWidth,
    }));
}
