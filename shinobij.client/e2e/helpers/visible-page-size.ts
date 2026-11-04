import type { Page } from '@playwright/test';
import { visibleViewport } from './visible-viewport';

/**
 * The visible page size in CSS pixels, for "fits the screen" checks.
 *
 * `page.viewportSize()` is the DEVICE size. Phones draw menus at 85%
 * (src/lib/mobile-ui-scale.ts), so a 390px phone lays out ~458 CSS px and
 * element bounds are measured in those pixels. Rounded up, because the visible
 * width is fractional (457.7) while a full-width element ends at 458.
 */
export async function visiblePageSize(page: Page): Promise<{ width: number; height: number }> {
    const viewport = await visibleViewport(page);
    return { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
}
