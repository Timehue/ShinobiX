import { EXCHANGE_CURRENCIES, EXCHANGE_SALE_EVENT, isExchangeSaleReceipt, type ExchangeSaleReceipt } from '../../../shared/sunscar-exchange';
import type { Character, VersionedCharacterCommit } from '../types/character';
import { gameToast } from '../components/GameToast';
import { applyOfflineNotices } from './offline-notices';
import { withholdNoticeAck } from './notice-ack';

type Notice = { kind: 'exchange-sale'; sale: ExchangeSaleReceipt };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type Options = {
    accountKey: string;
    isCurrent: () => boolean;
    commit: VersionedCharacterCommit;
    fetch?: typeof fetch;
    visible?: () => boolean;
    storage?: StorageLike | null;
    toast?: (message: string) => void;
    showOther?: (message: string) => void;
};
const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
const shownByAccount = new Map<string, Set<string>>();
const ledgerKey = (account: string) => `sunscar-exchange:noticed:${account}`;
const number = (value: number) => value.toLocaleString('en-US');

function browserStorage(): StorageLike | null {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function shownSales(account: string, storage: StorageLike | null): Set<string> {
    const shown = shownByAccount.get(account) ?? new Set<string>();
    try {
        const saved: unknown = JSON.parse(storage?.getItem(ledgerKey(account)) ?? '[]');
        if (Array.isArray(saved)) for (const id of saved.slice(-500)) if (typeof id === 'string') shown.add(id);
    } catch { /* The session ledger still deduplicates if storage is unavailable. */ }
    shownByAccount.set(account, shown);
    return shown;
}

export function exchangeSaleMessage(sales: readonly ExchangeSaleReceipt[]): string {
    if (sales.length === 1) {
        const sale = sales[0];
        return `Sunscar Exchange: ${number(sale.quantity)} × ${sale.assetName} sold. You received ${number(sale.proceeds)} ${EXCHANGE_CURRENCIES[sale.currency]} after the 5% fee.`;
    }
    const total = { ryo: 0, fateShards: 0 };
    for (const sale of sales) total[sale.currency] += sale.proceeds;
    const amounts = (['ryo', 'fateShards'] as const).filter(currency => total[currency] > 0)
        .map(currency => `${number(total[currency])} ${EXCHANGE_CURRENCIES[currency]}`).join(' and ');
    return `Sunscar Exchange: ${number(sales.length)} listings sold. You received ${amounts} after fees. See Trade history for details.`;
}

/** Deliver sale feedback only after adopting the current server save. The
 * receipt describes a completed payment; its amounts never mutate a wallet. */
export async function applyHeartbeatNotices(notices: unknown, options: Options): Promise<number> {
    const list: unknown[] = Array.isArray(notices) ? notices : [];
    if (!options.isCurrent()) { withholdNoticeAck(list); return 0; }
    const isSale = (value: unknown) => !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'exchange-sale';
    const saleNotices = list.filter(isSale);
    const otherCount = applyOfflineNotices(list.filter(n => !isSale(n)), options.showOther);
    if (!saleNotices.length) return otherCount;
    const account = slug(options.accountKey);
    const valid = saleNotices.filter((n): n is Notice => isExchangeSaleReceipt((n as Notice).sale) && (n as Notice).sale.seller === account);
    if (valid.length !== saleNotices.length) withholdNoticeAck(saleNotices.filter(n => !valid.includes(n as Notice)));
    // A background tab must not acknowledge a toast that expires unseen.
    if (!(options.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible'))()) {
        withholdNoticeAck(saleNotices); return otherCount;
    }
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    const shown = shownSales(account, storage);
    const sales = [...new Map(valid.filter(n => !shown.has(n.sale.listingId)).map(n => [n.sale.listingId, n.sale])).values()];
    if (!sales.length) return otherCount;
    try {
        const response = await (options.fetch ?? fetch)(`/api/save/${encodeURIComponent(account)}`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok || !options.isCurrent()) throw new Error('Sale balance is awaiting reconciliation.');
        const snapshot = await response.json() as { character?: Character; _saveVersion?: unknown };
        if (!options.isCurrent() || !snapshot.character || slug(snapshot.character.name) !== account) throw new Error('Retired sale notification session.');
        if (!options.commit(snapshot.character, snapshot._saveVersion) || !options.isCurrent()) throw new Error('Sale snapshot was not accepted.');
        // Re-check visibility after the network request, before showing/acking.
        if (!(options.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible'))()) throw new Error('Sale notification tab is hidden.');
        (options.toast ?? ((message: string) => gameToast(message, { kind: 'success', duration: 8000 })))(exchangeSaleMessage(sales));
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EXCHANGE_SALE_EVENT, { detail: { seller: account } }));
        for (const sale of sales) shown.add(sale.listingId);
        const retained = [...shown].slice(-500);
        shownByAccount.set(account, new Set(retained));
        try { storage?.setItem(ledgerKey(account), JSON.stringify(retained)); } catch { /* Session dedupe remains available. */ }
        return otherCount + sales.length;
    } catch {
        withholdNoticeAck(saleNotices);
        return otherCount;
    }
}

export function resetSaleNotificationSession(): void { shownByAccount.clear(); }
