import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { EXCHANGE_CURRENCIES, EXCHANGE_LISTING_LIMIT, EXCHANGE_MAX_PRICE, EXCHANGE_MAX_QUANTITY, exchangeCurrency, exchangeFee, type ExchangeCurrency, type ExchangeKind, type ExchangeListing } from '../../shared/sunscar-exchange.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { battleLockedFor } from '../_elapsed-state.js';
import { FORGED_ITEM_ID } from '../_forged-item-registry.js';
import { recordEconomyTxn } from '../_economy.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { kickPlayer } from '../_realtime/notify.js';
import { loadSettlementCatalogs, type SettlementCatalogs } from '../shop/_catalog.js';
import { balance, ExchangeError, exchangeInventory, grantAsset, objects, recoverExchangeDefinitions, removeAsset, sealAsset, type SealedExchangeAsset } from './_exchange-assets.js';

type Obj = Record<string, unknown>;
export type StoredExchangeListing = ExchangeListing & { sealed: SealedExchangeAsset; fingerprint: string; failure?: string; recoveryKey?: string; saleNoticePending?: boolean };
const LIVE_INDEX = 'sunscar-exchange:live';
const PENDING_INDEX = 'sunscar-exchange:pending';
const HISTORY_LIMIT = 100;
const playerIndex = (name: string) => `sunscar-exchange:player:${name}`;
export const exchangeListingKey = (id: string) => `sunscar-exchange:listing:${id}`;
const pending = (l: ExchangeListing) => ['preparing', 'buying', 'cancelling'].includes(l.state);
const journal = (c: Obj): string[] => Array.isArray(c.sunscarExchangeReceipts) ? c.sunscarExchangeReceipts as string[] : [];
const stamp = (c: Obj, marker: string): Obj => ({ ...c, sunscarExchangeReceipts: [...new Set([...journal(c), marker])] });
export const publicListing = ({ sealed: _sealed, fingerprint: _fp, failure: _failure, recoveryKey: _recovery, saleNoticePending: _notice, ...listing }: StoredExchangeListing): ExchangeListing => ({ ...listing, currency: exchangeCurrency(listing) });

function parseCurrency(value: unknown): ExchangeCurrency {
    if (value === undefined) return 'ryo';
    if (value === 'ryo' || value === 'fateShards') return value;
    throw new ExchangeError('Choose ryo or Fate Shards as the listing currency.', 400);
}

async function transition(current: StoredExchangeListing, patch: Partial<StoredExchangeListing>): Promise<StoredExchangeListing> {
    const next = { ...current, ...patch };
    // Match JSON storage on both success and ambiguous-write readback.
    if (next.buyer === undefined) delete next.buyer;
    const key = exchangeListingKey(current.id);
    if (pending(next)) {
        if (next.state !== current.state) next.recoveryKey = `${next.id}:${randomUUID()}`;
        await kv.hset(PENDING_INDEX, { [next.recoveryKey ?? next.id]: Date.now() });
    }
    try {
        if (!await kv.compareSet(key, current, next)) throw new ExchangeError('This listing changed. Refresh the Exchange.');
    } catch (error) {
        if (!isDeepStrictEqual(await kv.get(key), next)) throw error;
    }
    return next;
}

async function indexed(index: string): Promise<StoredExchangeListing[]> {
    const refs = await kv.hgetall<Record<string, number>>(index) ?? {};
    const ids = Object.keys(refs);
    const records: StoredExchangeListing[] = [];
    for (let i = 0; i < ids.length; i += 100) {
        const page = await kv.mget<StoredExchangeListing[]>(...ids.slice(i, i + 100).map(exchangeListingKey));
        records.push(...page.filter((v): v is StoredExchangeListing => !!v));
    }
    return records;
}

