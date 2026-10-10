import { expect, type Locator } from '@playwright/test';

/** Viewport checks alone miss a control clipped by a scrollable modal body. */
export async function expectVisibleTouchTarget(target: Locator) {
    const geometry = await target.evaluate(element => {
        const rect = element.getBoundingClientRect();
        let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
        let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
            if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
                left = Math.max(left, bounds.left + parent.clientLeft); right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
            }
            if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
                top = Math.max(top, bounds.top + parent.clientTop); bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
            }
            if (style.position === 'fixed') {
                // The modal portal is fixed to the viewport and escapes the
                // body's negative-top scroll lock. Overflow ancestors above
                // it clip only when they establish its containing block.
                let contained = false;
                for (let ancestor = parent.parentElement; ancestor; ancestor = ancestor.parentElement) {
                    const outer = getComputedStyle(ancestor);
                    if ([outer.transform, outer.perspective, outer.filter, outer.backdropFilter].some(value => value && value !== 'none')
                        || /paint|layout|strict|content/.test(outer.contain) || /transform|perspective|filter/.test(outer.willChange)
                        || outer.contentVisibility === 'auto') { contained = true; break; }
                }
                if (!contained) break;
            }
        }
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return { width: rect.width, height: rect.height, visibleWidth: Math.max(0, right - left), visibleHeight: Math.max(0, bottom - top), hit: hit === element || element.contains(hit) };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.visibleWidth).toBeGreaterThanOrEqual(geometry.width - 1);
    expect(geometry.visibleHeight).toBeGreaterThanOrEqual(geometry.height - 1);
    expect(geometry.hit).toBe(true);
    return geometry;
}
