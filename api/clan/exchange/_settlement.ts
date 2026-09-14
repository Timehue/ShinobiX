import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {kv} from '../../_storage.js';
import {withKvLock} from '../../_lock.js';
import {clanBareSlug, clanRecordKey} from '../../_utils.js';
import {writeVersionedPlayerSave} from '../../save/_mutate-player-save.js';
import {beginDurableSettlement, completeDurableSettlement, getDurableSettlement, settlementFingerprint, settlementTransactionId} from '../../_durable-settlement.js';
import {buyClanExchangeItem, type ClanExchangeItemDef, type ClanExchangePurchaseSuccess} from '../_exchange.js';
import {clanExchangeIntentTime, CLAN_EXCHANGE_RECOVERY_MS, CLAN_EXCHANGE_RECEIPT_RETENTION_MS} from '../../../shared/clan-exchange-intent.js';

const FIELD = 'clanExchangeSettlements';
type DebitProof = {requestId: string; transactionId: string; fingerprint: string; proofToken: string; clanSlug: string; createdAt: number; item: ClanExchangeItemDef; purchaseCount: number; remaining: number};
type CreditProof = {transactionId: string; fingerprint: string; proofToken: string; createdAt: number; amount: number};
function proofs<T>(record: Record<string, unknown>): T[] {
    const raw = record[FIELD];
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.some(entry => !entry || typeof entry !== 'object'
        || typeof entry.transactionId !== 'string' || typeof entry.fingerprint !== 'string' || !Number.isFinite(entry.createdAt))) {
        throw new Error('Invalid Clan Exchange settlement evidence.');
    }
    return raw as T[];
}
function retain<T extends {createdAt: number}>(receipts: T[], now: number) {
    return receipts.filter(receipt => receipt.createdAt >= now - CLAN_EXCHANGE_RECEIPT_RETENTION_MS);
}
const failure = (status: number, error: string, code?: string) => ({ok: false as const, status, error, ...(code ? {code} : {})});

