import {
    createProductEvent,
    dispatchPostHogEvent,
    normalizedAnalyticsHost,
    type PostHogDispatchConfig,
    type ProductEventName,
} from '../shared/product-analytics.js';

type AnalyticsEnv = Record<string, string | undefined>;
type BetaBridgeInput = { event: string; level?: number; source?: string };

export type ProductAnalyticsStatus = {
    enabled: boolean;
    provider: 'posthog' | 'none';
    lastDispatchStatus: 'disabled' | 'queued' | 'sent' | 'failed' | 'dropped';
    droppedEvents: number;
    failedEvents: number;
};

const status: ProductAnalyticsStatus = {
    enabled: false, provider: 'none', lastDispatchStatus: 'disabled', droppedEvents: 0, failedEvents: 0,
};

export function serverAnalyticsConfig(env: AnalyticsEnv = process.env): PostHogDispatchConfig | null {
    if (env.PRODUCT_ANALYTICS_ENABLED !== '1') return null;
    if (String(env.PRODUCT_ANALYTICS_PROVIDER ?? '').toLowerCase() !== 'posthog') return null;
    const projectKey = String(env.POSTHOG_PROJECT_KEY ?? '').trim();
    const host = normalizedAnalyticsHost(env.POSTHOG_HOST);
    if (!projectKey || !host) return null;
    return { projectKey, host, timeoutMs: 1_500 };
}

export function readProductAnalyticsStatus(): ProductAnalyticsStatus {
    return { ...status };
}

export async function dispatchServerProductEvent(
    name: ProductEventName,
    properties: Record<string, unknown> = {},
    options: { env?: AnalyticsEnv; fetcher?: typeof fetch } = {},
): Promise<'disabled' | 'sent' | 'failed' | 'dropped'> {
    const config = serverAnalyticsConfig(options.env);
    if (!config) return 'disabled';
    const event = createProductEvent(name, { ...properties, eventAuthority: 'server_authoritative' });
    if (!event) return 'dropped';
    return await dispatchPostHogEvent(config, event, options.fetcher) ? 'sent' : 'failed';
}

/** Queue without awaiting so analytics can never block settlement or gameplay. */
export function captureServerProductEvent(name: ProductEventName, properties: Record<string, unknown> = {}): boolean {
    const config = serverAnalyticsConfig();
    if (!config) {
        status.enabled = false;
        status.provider = 'none';
        status.lastDispatchStatus = 'disabled';
        return false;
    }
    const event = createProductEvent(name, { ...properties, eventAuthority: 'server_authoritative' });
    status.enabled = true;
    status.provider = 'posthog';
    if (!event) {
        status.droppedEvents += 1;
        status.lastDispatchStatus = 'dropped';
        return false;
    }
    status.lastDispatchStatus = 'queued';
    void dispatchPostHogEvent(config, event).then((sent) => {
        status.lastDispatchStatus = sent ? 'sent' : 'failed';
        if (!sent) status.failedEvents += 1;
    }).catch(() => {
        status.lastDispatchStatus = 'failed';
        status.failedEvents += 1;
    });
    return true;
}

function levelBand(level: unknown): string {
    const value = Math.max(0, Math.floor(Number(level) || 0));
    if (value < 10) return 'L1-9';
    if (value < 20) return 'L10-19';
    if (value < 40) return 'L20-39';
    if (value < 80) return 'L40-79';
    return 'L80-100';
}

/** Bridge only canonical, trustworthy internal beta events. */
export function captureProductEventFromBetaMetric(input: BetaBridgeInput): boolean {
    if (input.event === 'account.registered') {
        return captureServerProductEvent('account_registered', { source: input.source ?? 'auth' });
    }
    if (input.event === 'mission.claimed') {
        return captureServerProductEvent('mission_settled', {
            source: input.source ?? 'mission', levelBand: levelBand(input.level),
        });
    }
    if (input.event === 'pvp.settled' && String(input.source ?? '').startsWith('ranked-')) {
        const [mode = 'ranked', resultCategory = 'unknown'] = String(input.source).split(':', 2);
        return captureServerProductEvent('ranked_match_settled', {
            mode, resultCategory, levelBand: levelBand(input.level),
        });
    }
    return false;
}