// Receipts are never aged out while a transfer is pending. Terminal listing
// records have no TTL: retries cannot become new purchases after a day passes.
async function cleanup(listing: StoredExchangeListing): Promise<void> {
    if (!['active', 'sold', 'cancelled', 'failed'].includes(listing.state)) return;
    if (listing.state !== 'active') await kv.hdel(LIVE_INDEX, listing.id);
    for (const actor of [listing.seller, listing.buyer].filter((v): v is string => !!v)) {
        await mutatePlayerSave(actor, ({ character }) => {
            const old = journal(character);
            // An expired lease's active-listing cleanup must never erase a
            // receipt belonging to the purchase that followed it.
            const next = old.filter(marker => listing.state === 'active' ? marker !== `${listing.id}:escrow` : !marker.startsWith(`${listing.id}:`));
            return { ok: true, character: next.length === old.length ? character : { ...character, sunscarExchangeReceipts: next }, value: null, write: next.length !== old.length };
        });
        const history = await indexed(playerIndex(actor));
        const terminal = history.filter(l => !pending(l) && l.state !== 'active').sort((a, b) => b.createdAt - a.createdAt);
        if (terminal.length > HISTORY_LIMIT) await kv.hdel(playerIndex(actor), ...terminal.slice(HISTORY_LIMIT).map(l => l.id));
    }
    await kv.hdel(PENDING_INDEX, listing.recoveryKey ?? listing.id);
}

async function applyLeg(listing: StoredExchangeListing, actor: string, leg: 'escrow' | 'purchase' | 'payment' | 'return', catalogs?: SettlementCatalogs) {
    const marker = `${listing.id}:${leg}`;
    const out = await mutatePlayerSave(actor, async ({ character, record }) => {
        const fresh = await kv.get<StoredExchangeListing>(exchangeListingKey(listing.id));
        const expectedState = leg === 'escrow' ? 'preparing' : leg === 'return' ? 'cancelling' : 'buying';
        if (!fresh || fresh.state !== expectedState || fresh.buyer !== listing.buyer || fresh.recoveryKey !== listing.recoveryKey) throw new Error('exchange-leg-state-changed');
        if (journal(character).includes(marker)) return { ok: true as const, character, value: null, write: false };
        let next: Obj = character;
        let recordPatch: Obj | undefined;
        const currency = exchangeCurrency(listing);
        if (leg === 'escrow') {
            if (await battleLockedFor(actor)) throw new ExchangeError('Finish your current battle before listing an asset.');
            if (listing.asset.kind === 'pet') {
                const defenses = await Promise.all(['coliseum', 'tactical'].map(mode => kv.get<Obj>(`petladder:${mode}:def:${actor}`)));
                if (defenses.some(defense => objects(defense?.pets).some(p => p.id === listing.asset.id))) throw new ExchangeError('Remove this companion from your ladder defense before listing it.');
            }
            const sealed = sealAsset(await recoverExchangeDefinitions({ ...record, character }), catalogs!, listing.asset.kind, listing.asset.id);
            // Seal the exact current pet/forged definition before removing it.
            listing = await transition(listing, { sealed, asset: sealed.asset });
            next = removeAsset(character, sealed, listing.quantity);
        } else if (leg === 'purchase') {
            const seller = await kv.get<Obj>(`save:${listing.seller}`);
            if (!seller?.character) throw new ExchangeError('The seller’s account is no longer available.');
            balance(balance((seller.character as Obj)[currency] ?? 0) + listing.proceeds);
            if (balance(character[currency] ?? 0) < listing.price) throw new ExchangeError(`You do not have enough ${EXCHANGE_CURRENCIES[currency]} for this listing.`);
            // A resource lot can contain the payment currency itself. Require
            // funds up front, then preserve the delivered units when debiting.
            const delivered = grantAsset(character, listing.sealed, listing.quantity);
            next = { ...delivered, [currency]: balance(delivered[currency] ?? 0) - listing.price };
        } else if (leg === 'payment') {
            next = { ...character, [currency]: balance(balance(character[currency] ?? 0) + listing.proceeds) };
        } else next = grantAsset(character, listing.sealed, listing.quantity, true);
        if ((leg === 'purchase' || leg === 'return') && FORGED_ITEM_ID.test(listing.asset.id)) {
            recordPatch = { creatorItems: [...objects(record.creatorItems).filter(item => item.id !== listing.asset.id), listing.sealed.definition] };
        }
        return { ok: true as const, character: stamp(next, marker), value: null, recordPatch };
    });
    if (!out.ok) throw new ExchangeError(out.error, out.status);
    return listing;
}

