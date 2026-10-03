export type DrainResult = { outcome: 'drained' | 'drain-timeout'; elapsedMs: number; stage: string };
export type DrainDependencies = {
    stopAdmission: () => void;
    drainHttp: () => Promise<unknown>;
    closeRealtime: () => Promise<unknown>;
    savePresence: () => Promise<unknown>;
    drainBackground: () => Promise<unknown>;
    flushMetrics: () => Promise<unknown>;
    closeStorage: () => Promise<unknown>;
    forceCloseHttp: () => void;
    reportError: (stage: string, error: unknown) => void;
};

/** One bounded drain; storage stays available until admitted work and final writes finish. */
export function drainRuntime(deps: DrainDependencies, timeoutMs: number): Promise<DrainResult> {
    const started = performance.now();
    let stage = 'requests-and-jobs';
    try { deps.stopAdmission(); } catch (error) { try { deps.reportError('stop-admission', error); } catch { /* logging cannot block drain */ } }
    return new Promise(resolve => {
        let finished = false;
        const finish = (outcome: DrainResult['outcome']) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ outcome, elapsedMs: Math.round(performance.now() - started), stage });
        };
        const timer = setTimeout(() => {
            try { deps.forceCloseHttp(); } catch (error) {
                try { deps.reportError('force-close', error); } catch { /* logging cannot block exit */ }
            } finally { finish('drain-timeout'); }
        }, timeoutMs);
        timer.unref?.();
        const safely = async (name: string, fn: () => Promise<unknown>) => {
            try { await fn(); } catch (error) { try { deps.reportError(name, error); } catch { /* logging cannot block drain */ } }
        };
        void (async () => {
            // Start HTTP closure before asynchronous side work. Save presence
            // before realtime disconnects alter the roster.
            const http = safely('http', deps.drainHttp);
            const presence = safely('presence', deps.savePresence);
            const realtime = safely('realtime', deps.closeRealtime);
            await Promise.all([http, presence, realtime, safely('background', deps.drainBackground)]);
            if (finished) return;
            stage = 'telemetry';
            await safely(stage, deps.flushMetrics);
            if (finished) return;
            stage = 'storage';
            await safely(stage, deps.closeStorage);
            finish('drained');
        })();
    });
}
