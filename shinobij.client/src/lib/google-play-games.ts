import { isAppShell } from './surface';
import { takeEarlyPlayRewardEvents } from './play-reward-event-inbox';

type PlayGamesRequest = Record<string, unknown>;
type PlayGamesResponse = { available?: boolean; configured?: boolean; accepted?: boolean };
export type PlayRewardPurchase = { productId: string; purchaseToken: string };
export type PlayRewardClaimResponse = {
    ok: true;
    rewardLabel: string;
    title?: string;
    ryo?: number;
    granted: boolean;
    alreadyOwned: boolean;
    acknowledged: boolean;
    character?: unknown;
    saveVersion?: number;
};

const PLAY_REWARD_LABEL_BY_PRODUCT: Readonly<Record<string, string>> = {
    sj_reward_title_dawn: 'Dawn-Sealed Shinobi',
    sj_reward_title_ember: 'Emberbound Shinobi',
    sj_reward_ryo_cache_small: '100 Ryo Cache',
};
const pendingRewardPurchases: PlayRewardPurchase[] = [];
const rewardPurchaseListeners = new Set<(purchase: PlayRewardPurchase) => void>();

function receivePlayRewardPurchases(detail: unknown): void {
    if (!Array.isArray(detail)) return;
    for (const value of detail) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as Partial<PlayRewardPurchase>;
        if (typeof candidate.productId !== 'string' || typeof candidate.purchaseToken !== 'string') continue;
        if (!PLAY_REWARD_LABEL_BY_PRODUCT[candidate.productId] || candidate.purchaseToken.length < 16) continue;
        if (pendingRewardPurchases.some((item) => item.productId === candidate.productId && item.purchaseToken === candidate.purchaseToken)) continue;
        const purchase = { productId: candidate.productId, purchaseToken: candidate.purchaseToken };
        if (rewardPurchaseListeners.size === 0) {
            pendingRewardPurchases.push(purchase);
            continue;
        }
        for (const listener of rewardPurchaseListeners) listener(purchase);
    }
}

function receivePlayRewardEvent(event: Event): void {
    if (event instanceof CustomEvent) receivePlayRewardPurchases(event.detail);
}

if (typeof window !== 'undefined') {
    window.addEventListener('shinobiPlayRewardPurchases', receivePlayRewardEvent);
    for (const detail of takeEarlyPlayRewardEvents()) receivePlayRewardPurchases(detail);
}

/** Subscribe to purchase receipts found by native Billing on app start/resume. */
export function onPlayRewardPurchases(listener: (purchase: PlayRewardPurchase) => void): () => void {
    rewardPurchaseListeners.add(listener);
    const queued = pendingRewardPurchases.splice(0, pendingRewardPurchases.length);
    for (const purchase of queued) listener(purchase);
    return () => rewardPurchaseListeners.delete(listener);
}

export function playRewardLabelForProduct(productId: string): string | null {
    return PLAY_REWARD_LABEL_BY_PRODUCT[productId] ?? null;
}

/** Send only the receipt to the server; the active game session supplies identity. */
export async function claimPlayRewardPurchase(
    playerName: string,
    purchase: PlayRewardPurchase,
): Promise<PlayRewardClaimResponse> {
    const response = await fetch('/api/play/reward-claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName, productId: purchase.productId, purchaseToken: purchase.purchaseToken }),
    });
    const data = await response.json().catch(() => ({})) as Partial<PlayRewardClaimResponse> & { error?: string };
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'Could not claim this Play reward. Please try again.');
    return data as PlayRewardClaimResponse;
}

type FlutterWebViewBridge = {
    callHandler?: (name: string, request: PlayGamesRequest) => Promise<unknown>;
};

function invokePlayGames(request: PlayGamesRequest): Promise<unknown> | null {
    if (typeof window === 'undefined' || !isAppShell()) return null;
    const bridge = (window as Window & { flutter_inappwebview?: FlutterWebViewBridge }).flutter_inappwebview;
    if (typeof bridge?.callHandler !== 'function') return null;
    try {
        return bridge.callHandler('shinobiPlayGames', request).catch(() => null);
    } catch {
        return null;
    }
}

/** Mirror only new unlocks returned by /api/achievements/sync after save commit. */
export function mirrorServerAchievementUnlocks(ids: readonly string[] | null | undefined): void {
    if (!ids?.length) return;
    for (const key of ids) {
        if (/^[a-z0-9_-]{1,64}$/i.test(key)) {
            void invokePlayGames({ action: 'unlockAchievement', key });
        }
    }
}

export async function isPlayGamesAuthenticated(): Promise<boolean> {
    const result = await invokePlayGames({ action: 'status' }) as PlayGamesResponse & { authenticated?: boolean } | null;
    return result?.available === true && result.authenticated === true;
}

/**
 * Emit a schema-configured Game Stats event after its gameplay result is
 * server-confirmed. Callers must not use this for client-predicted outcomes.
 */
export function recordServerConfirmedPlayEvent(
    key: string,
    properties: Record<string, string | number | boolean> = {},
): Promise<PlayGamesResponse | null> | null {
    if (!/^[a-z0-9_-]{1,64}$/i.test(key)) return null;
    return invokePlayGames({ action: 'recordEvent', key, properties }) as Promise<PlayGamesResponse | null> | null;
}

/** Platform UI is opened only in direct response to a player's deliberate tap. */
export function showPlayGamesAchievements(): Promise<boolean> | null {
    const result = invokePlayGames({ action: 'showAchievements' });
    return result ? result.then(value => value === true) : null;
}
