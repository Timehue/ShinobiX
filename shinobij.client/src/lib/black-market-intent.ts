import type { BrokerPayment } from '../../../shared/sunscar/broker-certificates';

type PullIntent = { requestId: string; payment: BrokerPayment };
const pending = new Map<string, PullIntent>();
const keyFor = (player: string) => `shinobix:broker-pull:v1:${player.trim().toLowerCase()}`;

function read(key: string): PullIntent | undefined {
    try {
        const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as PullIntent | null;
        if (stored && typeof stored.requestId === 'string' && /^\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]{8,64}$/.test(stored.requestId)
            && (stored.payment === 'ryo' || stored.payment === 'certificate')) return stored;
    } catch { /* Storage may be unavailable; retain the in-memory request. */ }
    return pending.get(key);
}

/** The UI must offer recovery even if the unknown pull used the last certificate/daily slot. */
export function pendingBrokerPullIntent(player: string): PullIntent | undefined { return read(keyFor(player)); }

/** Keep the original payment and ID until its outcome is known, even after a reload. */
export function brokerPullIntent(player: string, payment: BrokerPayment, day: string): PullIntent {
    const key = keyFor(player);
    let intent = read(key);
    if (!intent) {
        const nonce = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
        intent = { requestId: `${day}_${nonce}`, payment };
    }
    pending.set(key, intent);
    try { localStorage.setItem(key, JSON.stringify(intent)); } catch { /* Memory fallback. */ }
    return intent;
}

export function clearBrokerPullIntent(player: string, requestId: string): void {
    const key = keyFor(player);
    if (read(key)?.requestId !== requestId) return;
    pending.delete(key);
    try { localStorage.removeItem(key); } catch { /* Memory fallback. */ }
}

export function resetBrokerPullIntentsForTests(): void { pending.clear(); }
