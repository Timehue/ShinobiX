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
        if (String(peekChar.lastTaxDate ?? '') === today) {
            return NOT_APPLIED(Number(peekChar.ryo) || 0, Number(peekChar.bankRyo) || 0);
        }
        const village = String(peekChar.village ?? '').trim();
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

        // Currency path → failClosed, and the date stamp is re-read inside the lock
        // so two concurrent calls can't both debit.
        let savedVersion: number | undefined;
        const outcome = await withKvLock(saveKey, async (): Promise<PlayerTaxOutcome | null> => {
            const rec = await kv.get<Record<string, unknown>>(saveKey);
            const char = (rec?.character ?? null) as Record<string, unknown> | null;
            if (!rec || !char) return null;
            if (String(char.lastTaxDate ?? '') === today) return null; // raced — already taxed

            const applied = applyPlayerTax(
                {
                    ryo: Number(char.ryo) || 0,
                    bankRyo: Number(char.bankRyo) || 0,
                    level: Number(char.level) || 0,
                    lastTaxDate: String(char.lastTaxDate ?? ''),
                },
                { sectorsControlled, today, rateMultiplier },
            );
            if (applied.noWrite) return applied;

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

        if (!outcome) return NOT_APPLIED(Number(peekChar.ryo) || 0, Number(peekChar.bankRyo) || 0, kageSeated);

        // Credit the village treasury with its half. Separate lock, taken AFTER the
        // save lock is released (order save → village-state, and nothing takes them
        // the other way round). Best-effort: the player's debit already committed,
        // and losing the credit must not double-charge them on a retry.
        if (outcome.toTreasury > 0) {
            const stateKey = `${VILLAGE_STATE_PREFIX}${villageWarSlug(village)}`;
            try {
                await withKvLock(stateKey, async () => {
                    const state = (await kv.get<Record<string, unknown>>(stateKey)) ?? {};
                    const treasury = (state.treasury ?? {}) as Record<string, unknown>;
                    await kv.set(stateKey, {
                        ...state,
                        treasury: { ...treasury, ryo: (Number(treasury.ryo) || 0) + outcome.toTreasury },
                    });
                });
            } catch (err) {
                console.error('[village-tax] treasury credit failed for', village, (err as Error).message);
            }
        }

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
