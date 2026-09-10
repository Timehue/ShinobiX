/* eslint-disable @typescript-eslint/no-explicit-any -- dev-only instrumentation of overloaded native browser methods. */
/** Imported only by showdownpreview. Counts live WebGL handles and scheduled
 * callbacks without retaining their objects. Context loss releases all driver
 * allocations; cached source images/GLTFs are a separate, intentional cache. */
export function installShowdownLifecycleProbe() {
    const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    const nativeInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
    const nativeRaf = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
    const timers = new Set<number>(), frames = new Set<number>(), intervals = new Set<number>();
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: any[]) => {
        if (typeof callback !== 'function') return nativeTimeout(callback, delay, ...args);
        const id = nativeTimeout(() => {
            timers.delete(id);
            if (typeof callback === 'function') callback(...args);
        }, delay);
        timers.add(id); return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = (id?: number) => { if (id !== undefined) timers.delete(id); nativeClear(id); };
    window.setInterval = ((callback: TimerHandler, delay?: number, ...args: any[]) => {
        const id = nativeInterval(callback, delay, ...args); intervals.add(id); return id;
    }) as typeof window.setInterval;
    window.clearInterval = (id?: number) => { if (id !== undefined) intervals.delete(id); nativeClearInterval(id); };
    window.requestAnimationFrame = callback => {
        const id = nativeRaf(time => { frames.delete(id); callback(time); });
        frames.add(id); return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id); nativeCancel(id); };

    const counts = () => ({ buffer: 0, texture: 0, program: 0, shader: 0, framebuffer: 0, renderbuffer: 0, vertexArray: 0 });
    type Counts = ReturnType<typeof counts>;
    const active = new Set<Counts>(), seen = new WeakSet<object>();
    let createdContexts = 0, lostContexts = 0, draws = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
        const gl = (getContext as any).apply(this, args);
        if (!gl || !String(args[0]).includes('webgl') || seen.has(gl)) return gl;
        seen.add(gl); createdContexts++;
        const live = counts(); active.add(live);
        this.addEventListener('webglcontextlost', () => { active.delete(live); lostContexts++; }, { once: true });
        for (const name of Object.keys(live) as (keyof Counts)[]) {
            const suffix = name[0].toUpperCase() + name.slice(1), handles = new WeakSet<object>();
            if (typeof gl[`create${suffix}`] !== 'function') continue;
            const create = gl[`create${suffix}`].bind(gl), remove = gl[`delete${suffix}`].bind(gl);
            gl[`create${suffix}`] = (...parameters: any[]) => {
                const handle = create(...parameters);
                if (handle) { handles.add(handle); live[name]++; }
                return handle;
            };
            gl[`delete${suffix}`] = (handle: object | null) => {
                if (handle && handles.delete(handle)) live[name]--;
                return remove(handle);
            };
        }
        for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
            if (typeof gl[name] !== 'function') continue;
            const draw = gl[name].bind(gl);
            gl[name] = (...parameters: any[]) => { draws++; return draw(...parameters); };
        }
        return gl;
    } as typeof getContext;
    return {
        // The probe's own poll is excluded from measured application work.
        poll(callback: () => void) { return nativeInterval(callback, 1000); },
        snapshot() {
            const handles = counts();
            for (const context of active) for (const key of Object.keys(handles) as (keyof Counts)[]) handles[key] += context[key];
            const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
            return { createdContexts, lostContexts, activeContexts: active.size, handles, pendingTimers: timers.size,
                pendingFrames: frames.size, intervals: intervals.size, draws, heapBytes: memory?.usedJSHeapSize ?? null };
        },
    };
}
