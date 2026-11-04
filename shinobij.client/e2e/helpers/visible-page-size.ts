import type { Page } from '@playwright/test';

/**
 * The on-screen area in CSS pixels, the same coordinates `boundingBox()` and
 * `getBoundingClientRect()` report.
 *
 * Don't use `page.viewportSize()` for an "is it on screen" check: it is the
 * DEVICE size. Portrait Android phones draw menus at 85% scale
 * (src/lib/mobile-ui-scale.ts), so there the page is laid out 1/0.85 wider
 * and taller than the device: a 360px phone shows about 424 CSS px across,
 * and a box ending at x = 380 is fully on screen. Wherever the scale is 1
 * (desktop, WebKit, landscape, combat, card game, world map) the two sizes
 * are equal, so this is the right ruler everywhere.
 *
 * Read from the visual viewport, so a page left zoomed in (Chrome restoring a
 * zoom after reload) still counts what it pushed off screen. Rounded up: at
 * 0.85 a 360px device shows 423.53 CSS px over a 424px layout.
 */
export async function visiblePageSize(page: Page): Promise<{ width: number; height: number }> {
    return page.evaluate(() => {
        const viewport = window.visualViewport;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        return { width: Math.ceil(width), height: Math.ceil(height) };
    });
}
