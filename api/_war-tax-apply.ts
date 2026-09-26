/*
 * Village War Map — the village tax, IO call-site (§6.4 / §8.2).
 *
 * The pure math has existed in `_war-tax.ts` since Phase 1 with NO importer, so
 * the tax was never actually collected — while the War Map screen displayed a
 * live tax rate to players. This is the wiring that makes the displayed rate real.
 *
 * WHY AN ENDPOINT AND NOT A CRON OR THE SAVE PATH:
 *   - A cron would write every player's save every day (the write-storm §8.2
 *     explicitly rules out).
 *   - Ryo is CLIENT-OWNED in the save ledger, so a silent server-side debit would
 *     simply be re-asserted by the player's next autosave. A currency change has
 *     to come back in a response the client adopts — the same contract
 *     /api/player/daily-login and /api/village/claim-daily-agenda already use.
 * So the debit is lazy and idempotent: it runs at most once per UTC day per
 * player, keyed on the server-owned `character.lastTaxDate` stamp read INSIDE the
 * save lock.
 *
 * Rate: taxRateForSectors(sectors the player's village actually holds) × the
 * village's Treasury-Vault discount — the identical inputs api/_war-map-view.ts
 * shows on the War Map, so the rate charged always matches the rate displayed.
 *
 * Split: TAX_BURN_SHARE is destroyed (the actual anti-inflation sink) and the rest
 * is credited to the village treasury.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

import { villageWarMapEnabled } from './_release-flags.js';

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { bumpSaveVersion } from './save/_save-version.js';
import { applyPlayerTax, type PlayerTaxOutcome } from './_war-tax.js';
import { heldSectorsForVillage } from './_war-held-sectors.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug } from './_war-state.js';
import { taxRateMultiplier } from './_war-structures.js';
import { isWarVillage } from './_war-map-sectors.js';
import { kageKey } from './village/_kage-settle.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import {
    runSaveDebitSaga,
    saveDebitTransactionId,
    SaveDebitRefusal,
    type SaveDebitDecision,
    type SaveDebitSagaOutcome,
} from './_save-debit-saga.js';
import { VILLAGE_TAX_SAGA, type VillageTaxPlan } from './_save-debit-kinds.js';
import { economyTxKey, type EconomyTxRecord } from './_economy-tx.js';

const VILLAGE_STATE_PREFIX = 'game:village-state:';

/**
 * Is a player currently seated as this village's Kage?
 *
 * Reads the AUTHORITATIVE `village:kage:<slug>` row, not the lagging
 * `game:village-state` mirror — same rule world-state.ts isSeatedKageOf follows,
 * and every other Kage power already reads.
 *
 * NO KAGE, NO TAX: the tax is the cost of being governed. Half of it funds the
 * village treasury, which only a seated Kage can spend (structures, war
 * declarations, mercenaries), so charging it while the seat is empty would take
 * ryo from players for a war chest nobody can use. A leaderless village pays
 * nothing until someone takes the seat.
 *
 * This is not a loophole worth farming: an unseated village also cannot declare a
 * village war or a sector war, set terrain or win-conditions, upgrade a structure,
 * or hire a mercenary — every one of those is Kage-gated. Dodging the tax means
 * forfeiting the entire war toolkit.
 */
export async function isVillageKageSeated(village: string): Promise<boolean> {
    try {
        const row = await kv.get<{ seatedKage?: string }>(kageKey(village));
        return !!String(row?.seatedKage ?? '').trim();
    } catch {
        // Fail SAFE for the player: if the seat cannot be read, do not charge.
        return false;
    }
}

/** Village tax is ON by default; `DISABLE_VILLAGE_TAX=1` is the kill switch.
 *  Safe to ship on: every village starts holding its full 8 home sectors, which
 *  is the 0% tier. The occupation tax begins only when it holds a ninth sector,
 *  putting bounded upkeep on conquest without punishing the losing village. It rides
 *  the Sector Map campaign, so the whole system's kill switch disables it too. */
export function villageTaxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return villageWarMapEnabled(env) && env.DISABLE_VILLAGE_TAX !== '1';
}

