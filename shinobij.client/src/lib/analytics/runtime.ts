import {
    createProductEvent,
    normalizedAnalyticsHost,
    type PostHogDispatchConfig,
    type ProductEvent,
    type ProductEventName,
} from '../../../../shared/product-analytics';
import { viewportClassForWidth } from '../viewport-contract';
import { getSurface } from '../surface';

type ClientAnalyticsEnv = Record<string, string | undefined>;
type ProviderModule = typeof import('./posthog');

const ENV = (import.meta as ImportMeta & { env?: ClientAnalyticsEnv }).env ?? {};
const MAX_QUEUE = 32;
const queue: ProductEvent[] = [];
let draining = false;
let providerPromise: Promise<ProviderModule> | null = null;

const status = {
    enabled: false,
    provider: 'none' as 'posthog' | 'none',
    lastDispatchStatus: 'disabled' as 'disabled' | 'queued' | 'sent' | 'failed' | 'dropped',
    droppedEvents: 0,
    failedEvents: 0,
};

export function clientAnalyticsConfig(env: ClientAnalyticsEnv = ENV): PostHogDispatchConfig | null {
    if (env.VITE_PRODUCT_ANALYTICS_ENABLED !== '1') return null;
    if (String(env.VITE_PRODUCT_ANALYTICS_PROVIDER ?? '').toLowerCase() !== 'posthog') return null;
    const projectKey = String(env.VITE_POSTHOG_KEY ?? '').trim();
    const host = normalizedAnalyticsHost(env.VITE_POSTHOG_HOST);
    if (!projectKey || !host) return null;
    return { projectKey, host, timeoutMs: 1_500 };
}

export function readClientAnalyticsStatus() {
    return { ...status };
}

async function drainQueue(config: PostHogDispatchConfig): Promise<void> {
    if (draining) return;
    draining = true;
    try {
        providerPromise ??= import('./posthog');
        const provider = await providerPromise;
        while (queue.length > 0) {
            const event = queue.shift()!;
            const sent = await provider.dispatchClientPostHogEvent(config, event);
            status.lastDispatchStatus = sent ? 'sent' : 'failed';
            if (!sent) status.failedEvents += 1;
        }
    } catch {
        status.failedEvents += queue.length || 1;
        queue.length = 0;
        status.lastDispatchStatus = 'failed';
        providerPromise = null;
    } finally {
        draining = false;
    }
}

/**
 * Coarse buckets stamped onto every client-observed event: which surface the
 * document is on (Play app vs web) and which width band it is rendering at.
 *
 * Stamped centrally rather than at each call site so coverage cannot drift —
 * a new event gets them for free. Both are deliberately low-cardinality (two
 * values and six), which keeps the pilot aggregate-only: they answer "what
 * share of play happens on a phone, and in the app" without approaching a
 * device identity, and the shared distinct_id means there is nothing to join
 * them against anyway.
 *
 * Never throws: analytics must not be able to break a render path.
 */
function ambientProperties(): Record<string, string> {
    const ambient: Record<string, string> = {};
    try {
        ambient.surface = getSurface();
        if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth)) {
            ambient.viewportClass = viewportClassForWidth(window.innerWidth);
        }
    } catch { /* headless, sandboxed, or storage-denied — omit rather than fail */ }
    return ambient;
}

export function captureConfiguredProductEvent(name: ProductEventName, properties: Record<string, unknown> = {}): boolean {
    const config = clientAnalyticsConfig();
    if (!config) {
        status.enabled = false;
        status.provider = 'none';
        status.lastDispatchStatus = 'disabled';
        return false;
    }
    // Ambient values go AFTER the spread, like eventAuthority: they are runtime
    // truth and a call site must not be able to claim a different surface.
    const event = createProductEvent(name, {
        ...properties,
        ...ambientProperties(),
        eventAuthority: 'client_observed',
    });
    status.enabled = true;
    status.provider = 'posthog';
    if (!event || queue.length >= MAX_QUEUE) {
        status.droppedEvents += 1;
        status.lastDispatchStatus = 'dropped';
        return false;
    }
    queue.push(event);
    status.lastDispatchStatus = 'queued';
    void drainQueue(config);
    return true;
}
