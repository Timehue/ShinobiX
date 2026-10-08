import { expect, type Locator } from '@playwright/test';

/** Measure painted text, including caption glyphs overflowing a narrow grid cell. */
export async function expectMapNoticeTextSeparated(banner: Locator, label: string) {
    const geometry = await banner.evaluate(element => {
        const action = element.querySelector<HTMLElement>('.pet-mentor-road-action')!;
        const study = action.querySelector<HTMLElement>('b')!;
        const toggle = element.querySelector<HTMLElement>('.map-notification-toggle')!;
        const rect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
        const painted = (node: HTMLElement) => {
            if (!node.getClientRects().length) return [];
            const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(node);
            return [...range.getClientRects()].map(r => {
                const x = /hidden|clip/.test(style.overflowX) ? Math.max(r.x, bounds.x) : r.x;
                const y = /hidden|clip/.test(style.overflowY) ? Math.max(r.y, bounds.y) : r.y;
                const right = /hidden|clip/.test(style.overflowX) ? Math.min(r.right, bounds.right) : r.right;
                const bottom = /hidden|clip/.test(style.overflowY) ? Math.min(r.bottom, bounds.bottom) : r.bottom;
                return { x, y, width: right - x, height: bottom - y };
            }).filter(r => r.width > 0 && r.height > 0);
        };
        return { action: rect(action.getBoundingClientRect()), toggle: rect(toggle.getBoundingClientRect()),
            study: painted(study), lesson: [...action.querySelectorAll<HTMLElement>('small,strong,em')].flatMap(painted) };
    });
    const overlap = (a: typeof geometry.action, b: typeof geometry.action) =>
        Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x)
        && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    expect(geometry.study.length, `${label}: Study must render`).toBeGreaterThan(0);
    expect(geometry.lesson.length, `${label}: lesson text must render`).toBeGreaterThan(0);
    expect(overlap(geometry.action, geometry.toggle), `${label}: action and toggle targets overlap`).toBe(false);
    for (const text of geometry.study) {
        expect(text.x, `${label}: Study left edge`).toBeGreaterThanOrEqual(geometry.action.x);
        expect(text.x + text.width, `${label}: Study right edge`).toBeLessThanOrEqual(geometry.action.x + geometry.action.width);
        expect(text.y + text.height, `${label}: Study bottom edge`).toBeLessThanOrEqual(geometry.action.y + geometry.action.height);
        for (const lesson of geometry.lesson) expect(overlap(text, lesson), `${label}: Study overlaps lesson glyphs`).toBe(false);
    }
}