export function utcDateString(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

export interface VillageTaxResult {
    /** false when the feature is off, the player has no war village, or nothing was due. */
    applied: boolean;
    taxed: number;          // ryo actually debited
    toBurn: number;
    toTreasury: number;
    rateSectors: number;    // sectors the village held (what set the tier)
    /** false when the village has no seated Kage — the rate is forced to 0. */
    kageSeated: boolean;
    ryo: number;            // balances AFTER the debit — the client adopts these
    bankRyo: number;
    /** The save version this debit produced, so the caller can echo it straight
     *  back to the client instead of re-reading the record. */
    _saveVersion?: number;
}

const NOT_APPLIED = (ryo = 0, bankRyo = 0, kageSeated = false): VillageTaxResult =>
    ({ applied: false, taxed: 0, toBurn: 0, toTreasury: 0, rateSectors: 0, kageSeated, ryo, bankRyo });

/** One tax per player per village per UTC day: the saga's request id. */
export function villageTaxRequestId(village: string, today: string): string {
    return `village-tax-${villageWarSlug(village)}-${today}`;
}

/**
 * The debit of a day with a treasury share, and the credit, as one retry-safe
 * settlement (api/_save-debit-saga.ts): the debit and its receipt are one save
 * write, the credit and its receipt one write of the village row under its
 * lock, and a journal outlives both. Returns null when the saga refused, which
 * a tax treats as "nothing applied".
 */
async function settleTaxWithTreasuryShare(input: {
    name: string;
    village: string;
    today: string;
    amount: number;
    decide: (character: Record<string, unknown>) => SaveDebitDecision<VillageTaxPlan, PlayerTaxOutcome>;
}): Promise<SaveDebitSagaOutcome<Record<string, unknown>, VillageTaxPlan, PlayerTaxOutcome> | null> {
    try {
        return await runSaveDebitSaga<Record<string, unknown>, VillageTaxPlan, PlayerTaxOutcome>({
            definition: VILLAGE_TAX_SAGA,
            playerName: input.name,
            requestId: villageTaxRequestId(input.village, input.today),
            identity: { village: villageWarSlug(input.village), day: input.today },
            sharedKey: `${VILLAGE_STATE_PREFIX}${villageWarSlug(input.village)}`,
            resource: 'ryo',
            amount: input.amount,
            meta: { village: input.village, day: input.today },
            decide: ({ character }) => input.decide(character),
        });
    } catch (err) {
        if (err instanceof SaveDebitRefusal && err.status === 409 && !err.details.reconcile) return null;
        throw err;
    }
}

/**
 * A tax whose debit landed but whose treasury credit did not finish (the
 * process stopped, or the village row was unwritable) is finished by the
 * player's next assessment the same day: the saga finds the debit's receipt
 * and rolls the credit forward exactly once. One read when nothing is pending.
 */
async function finishPendingTaxCredit(name: string, village: string, today: string): Promise<void> {
    if (!isWarVillage(village)) return;
    const txId = saveDebitTransactionId(VILLAGE_TAX_SAGA.kind, name, villageTaxRequestId(village, today));
    const journal = await kv.get<EconomyTxRecord>(economyTxKey(txId));
    if (!journal || journal.state === 'complete' || journal.state === 'refunded') return;
    await settleTaxWithTreasuryShare({
        name, village, today, amount: journal.amount,
        // Only a missing debit receipt reaches this, and the day is already
        // stamped: nothing new is charged.
        decide: () => ({ ok: false, status: 409, error: 'Already taxed today.' }),
    });
}

/**
 * Assess and collect the day's tax for one player.
 *
 * Safe to call on every session start: the same-day stamp makes a repeat call a
 * no-op that does not even write. Never throws — a tax failure must never block
 * whatever the caller was actually doing.
 */
export async function assessVillageTax(playerName: string, now: number = Date.now()): Promise<VillageTaxResult> {
    if (!villageTaxEnabled()) return NOT_APPLIED();
    const name = String(playerName ?? '').trim().toLowerCase();
    if (!name) return NOT_APPLIED();

    try {
        const saveKey = `save:${name}`;
        // Cheap pre-check OUTSIDE the lock: the overwhelmingly common case is
        // "already taxed today", and that must cost one read and no lock.
        const peek = await kv.get<{ character?: Record<string, unknown> }>(saveKey);
        const peekChar = peek?.character;
        if (!peekChar) return NOT_APPLIED();
        const today = utcDateString(now);
        const village = String(peekChar.village ?? '').trim();
        if (String(peekChar.lastTaxDate ?? '') === today) {
            await finishPendingTaxCredit(name, village, today);
            return NOT_APPLIED(Number(peekChar.ryo) || 0, Number(peekChar.bankRyo) || 0);
        }
        if (!isWarVillage(village)) return NOT_APPLIED(Number(peekChar.ryo) || 0, Number(peekChar.bankRyo) || 0);

        // Village-scoped inputs, read once before taking the save lock.
        const [sectorsControlled, warRaw, kageSeated] = await Promise.all([
            heldSectorsForVillage(village),
            kv.get<Record<string, unknown>>(villageWarKey(village)),
            isVillageKageSeated(village),
        ]);
        const record = normalizeVillageWarRecord(village, warRaw ?? undefined);
        // No seated Kage forces the rate to zero. applyPlayerTax still STAMPS the
        // day, so a leaderless stretch accrues no arrears the village gets billed
        // for the moment someone finally takes the seat.
        const rateMultiplier = kageSeated ? taxRateMultiplier(record) : 0;
        const assess = (char: Record<string, unknown>) => applyPlayerTax(
            {
                ryo: Number(char.ryo) || 0,
                bankRyo: Number(char.bankRyo) || 0,
                level: Number(char.level) || 0,
                lastTaxDate: String(char.lastTaxDate ?? ''),
            },
            { sectorsControlled, today, rateMultiplier },
        );

        let outcome: PlayerTaxOutcome | null;
        let savedVersion: number | undefined;
        const peekAssessment = assess(peekChar);
        if (peekAssessment.toTreasury > 0) {
            // A treasury share moves ryo into the village row, so the debit and
            // the credit settle together, exactly once, under the village-row
            // lock (village row first, then the save, like village donations).
            // The credit used to be a best-effort write after the debit: a
            // failure lost the share, and on lock contention it ran UNLOCKED
            // and could overwrite another writer's change to the village row.
            const settled = await settleTaxWithTreasuryShare({
                name, village, today, amount: peekAssessment.toTreasury,
                decide: (character) => {
                    if (String(character.village ?? '').trim() !== village) return { ok: false, status: 409, error: 'The player changed village.' };
                    if (String(character.lastTaxDate ?? '') === today) return { ok: false, status: 409, error: 'Already taxed today.' };
                    const applied = assess(character);
                    if (applied.noWrite) return { ok: false, status: 409, error: 'Nothing is due.' };
                    return {
                        ok: true,
                        character: { ...character, ryo: applied.nextRyo, bankRyo: applied.nextBankRyo, lastTaxDate: applied.nextLastTaxDate },
                        plan: { toTreasury: applied.toTreasury },
                        result: applied,
                    };
                },
            });
            // Refused, or an identical assessment already settled it: nothing
            // was charged by this call.
            if (!settled || settled.replayed || settled.resumed) {
                const current = settled?.character ?? peekChar;
                return NOT_APPLIED(Number(current.ryo) || 0, Number(current.bankRyo) || 0, kageSeated);
            }
            outcome = settled.result;
            savedVersion = settled._saveVersion || undefined;
        } else {
            // No treasury share: the stamp (and any burn) is a save write alone.
            // Currency path → failClosed, and the date stamp is re-read inside
            // the lock so two concurrent calls can't both debit.
            outcome = await withKvLock(saveKey, async (): Promise<PlayerTaxOutcome | null> => {
                const rec = await kv.get<Record<string, unknown>>(saveKey);
                const char = (rec?.character ?? null) as Record<string, unknown> | null;
                if (!rec || !char) return null;
                if (String(char.lastTaxDate ?? '') === today) return null; // raced — already taxed

                const applied = assess(char);
                if (applied.noWrite) return applied;
                // The balance rose between the unlocked read and now, so this
                // day does have a treasury share after all. It needs the
                // settlement above; leave the day unstamped for the next call.
                if (applied.toTreasury > 0) return null;

                const next: Record<string, unknown> = bumpSaveVersion({
                    ...rec,
                    character: {
                        ...char,
                        ryo: applied.nextRyo,
                        bankRyo: applied.nextBankRyo,
                        lastTaxDate: applied.nextLastTaxDate,
                    },
                });
                await kv.set(saveKey, next);
                savedVersion = Number(next._saveVersion) || undefined;
                return applied;
            }, { failClosed: true });
        }

        if (!outcome) return NOT_APPLIED(Number(peekChar.ryo) || 0, Number(peekChar.bankRyo) || 0, kageSeated);

        if (outcome.taxed) {
            const eventId = `tax:${villageWarSlug(village)}:${name}:${today}`;
            void recordWarEcoEvent({ eventId, village, kind: 'tax.collect', amount: outcome.fromWallet + outcome.fromBank, ts: now, meta: name });
            if (outcome.toBurn > 0) void recordWarEcoEvent({ eventId: `${eventId}:burn`, village, kind: 'tax.burn', amount: outcome.toBurn, ts: now });
            if (outcome.toTreasury > 0) void recordWarEcoEvent({ eventId: `${eventId}:treasury`, village, kind: 'tax.treasury', amount: outcome.toTreasury, ts: now });
        }

        return {
            applied: outcome.taxed,
            taxed: outcome.fromWallet + outcome.fromBank,
            toBurn: outcome.toBurn,
            toTreasury: outcome.toTreasury,
            rateSectors: sectorsControlled,
            kageSeated,
            ryo: outcome.nextRyo,
            bankRyo: outcome.nextBankRyo,
            _saveVersion: savedVersion,
        };
    } catch (err) {
        console.error('[village-tax] assessment failed for', name, (err as Error).message);
        return NOT_APPLIED();
    }
}