async function recoverLocked(current: StoredExchangeListing, catalogs?: SettlementCatalogs): Promise<StoredExchangeListing> {
    let listing = current;
    if (listing.state === 'preparing') {
        try { listing = await applyLeg(listing, listing.seller, 'escrow', catalogs ?? await loadSettlementCatalogs()); }
        catch (error) {
            if (error instanceof ExchangeError) {
                // Re-read the sealed revision; definition sealing may already
                // have committed even when ownership validation then refused.
                const fresh = await kv.get<StoredExchangeListing>(exchangeListingKey(listing.id));
                if (fresh?.state === 'preparing') await cleanup(await transition(fresh, { state: 'failed', failure: error.message, completedAt: Date.now() }));
            }
            throw error;
        }
        listing = await transition(listing, { state: 'active' });
    }
    if (listing.state === 'buying') {
        try { await applyLeg(listing, listing.buyer!, 'purchase'); }
        catch (error) {
            // A refusal before a save commit is reversible. Storage errors are
            // ambiguous and leave the reservation intact for receipt recovery.
            if (error instanceof ExchangeError) {
                const reopened = await transition(listing, { state: 'active', buyer: undefined });
                await kv.hdel(playerIndex(listing.buyer!), listing.id);
                await cleanup(reopened);
            }
            throw error;
        }
        await applyLeg(listing, listing.seller, 'payment');
        listing = await transition(listing, { state: 'sold', completedAt: Date.now(), saleNoticePending: true });
        // Telemetry uses a shared read/modify/write list; do not race the two
        // sides of our own trade against each other.
        await recordEconomyTxn({ txnId: `exchange:${listing.id}:buy`, player: listing.buyer!, currency: exchangeCurrency(listing), delta: -listing.price, source: 'sunscar.exchange' });
        await recordEconomyTxn({ txnId: `exchange:${listing.id}:sell`, player: listing.seller, currency: exchangeCurrency(listing), delta: listing.proceeds, source: 'sunscar.exchange' });
    }
    if (listing.state === 'sold' && listing.saleNoticePending) {
        try {
            await pushOfflineNotice(listing.seller, { kind: 'exchange-sale', by: listing.buyer!, sector: 0, at: listing.completedAt!,
                sale: { listingId: listing.id, seller: listing.seller, assetName: listing.asset.name, quantity: listing.quantity,
                    currency: exchangeCurrency(listing), price: listing.price, fee: listing.fee, proceeds: listing.proceeds } });
            listing = await transition(listing, { saleNoticePending: false });
            kickPlayer(listing.seller, 'exchange-sale');
        } catch {
            // The sale is already paid. Keep its recovery pointer and return
            // success; a notification outage must never undo or repeat payment.
            return listing;
        }
    }
    if (listing.state === 'cancelling') {
        try { await applyLeg(listing, listing.seller, 'return'); }
        catch (error) {
            if (error instanceof ExchangeError) throw new ExchangeError(`${error.message} Your goods remain safely held. Make room, then retry the cancellation.`, error.status, true);
            throw error;
        }
        listing = await transition(listing, { state: 'cancelled', completedAt: Date.now() });
    }
    await cleanup(listing);
    return listing;
}

