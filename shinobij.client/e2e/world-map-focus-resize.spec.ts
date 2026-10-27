import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime } from './helpers/ui-audit-runtime';

test('keyboard focus stays tappable while an atlas resize is waiting for its camera commit', async ({ page, isMobile }, info) => {
    test.skip(!isMobile, 'Exercises the mobile transform camera');
    await page.addInitScript(() => {
        const observers: Array<{ observer: ResizeObserver; callback: ResizeObserverCallback; targets: Set<Element> }> = [];
        const NativeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeObserver {
            private readonly record: (typeof observers)[number];
            constructor(callback: ResizeObserverCallback) {
                super(callback);
                this.record = { observer: this, callback, targets: new Set() };
                observers.push(this.record);
            }
            observe(target: Element, options?: ResizeObserverOptions) {
                this.record.targets.add(target);
                super.observe(target, options);
            }
            unobserve(target: Element) { this.record.targets.delete(target); super.unobserve(target); }
            disconnect() { this.record.targets.clear(); super.disconnect(); }
        };
        Object.defineProperty(window, '__atlasResizeObservers', { value: observers });
    });
    const runtime = await installUiAuditRuntime(page);
    await expectUiAuditBoot(page, runtime, 'worldMap');
    const destination = page.getByRole('button', { name: /Travel to.*\(Sector 39\)/ });
    const viewport = page.getByRole('group', { name: 'World map', exact: true });
    await viewport.evaluate(el => (el as HTMLElement).style.setProperty('height', '340px', 'important'));
    // Let the initial size reach the camera before ordering the racing events.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const result = await destination.evaluate(target => {
        const viewport = target.closest<HTMLElement>('.world-map-scroll')!;
        const observers = (window as unknown as { __atlasResizeObservers: Array<{
            observer: ResizeObserver; callback: ResizeObserverCallback; targets: Set<Element>;
        }> }).__atlasResizeObservers.filter(record => record.targets.has(viewport));
        if (observers.length !== 1) throw new Error(`Expected one camera observer, found ${observers.length}`);
        const nativeRequest = window.requestAnimationFrame;
        const nativeCancel = window.cancelAnimationFrame;
        const frames = new Map<number, FrameRequestCallback>();
        let nextId = 1_000_000_000;
        window.requestAnimationFrame = callback => { const id = nextId++; frames.set(id, callback); return id; };
        window.cancelAnimationFrame = id => { if (!frames.delete(id)) nativeCancel.call(window, id); };
        try {
            viewport.style.setProperty('height', '124px', 'important');
            observers[0].callback([], observers[0].observer);
            (target as HTMLElement).focus({ preventScroll: true });
            // Deliver the pending resize AFTER keyboard focus, exactly the
            // ordering that previously moved a revealed marker off-camera.
            for (let turn = 0; frames.size && turn < 16; turn++) {
                const callbacks = [...frames.values()]; frames.clear();
                callbacks.forEach(callback => callback(performance.now()));
            }
            if (frames.size) throw new Error('Camera frames did not settle');
            const box = target.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return { receivesPointer: hit === target || !!hit && target.contains(hit), target: box.toJSON(), viewport: viewport.getBoundingClientRect().toJSON() };
        } finally {
            window.requestAnimationFrame = nativeRequest;
            window.cancelAnimationFrame = nativeCancel;
        }
    });
    await page.screenshot({ path: info.outputPath('focused-after-resize.png') });
    expect(result.receivesPointer, JSON.stringify(result)).toBe(true);
    // Exercise the phone's real touch action as well as hit testing.
    await destination.tap();
    await expect(page.locator('.sector-hud-region')).toContainText('Sector 39 ·');
});
