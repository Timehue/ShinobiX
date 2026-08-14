/** Explicit, aggregate-only product events shared by client and server. */
export const PRODUCT_EVENT_NAMES = [
    'landing_viewed',
    'character_creation_started',
    'feature_entry_clicked',
    'recoverable_ui_error_shown',
    'account_registered',
    'character_created',
    'mission_started',
    'mission_settled',
    'shop_purchase_settled',
    'pet_breeding_started',
    'ranked_match_settled',
    'activity_recommendation_viewed',
    'clan_boss_party_state_changed',
    'clan_boss_operation_started',
    'clan_boss_operation_settled',
    'supporter_page_viewed',
    'patreon_connection_started',
    'patreon_connection_succeeded',
    'patreon_connection_failed',
    'locked_jutsu_slot_inspected',
    'sanctuary_overflow_explanation_viewed',
    'subscription_entitlement_refresh_failed',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_EVENT_PROPERTY_KEYS = [
    'source', 'screenId', 'mode', 'resultCategory', 'levelBand', 'villageCode',
    'deviceTier', 'viewportClass', 'featureFlag', 'featureFlagState',
    'durationBucket', 'errorCategory', 'contentId', 'eventAuthority',
    'partySizeBucket', 'queueWaitBucket', 'stateCategory', 'contributionCategory',
    'horizon', 'focus',
] as const;

export type ProductEventPropertyKey = (typeof PRODUCT_EVENT_PROPERTY_KEYS)[number];
export type ProductEventProperties = Partial<Record<ProductEventPropertyKey, string | boolean>>;
export type ProductEvent = { name: ProductEventName; properties: ProductEventProperties };

const EVENT_SET = new Set<string>(PRODUCT_EVENT_NAMES);
const PROPERTY_SET = new Set<string>(PRODUCT_EVENT_PROPERTY_KEYS);
const SAFE_VALUE = /^[A-Za-z0-9_.:/-]{1,80}$/;

export function createProductEvent(name: string, properties: Record<string, unknown> = {}): ProductEvent | null {
    if (!EVENT_SET.has(name)) return null;
    const safe: ProductEventProperties = {};
    for (const [key, value] of Object.entries(properties)) {
        if (!PROPERTY_SET.has(key)) continue;
        if (typeof value === 'boolean') {
            safe[key as ProductEventPropertyKey] = value;
            continue;
        }
        if (typeof value !== 'string') continue;
        const bounded = value.trim().slice(0, 80);
        if (SAFE_VALUE.test(bounded)) safe[key as ProductEventPropertyKey] = bounded;
    }
    return { name: name as ProductEventName, properties: safe };
}

/**
 * PostHog requires distinct_id even for anonymous capture. This constant is
 * intentionally shared by every event: it is not a player, device, or session
 * identity and cannot support unique-user analysis.
 */
export const AGGREGATE_DISTINCT_ID = 'shinobi-journey-aggregate-v1';

export type PostHogDispatchConfig = { projectKey: string; host: string; timeoutMs: number };

export async function dispatchPostHogEvent(
    config: PostHogDispatchConfig,
    event: ProductEvent,
    fetcher: typeof fetch = fetch,
): Promise<boolean> {
    try {
        const response = await fetcher(`${config.host}/i/v0/e/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: config.projectKey,
                event: event.name,
                distinct_id: AGGREGATE_DISTINCT_ID,
                properties: { ...event.properties, $process_person_profile: false },
            }),
            keepalive: true,
            signal: AbortSignal.timeout(config.timeoutMs),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export function normalizedAnalyticsHost(raw: unknown): string | null {
    try {
        const url = new URL(String(raw ?? '').trim());
        const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
        if (url.username || url.password || url.search || url.hash) return null;
        if (url.pathname !== '/' && url.pathname !== '') return null;
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
        return url.origin;
    } catch {
        return null;
    }
}
