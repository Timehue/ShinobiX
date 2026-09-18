import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type ResourceSnapshot = {
    observers: number;
    observedElements: number;
    visibilityListeners: number;
    mediaListeners: number;
    intervals: number[];
    pendingFrames: number;
    frameCallbacks: number;
    webglContexts: number;
    webglContextsCreated: number;
};

declare global {
    interface Window {
        landingResourceSnapshot: () => ResourceSnapshot;
    }
}

test('landing lifecycle releases resources through repeated navigation and suspends hidden animation', async ({ page, browserName }, testInfo) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        const observed = new Map<IntersectionObserver, Set<Element>>();
        const NativeObserver = window.IntersectionObserver;
        window.IntersectionObserver = class extends NativeObserver {
            observe(target: Element) {
                if (target.closest('#landing-home')) {
                    if (!observed.has(this)) observed.set(this, new Set());
                    observed.get(this)!.add(target);
                }
                super.observe(target);
            }
            unobserve(target: Element) {
                observed.get(this)?.delete(target);
                if (observed.get(this)?.size === 0) observed.delete(this);
                super.unobserve(target);
            }
            disconnect() {
                observed.delete(this);
                super.disconnect();
            }
        };

        const listenerSets = new WeakMap<EventTarget, Map<string, Set<EventListenerOrEventListenerObject>>>();
        const counts = { visibilityListeners: 0, mediaListeners: 0 };
        const nativeAdd = EventTarget.prototype.addEventListener;
        const nativeRemove = EventTarget.prototype.removeEventListener;
        function listenerKind(target: EventTarget, type: string) {
            if (target === document && type === 'visibilitychange') return 'visibilityListeners';
            if (target instanceof MediaQueryList && type === 'change') return 'mediaListeners';
            return null;
        }
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            const kind = listenerKind(this, type);
            if (kind && listener) {
                const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
                const key = `${type}:${capture}`;
                if (!listenerSets.has(this)) listenerSets.set(this, new Map());
                const byType = listenerSets.get(this)!;
                if (!byType.has(key)) byType.set(key, new Set());
                if (!byType.get(key)!.has(listener)) {
                    byType.get(key)!.add(listener);
                    counts[kind]++;
                }
            }
            nativeAdd.call(this, type, listener, options);
        };
        EventTarget.prototype.removeEventListener = function(type, listener, options) {
            const kind = listenerKind(this, type);
            const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
            if (kind && listener && listenerSets.get(this)?.get(`${type}:${capture}`)?.delete(listener)) counts[kind]--;
            nativeRemove.call(this, type, listener, options);
        };

        const intervals = new Map<number, number>();
        const nativeInterval = window.setInterval.bind(window);
        const nativeClearInterval = window.clearInterval.bind(window);
        window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
            const id = nativeInterval(handler, timeout, ...args);
            intervals.set(id, timeout ?? 0);
            return id;
        }) as typeof window.setInterval;
        window.clearInterval = (id) => { if (typeof id === 'number') intervals.delete(id); nativeClearInterval(id); };

        const frames = new Set<number>();
        let frameCallbacks = 0;
        const nativeFrame = window.requestAnimationFrame.bind(window);
        const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => {
            const id = nativeFrame(time => { frames.delete(id); frameCallbacks++; callback(time); });
            frames.add(id);
            return id;
        };
        window.cancelAnimationFrame = id => { frames.delete(id); nativeCancelFrame(id); };
        const contexts = new Set<WeakRef<WebGLRenderingContext>>();
        const seenContexts = new WeakSet<WebGLRenderingContext>();
        let webglContextsCreated = 0;
        const nativeContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, ...args: Parameters<typeof nativeContext>) {
            const context = Reflect.apply(nativeContext, this, args);
            if (/^(webgl2?|experimental-webgl)$/.test(args[0]) && context) {
                const gl = context as WebGLRenderingContext;
                if (!seenContexts.has(gl)) {
                    seenContexts.add(gl);
                    contexts.add(new WeakRef(gl));
                    webglContextsCreated++;
                }
            }
            return context;
        } as typeof nativeContext;

        window.landingResourceSnapshot = () => ({
            observers: observed.size,
            observedElements: Array.from(observed.values()).reduce((total, elements) => total + elements.size, 0),
            ...counts,
            intervals: [...intervals.values()].sort((a, b) => a - b),
            pendingFrames: frames.size,
            frameCallbacks,
            webglContexts: [...contexts].filter(ref => { const context = ref.deref(); return context && !context.isContextLost(); }).length,
            webglContextsCreated,
        });
    });
    await page.route('**/api/**', route => route.fulfill({ json: {
        ok: true, images: {}, categories: {}, players: [], leaderboard: [], announcements: [],
        entries: [], eras: [], wars: [], territories: [], standings: [],
    } }));
    await page.goto('/', { waitUntil: 'networkidle' });
    const atmosphere = page.locator('.landing-atmosphere');
    const snapshot = () => page.evaluate(() => window.landingResourceSnapshot());
    await expect(atmosphere).toHaveAttribute('data-running', 'true');
    await expect.poll(async () => (await snapshot()).pendingFrames).toBe(0);

    // Exercise the actual visibility event handler; this simulates the browser
    // visibility signal, not physical GPU activity in an OS-backgrounded tab.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(atmosphere).toHaveAttribute('data-running', 'false');
    expect(await atmosphere.locator(':scope > *').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationPlayState === 'paused'))).toBe(true);
    await page.evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(atmosphere).toHaveAttribute('data-running', 'true');

    const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
    if (cdp) await cdp.send('Performance.enable');
    const performanceSamples: Record<string, unknown>[] = [];
    async function measureIdle(label: string) {
        const before = await snapshot();
        const first = cdp ? await cdp.send('Performance.getMetrics') : null;
        // A bounded measurement window, not a synchronization delay.
        await page.waitForTimeout(2000);
        const last = cdp ? await cdp.send('Performance.getMetrics') : null;
        const after = await snapshot();
        expect(after.pendingFrames).toBe(0);
        expect(after.frameCallbacks).toBe(before.frameCallbacks);
        expect(after.webglContexts).toBe(0);
        expect(after.intervals).not.toContain(1000);
        expect(after.intervals).not.toContain(20000);
        const metrics = (result: typeof first) => Object.fromEntries((result?.metrics ?? []).map(metric => [metric.name, metric.value]));
        const start = metrics(first), end = metrics(last);
        performanceSamples.push({ label, resources: after, ...(cdp ? {
            elapsedSeconds: end.Timestamp - start.Timestamp,
            mainThreadTaskSeconds: end.TaskDuration - start.TaskDuration,
            layouts: end.LayoutCount - start.LayoutCount,
        } : {}) });
    }
    await measureIdle('visible hero');
    await page.locator('.landing-footer').scrollIntoViewIfNeeded();
    await expect(atmosphere).toHaveAttribute('data-running', 'false');
    await measureIdle('hero offscreen');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Shinobi Journey home' }).click();
    expect(await page.locator('#landing-home').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    let landingBaseline: ResourceSnapshot | undefined;
    let loginBaseline: ResourceSnapshot | undefined;
    const memorySamples: Record<string, number>[] = [];
    for (let cycle = 0; cycle < 15; cycle++) {
        const label = cycle % 2 === 0 ? 'Card Battles' : 'Story';
        await page.getByRole('tab', { name: label, exact: true }).click();
        await page.getByRole('button', { name: `Enlarge ${label} screenshot`, exact: true }).click();
        await expect(page.locator('.landing-lightbox')).toBeVisible();
        await page.getByRole('button', { name: 'Close screenshot', exact: true }).click();
        await expect(page.locator('.landing-lightbox img')).toHaveCount(0);
        await expect(page.locator('html')).not.toHaveCSS('overflow-y', 'hidden');
        await page.getByRole('button', { name: 'Account', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Enter the Village', exact: true })).toBeVisible();
        await expect(atmosphere).toHaveCount(0);
        await expect.poll(async () => (await snapshot()).observers).toBe(0);
        const login = await snapshot();
        if (cycle === 2) loginBaseline = login;
        if (cycle > 2) {
            expect(login.visibilityListeners).toBe(loginBaseline!.visibilityListeners);
            expect(login.mediaListeners).toBe(loginBaseline!.mediaListeners);
            expect(login.intervals).toEqual(loginBaseline!.intervals);
        }
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(atmosphere).toHaveAttribute('data-running', 'true');
        const landing = await snapshot();
        if (cycle === 2) landingBaseline = landing;
        if (cycle > 2) {
            expect(landing.visibilityListeners).toBe(landingBaseline!.visibilityListeners);
            expect(landing.mediaListeners).toBe(landingBaseline!.mediaListeners);
            expect(landing.observers).toBe(landingBaseline!.observers);
            expect(landing.observedElements).toBe(landingBaseline!.observedElements);
            expect(landing.intervals).toEqual(landingBaseline!.intervals);
        }
        if (cdp && [2, 6, 10, 14].includes(cycle)) {
            await cdp.send('HeapProfiler.collectGarbage');
            const heap = await cdp.send('Runtime.getHeapUsage');
            const counters = await cdp.send('Memory.getDOMCounters');
            memorySamples.push({ cycle: cycle + 1, usedHeapBytes: heap.usedSize, ...counters });
        }
    }
    expect((await snapshot()).webglContexts).toBe(0);
    expect((await snapshot()).webglContextsCreated).toBeLessThanOrEqual(1);
    await expect(page.locator('canvas, video, audio')).toHaveCount(0);
    if (memorySamples.length) {
        const first = memorySamples[0], last = memorySamples.at(-1)!;
        expect(last.usedHeapBytes - first.usedHeapBytes).toBeLessThan(2 * 1024 * 1024);
        expect(last.nodes - first.nodes).toBeLessThan(100);
        expect(last.jsEventListeners - first.jsEventListeners).toBeLessThan(10);
    }
    const reportPath = testInfo.outputPath('landing-resource-audit.json');
    await writeFile(reportPath, JSON.stringify({ browserName, performanceSamples, memorySamples, landingBaseline, loginBaseline }, null, 2));
    await testInfo.attach('landing-resource-audit.json', { path: reportPath, contentType: 'application/json' });
    await cdp?.detach();
});