/** Two co-written proofs; a missing acknowledgement never authorizes a refund. */
export async function settleClanExchangeTreasury(args: {playerName: string; clan: string; itemId: string; requestId?: unknown}) {
    const clanKey = clanRecordKey(args.clan);
    const playerKey = `save:${args.playerName}`;
    const clanSlug = clanBareSlug(args.clan);
    return withKvLock(clanKey, () => withKvLock(playerKey, async () => {
        let [clan, player] = await Promise.all([kv.get<Record<string, unknown>>(clanKey), kv.get<Record<string, unknown>>(playerKey)]);
        if (!clan) return failure(404, 'Clan not found.');
        if (!player?.character || typeof player.character !== 'object') return failure(404, 'Player save not found.');
        let character = player.character as Record<string, unknown>;
        const debits = proofs<DebitProof>(character);
        let requestId = args.requestId;
        // Older clients still work. An unfinished matching debit is resumed;
        // a new click after completion remains a genuine purchase. Such clients
        // cannot identify a lost final response; updated clients send a stable ID.
        if (requestId === undefined) {
            for (const receipt of debits) {
                if (receipt.clanSlug !== clanSlug || receipt.item?.id !== args.itemId
                    || Date.now() > (clanExchangeIntentTime(receipt.requestId) ?? 0) + CLAN_EXCHANGE_RECOVERY_MS) continue;
                const tx = await getDurableSettlement(receipt.transactionId, {kv});
                if (tx?.state !== 'completed') { requestId = receipt.requestId; break; }
            }
            requestId ??= `cex-${Date.now()}-${randomUUID().replaceAll('-', '')}`;
        }
        const issuedAt = clanExchangeIntentTime(requestId);
        if (issuedAt === null || issuedAt > Date.now() + 60_000) return failure(400, 'Invalid purchase request.', 'INVALID_REQUEST_ID');
        if (Date.now() > issuedAt + CLAN_EXCHANGE_RECOVERY_MS) return failure(409, 'This purchase recovery window expired. No additional points were spent.', 'REQUEST_EXPIRED');
        const id = requestId as string;
        const transactionId = settlementTransactionId('clan-exchange', `${args.playerName}:${id}`);
        const fingerprint = settlementFingerprint({playerName: args.playerName, clanSlug, itemId: args.itemId});
        let debit = debits.find(receipt => receipt.requestId === id);
        if (debit && debit.fingerprint !== fingerprint) return failure(409, 'That purchase request belongs to a different item or clan.', 'INTENT_CONFLICT');
        let transaction = await getDurableSettlement(transactionId, {kv});
        if (transaction && transaction.fingerprint !== fingerprint) return failure(409, 'That purchase request belongs to a different item or clan.', 'INTENT_CONFLICT');
        const validateJournal = () => {
            if (!transaction || transaction.meta?.protocol !== 1
                || typeof transaction.meta.proofToken !== 'string' || !transaction.meta.proofToken
                || transaction.transactionId !== transactionId || transaction.operationType !== 'clan-exchange'
                || transaction.idempotencyKey !== `${args.playerName}:${id}`
                || transaction.meta.playerKey !== playerKey || transaction.meta.clanKey !== clanKey
                || !['pending', 'reconciliation-required', 'completed'].includes(transaction.state)) {
                throw new Error('Exchange server reservation is missing or conflicting.');
            }
            const item = transaction.meta.item as ClanExchangeItemDef | undefined;
            if (!item || item.id !== args.itemId || item.reward?.kind !== 'treasury'
                || transaction.amount !== item.cost || transaction.resource !== 'clanPoints'
                || !Number.isSafeInteger(item.cost) || item.cost <= 0
                || !Number.isSafeInteger(item.reward.amount) || item.reward.amount <= 0
                || item.reward.currency !== 'warSupply' || !Number.isFinite(transaction.meta.purchaseAt)) {
                throw new Error('Invalid sealed Exchange purchase.');
            }
            return {item, proofToken: transaction.meta.proofToken};
        };
        if (transaction) validateJournal();
        const credits = proofs<CreditProof>(clan);
        const applied = credits.find(receipt => receipt.transactionId === transactionId);
        if (!debit) {
            if (transaction?.state === 'completed') throw new Error('Completed Exchange transaction is missing its debit proof.');
            if (applied) throw new Error('Exchange treasury evidence is missing its debit proof.');
            if (clanBareSlug(String(character.clan ?? '')) !== clanSlug) return failure(403, 'You are not a member of this clan.');
            const quotedItem = transaction?.meta?.item as ClanExchangeItemDef | undefined;
            // Until the debit commits, there is no purchase allowance to retain.
            // Revalidate against today's period so an interrupted reservation
            // cannot strand the player's action on a now-full historical week.
            const at = Date.now();
            let purchase = buyClanExchangeItem({character, clanData: clan, itemId: args.itemId, now: new Date(at), definition: quotedItem});
            if (!purchase.ok) return failure(purchase.code === 'wrong-clan' || purchase.code === 'not-in-clan' ? 403 : 409, purchase.error);
            if (purchase.item.reward.kind !== 'treasury') throw new Error('Exchange treasury settlement received a different reward type.');
            const begun = await beginDurableSettlement({transactionId, idempotencyKey: `${args.playerName}:${id}`, operationType: 'clan-exchange',
                fingerprint, actorIds: [args.playerName, clanSlug], resource: 'clanPoints', amount: purchase.item.cost,
                meta: {protocol: 1, proofToken: randomUUID(), playerKey, clanKey, item: purchase.item, purchaseAt: at, recoveryExpiresAt: issuedAt + CLAN_EXCHANGE_RECOVERY_MS}}, {kv});
            if (begun.status === 'conflict') return failure(409, 'Conflicting purchase request.', 'INTENT_CONFLICT');
            transaction = begun.record;
            const {proofToken} = validateJournal();
            if (begun.status === 'existing') {
                purchase = buyClanExchangeItem({character, clanData: clan, itemId: args.itemId,
                    now: new Date(at), definition: transaction.meta?.item as ClanExchangeItemDef});
                if (!purchase.ok) return failure(409, purchase.error);
                if (purchase.item.reward.kind !== 'treasury') throw new Error('Invalid sealed treasury purchase.');
            }
            debit = {requestId: id, transactionId, fingerprint, proofToken, clanSlug, createdAt: Date.now(), item: purchase.item, purchaseCount: purchase.purchaseCount, remaining: purchase.remaining};
            const nextCharacter = {...purchase.character, [FIELD]: [debit, ...retain(debits, Date.now())]};
            try {
                player = (await writeVersionedPlayerSave(playerKey, player, nextCharacter)).record;
            } catch (error) {
                const saved = await kv.get<Record<string, unknown>>(playerKey).catch(() => null);
                const savedCharacter = saved?.character as Record<string, unknown> | undefined;
                const recovered = savedCharacter && proofs<DebitProof>(savedCharacter).find(row => row.transactionId === transactionId && row.fingerprint === fingerprint && row.proofToken === proofToken);
                if (!recovered) throw error;
                debit = recovered;
                player = saved!;
            }
            character = player.character as Record<string, unknown>;
        }
        // Reservation precedes every debit. Never manufacture authorization from
        // a generic-save field that could have been pre-seeded before protection.
        const {item: sealedItem, proofToken} = validateJournal();
        if (debit.transactionId !== transactionId || debit.clanSlug !== clanSlug || debit.proofToken !== proofToken
            || !isDeepStrictEqual(debit.item, sealedItem) || debit.item.reward.kind !== 'treasury') {
            throw new Error('Invalid Exchange debit reward evidence.');
        }
        const creditAmount = debit.item.reward.amount;
        if (applied && (applied.fingerprint !== fingerprint || applied.proofToken !== proofToken || applied.amount !== creditAmount)) throw new Error('Conflicting Exchange treasury credit evidence.');
        if (!applied) {
            const treasury = {...((clan.treasury ?? {}) as Record<string, unknown>)};
            const currency = debit.item.reward.currency;
            treasury[currency] = Math.max(0, Math.floor(Number(treasury[currency]) || 0)) + debit.item.reward.amount;
            const next = {...clan, treasury, [FIELD]: [{transactionId, fingerprint, proofToken, createdAt: Date.now(), amount: creditAmount}, ...retain(credits, Date.now())]};
            try {
                if (await kv.compareSet(clanKey, clan, next) !== true) throw new Error('Exchange clan save conflict.');
                clan = next;
            } catch (error) {
                const saved = await kv.get<Record<string, unknown>>(clanKey).catch(() => null);
                if (!saved || !proofs<CreditProof>(saved).some(row => row.transactionId === transactionId && row.fingerprint === fingerprint && row.proofToken === proofToken && row.amount === creditAmount)) throw error;
                clan = saved;
            }
        }
        if (transaction!.state !== 'completed') {
            await completeDurableSettlement(transactionId, {itemId:args.itemId, clan:args.clan, cost:debit.item.cost, reward:debit.item.reward, purchaseCount:debit.purchaseCount, remaining:debit.remaining}, {kv});
        }
        const result: ClanExchangePurchaseSuccess = {ok:true, character, clanData:clan, item:debit.item, purchaseCount:debit.purchaseCount, remaining:debit.remaining};
        return {ok:true as const, result, _saveVersion:Number(player._saveVersion ?? 0)};
    }, {failClosed:true}), {failClosed:true});
}
