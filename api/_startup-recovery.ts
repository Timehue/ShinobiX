import { backgroundWorkStopped, runBackgroundWork } from './_background-work.js';
import { setTimeout, clearTimeout } from 'node:timers';

export type StartupOutcome = 'complete' | 'exhausted' | 'permanent-error' | 'stopped';
type Timer = NodeJS.Timeout;
export type StartupRecoveryOptions = {
    random?: () => number;
    schedule?: (fn: () => void, ms: number) => Timer;
    cancel?: (timer: Timer) => void;
    stopped?: () => boolean;
    admit?: (fn: () => Promise<boolean>) => Promise<boolean | undefined>;
    report?: (name: string, attempt: number, status: string) => void;
};

/** Only known availability errors retry. Never log connection strings or raw errors. */
export function startupFailureKind(error: unknown): 'transient' | 'permanent' {
    const chain: Array<{ code: string; name: unknown; text: string }> = [];
    for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
        const item = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
        chain.push({ code: String(item.code ?? ''), name: item.name, text: typeof item.message === 'string' ? item.message : '' });
        error = item.cause;
    }
    // Guarded REST embeds provider codes. Config failures in a nested cause
    // take precedence over generic transport/lock wording in its wrapper.
    if (chain.some(({ code, name, text }) => name === 'StorageLockCapabilityError' || /^(28|42|PGRST(?!00[0-3]$))/.test(code) || /\b(?:28[A-Z0-9]{3}|42[A-Z0-9]{3}|PGRST(?!00[0-3]\b)[A-Z0-9]+)\b/.test(text))) return 'permanent';
    if (chain.some(({ code, text }) => /^(08\w{3}|53300|57P0[123]|40001|40P01|PGRST00[0-3]|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EMAXCONNSESSION)$/.test(code) || /\b(?:08[A-Z0-9]{3}|53300|57P0[123]|40001|40P01|PGRST00[0-3]|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|EMAXCONNSESSION)\b|(?:max clients reached|max client connections reached|timeout exceeded when trying to connect|Timed out acquiring connection from connection pool|Connection terminated due to connection timeout|Connection terminated unexpectedly)/i.test(text))) return 'transient';
    // Lock acquisition discards causes: bounded ambiguous recovery, not proof
    // that the underlying error is transient. Exhaustion remains visible.
    return chain.some(({ name }) => name === 'LockContendedError' || name === 'LockOwnershipLostError') ? 'transient' : 'permanent';
}

/** One flight per name; waits are outside background drain, attempts are inside it. */
export function createStartupRecovery(options: StartupRecoveryOptions = {}) {
    const jobs = new Map<string, { promise: Promise<StartupOutcome>; finish: (status: StartupOutcome) => void; timer?: Timer; active: boolean }>();
    const schedule: NonNullable<StartupRecoveryOptions['schedule']> = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.cancel ?? clearTimeout;
    const random = options.random ?? Math.random;
    const stopped = options.stopped ?? backgroundWorkStopped;
    const admit = options.admit ?? runBackgroundWork;
    const report = options.report ?? ((name, attempt, status) => {
        const log = status === 'exhausted' || status.startsWith('permanent') ? console.error : console.log;
        log(`[startup-recovery] ${name}: ${status}; attempt=${attempt}/16`);
    });
    let stopping = false;
    function start(name: string, fn: () => Promise<boolean>): Promise<StartupOutcome> {
        const previous = jobs.get(name);
        if (previous) return previous.promise;
        let finish!: (status: StartupOutcome) => void;
        const promise = new Promise<StartupOutcome>(resolve => { finish = resolve; });
        const job = { promise, finish, active: false, timer: undefined as Timer | undefined };
        jobs.set(name, job);
        let attempt = 0;
        async function run(): Promise<void> {
            job.timer = undefined;
            if (stopping || stopped()) { finish('stopped'); return; }
            job.active = true;
            attempt++;
            let retry = true;
            try {
                const complete = await admit(fn);
                if (stopping || stopped() || complete === undefined) { finish('stopped'); return; }
                if (complete) { report(name, attempt, 'complete'); finish('complete'); return; }
                report(name, attempt, 'incomplete-or-contended');
            } catch (error) {
                retry = startupFailureKind(error) === 'transient';
                report(name, attempt, retry ? 'availability-or-lock-failure' : 'permanent-or-unclassified-failure');
            } finally { job.active = false; }
            if (stopping || stopped()) { finish('stopped'); return; }
            if (!retry) { finish('permanent-error'); return; }
            if (attempt >= 16) { report(name, attempt, 'exhausted'); finish('exhausted'); return; }
            const cap = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
            const delay = Math.floor(cap * (0.5 + Math.max(0, Math.min(1, random())) / 2));
            job.timer = schedule(() => { void run(); }, delay);
            job.timer.unref?.();
        }
        void run();
        return promise;
    }
    function stop(): void {
        stopping = true;
        for (const job of jobs.values()) {
            if (job.timer) cancel(job.timer);
            job.timer = undefined;
            if (!job.active) job.finish('stopped');
        }
    }
    return { start, stop };
}