export async function createExchangeListing(player: string, input: { requestId: string; kind: ExchangeKind; assetId: string; quantity: number; price: number; currency?: unknown }): Promise<ExchangeListing> {
    const currency = parseCurrency(input.currency);
    if (!['item', 'pet', 'card', 'resource'].includes(input.kind) || !input.assetId || input.assetId.length > 160) throw new ExchangeError('Choose a valid asset.', 400);
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > EXCHANGE_MAX_QUANTITY) throw new ExchangeError('Enter a valid whole quantity.', 400);
    if (!Number.isSafeInteger(input.price) || input.price < 1 || input.price > EXCHANGE_MAX_PRICE) throw new ExchangeError(`The total price must be between 1 and ${EXCHANGE_MAX_PRICE.toLocaleString()} ${EXCHANGE_CURRENCIES[currency]}.`, 400);
    const id = createHash('sha256').update(`${player}:${input.requestId}`).digest('hex').slice(0, 32);
    // Keep old ryo request fingerprints replayable across this rollout.
    const fingerprint = JSON.stringify([input.kind, input.assetId, input.quantity, input.price, ...(currency === 'ryo' ? [] : [currency])]);
    return withKvLock('sunscar-exchange:create', () => withKvLock(exchangeListingKey(id), async () => {
        let listing = await kv.get<StoredExchangeListing>(exchangeListingKey(id));
        if (listing && listing.fingerprint !== fingerprint) throw new ExchangeError('This request ID was already used for a different listing.');
        if (listing?.state === 'failed') throw new ExchangeError(listing.failure ?? 'This listing could not be created.');
        const catalogs = await loadSettlementCatalogs();
        if (!listing) {
            const live = await indexed(LIVE_INDEX);
            if (live.filter(l => l.seller === player && (pending(l) || l.state === 'active')).length >= EXCHANGE_LISTING_LIMIT) throw new ExchangeError(`You can have ${EXCHANGE_LISTING_LIMIT} open listings. Cancel or sell one first.`);
            if (live.length >= 2000) throw new ExchangeError('The Exchange is at capacity. Try again after a listing closes.');
            const record = await kv.get<Obj>(`save:${player}`);
            if (!record?.character) throw new ExchangeError('Player save not found.', 404);
            const sealed = sealAsset(await recoverExchangeDefinitions(record), catalogs, input.kind, input.assetId);
            const fee = exchangeFee(input.price);
            listing = { id, seller: player, sellerName: String((record.character as Obj).name), sealed, asset: sealed.asset,
                quantity: input.quantity, price: input.price, currency, fee, proceeds: input.price - fee, createdAt: Date.now(), state: 'preparing', fingerprint };
            // Index first: an interruption can leave an inert pointer, never an
            // unfindable escrow. Nothing has been removed at this point.
            await kv.hset(LIVE_INDEX, { [id]: listing.createdAt });
            await kv.hset(playerIndex(player), { [id]: listing.createdAt });
            await kv.hset(PENDING_INDEX, { [id]: listing.createdAt });
            if (!await kv.set(exchangeListingKey(id), listing, { nx: true })) throw new ExchangeError('This listing is already being created. Refresh to recover it.');
        }
        return publicListing(await recoverLocked(listing, catalogs));
    }, { failClosed: true, ttlSec: 60 }), { failClosed: true, ttlSec: 60 });
}

export async function actOnExchangeListing(player: string, id: string, action: 'buy' | 'cancel', expectedPrice?: number, expectedCurrency?: unknown): Promise<ExchangeListing> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new ExchangeError('Invalid listing.', 400);
    return withKvLock(exchangeListingKey(id), async () => {
        let listing = await kv.get<StoredExchangeListing>(exchangeListingKey(id));
        if (!listing) throw new ExchangeError('This listing was not found.', 404);
        if (action === 'cancel' && listing.seller !== player) throw new ExchangeError('Only the seller may cancel this listing.', 403);
        if (action === 'buy' && listing.seller === player) throw new ExchangeError('You cannot buy your own listing.', 400);
        if (action === 'buy' && expectedPrice !== listing.price) throw new ExchangeError('The quoted price does not match. Refresh before buying.');
        // Missing currency is a legacy ryo quote, never consent to spend shards.
        if (action === 'buy' && parseCurrency(expectedCurrency) !== exchangeCurrency(listing)) throw new ExchangeError('The quoted currency does not match. Refresh before buying.');
        if (listing.state === 'sold' && listing.buyer === player && action === 'buy') return publicListing(listing);
        if (listing.state === 'cancelled' && action === 'cancel') return publicListing(listing);
        if (listing.state === 'buying' && listing.buyer !== player && action === 'buy') throw new ExchangeError('Another player is purchasing this listing.');
        if (pending(listing)) listing = await recoverLocked(listing);
        if (listing.state === 'sold' && listing.buyer === player && action === 'buy') return publicListing(listing);
        if (listing.state === 'cancelled' && action === 'cancel') return publicListing(listing);
        if (listing.state !== 'active') throw new ExchangeError('This listing is no longer available.');
        if (action === 'buy') await kv.hset(playerIndex(player), { [id]: listing.createdAt });
        listing = await transition(listing, action === 'buy' ? { state: 'buying', buyer: player } : { state: 'cancelling' });
        return publicListing(await recoverLocked(listing));
    }, { failClosed: true, ttlSec: 60 });
}

export async function exchangeSnapshot(player: string) {
    const history = await indexed(playerIndex(player));
    const recoveryErrors: string[] = [];
    for (const listing of history.filter(l => (pending(l) || l.saleNoticePending) && (l.seller === player || l.buyer === player))) {
        try {
            await withKvLock(exchangeListingKey(listing.id), async () => {
                const fresh = await kv.get<StoredExchangeListing>(exchangeListingKey(listing.id));
                if (fresh) await recoverLocked(fresh);
            }, { failClosed: true, ttlSec: 60 });
        } catch (error) { recoveryErrors.push(error instanceof ExchangeError ? error.message : 'A trade is still settling. Refresh to retry safely.'); }
    }
    const [live, mine, catalogs] = await Promise.all([indexed(LIVE_INDEX), indexed(playerIndex(player)), loadSettlementCatalogs()]);
    const out = await mutatePlayerSave(player, async ({ character, record }) => {
        // Browsing is a read. It persists something only when the Exchange's
        // own answer depends on work the stored save does not hold yet: a forged
        // definition recovered from the registry, or an elapsed settlement (a
        // finished barn, a pet-shape migration) that changes what can be listed.
        // Idle regen and the other projections every mutation applies are
        // re-derived by the next real write, so an unchanged browse no longer
        // rewrites the save or mints a new _saveVersion on every visit.
        // (`record` here carries only settled vitals, which the inventory never reads.)
        const recovered = await recoverExchangeDefinitions({ ...record, character });
        const creatorItems = objects(recovered.creatorItems);
        const write = !isDeepStrictEqual(creatorItems, objects(record.creatorItems))
            || !isDeepStrictEqual(exchangeInventory({ ...recovered, character }, catalogs), exchangeInventory(record, catalogs));
        return { ok: true, character, value: null, recordPatch: { creatorItems }, write };
    });
    if (!out.ok) throw new ExchangeError(out.error, out.status);
    // One record answers everything — the stored save at its stored version
    // when nothing needed persisting, the committed one otherwise — so the
    // character, inventory, definitions and version can never disagree.
    const record = out.record;
    const defenses = await Promise.all(['coliseum', 'tactical'].map(mode => kv.get<Obj>(`petladder:${mode}:def:${player}`)));
    const defenseIds = new Set(defenses.flatMap(defense => objects(defense?.pets).map(p => String(p.id))));
    return { listings: live.filter(l => l.state === 'active').map(publicListing),
        activity: mine.filter(l => l.seller === player || l.buyer === player).sort((a, b) => b.createdAt - a.createdAt).map(publicListing),
        inventory: exchangeInventory(record, catalogs).map(asset => asset.kind === 'pet' && defenseIds.has(asset.id) ? { ...asset, unavailable: 'Remove this companion from your ladder defense before listing it.' } : asset), character: record.character as Obj, _saveVersion: out._saveVersion,
        creatorItems: objects(record.creatorItems),
        recoveryErrors: [...new Set(recoveryErrors)] };
}

/** Invoked by the existing five-minute settlement scheduler, including boot.
 * Pending pointers are written before any money or ownership changes, so
 * recovery also completes when both traders have gone offline. */
export async function recoverPendingExchangeListings(limit = 50) {
    const refs = await kv.hgetall<Record<string, number>>(PENDING_INDEX) ?? {};
    const ids = Object.keys(refs).sort((a, b) => refs[a] - refs[b]).slice(0, limit);
    const result = { recovered: 0, failures: [] as string[] };
    for (const ref of ids) {
        const id = ref.split(':')[0];
        try {
            await withKvLock(exchangeListingKey(id), async () => {
                const listing = await kv.get<StoredExchangeListing>(exchangeListingKey(id));
                if (listing) {
                    const recovered = await recoverLocked(listing);
                    if (recovered.saleNoticePending) throw new Error('Sale completed; seller notification is awaiting delivery.');
                    if (ref !== (listing.recoveryKey ?? id)) await kv.hdel(PENDING_INDEX, ref);
                } else if (Date.now() - refs[ref] > 120_000) {
                    await kv.hdel(PENDING_INDEX, ref);
                    await kv.hdel(LIVE_INDEX, id);
                }
            }, { failClosed: true, ttlSec: 60 });
            result.recovered++;
        } catch (error) {
            result.failures.push(`${id}: ${error instanceof Error ? error.message : 'recovery pending'}`);
            // A full collection waiting for a return must not starve later trades.
            await kv.hset(PENDING_INDEX, { [ref]: Date.now() });
        }
    }
    return result;
}
