import { DEFAULT_HALL, readHallStyle } from "../../shared/coast-hall-style.js";
/*
 * The Clan Landing: founding it, stocking it, raising it, and its upkeep.
 *
 * The rules are in _landing-rules.ts and the row in _landing-store.ts. This
 * file is what a request or the scheduler runs.
 *
 *   found       an officer stakes the plot on the sector the clan holds
 *   contribute  any member puts materials into the stores (save-debit saga)
 *   raise       an officer raises it a tier when the stores cover the cost
 *   upkeep      each week the stores pay; two unpaid weeks and the sector is lost
 *
 * Locks: see _landing-store.ts. Founding and a fall hold the land lock; a
 * contribution and a raise hold only the Landing key.
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { clanBareSlug, clanRecordKey, safeName } from '../_utils.js';
import { economyTxKey, type EconomyTxRecord } from '../_economy-tx.js';
import { COAST_LANDING_SAGA } from '../_save-debit-kinds.js';
import { runSaveDebitSaga, saveDebitTransactionId, SaveDebitRefusal } from '../_save-debit-saga.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { countOwned, removeOwned } from '../craft/_forge.js';
import { clanLeadershipRole } from '../clan/_leadership.js';
import { coastSectorName } from '../../shared/coast-world.js';
import { COAST_LAND, COAST_LAND_LOCK, coastClaimKey, coastClaimSupplyDue, liveCoastClaimOf, readCoastClaim, readCoastLandPause, releaseCoastClaim, settleDueCoastLand } from './_land.js';
import {
    COAST_LANDING, COAST_LANDING_MATERIALS, COAST_LANDING_MAX_TIER, COAST_LANDING_WORKS, buildCoastLandingWork, canRaiseCoastLanding,
    coastLandingMemberCap, coastLandingMemberUse, coastLandingShortfall, coastLandingTier, coastLandingUpkeep, coastLandingWork,
    coastLandingWorkBlock, coastLandingWorkShortfall, coastWeek,
    isCoastLandingMaterial, raiseCoastLandingTier, settleCoastLandingUpkeep,
    type CoastLanding, type CoastLandingContribution, coastTownFacilities,
} from './_landing-rules.js';
import { parseQuestLines } from '../quests/_record.js';
import { coastLandingKey, destroyCoastLanding, readCoastLanding } from './_landing-store.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';

/** What each Landing material is called, for the screen and for refusals. */
export const COAST_LANDING_MATERIAL_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
    COAST_LANDING_MATERIALS.map(itemId => [itemId, ITEM_CATALOG[itemId]?.name ?? itemId]),
);
const namedUnits = (units: Readonly<Record<string, number | undefined>>) => {
    const parts = Object.entries(units).map(([itemId, count]) => `${count} ${COAST_LANDING_MATERIAL_NAMES[itemId] ?? itemId}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join('');
};

type Refusal = { ok: false; status: number; error: string };
const refuse = (status: number, error: string): Refusal => ({ ok: false, status, error });
const lockOptions = { failClosed: true, maxAttempts: 10, baseBackoffMs: 30 } as const;
const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

type Member = {
    player: string; character: Record<string, unknown>; clan: string; clanSlug: string; record: Record<string, unknown>; officer: boolean;
    /** The quest lines this player has finished, read from their own save. */
    finished: ReadonlySet<string>;
};

/** The signed-in player as a member of their clan, read from their own save and the clan's record. */
async function memberOf(playerName: string): Promise<Member | null> {
    const player = safeName(playerName);
    const save = await kv.get<Record<string, unknown>>(`save:${player}`);
    const character = (save?.character ?? {}) as Record<string, unknown>;
    const clan = String(character.clan ?? '').trim();
    if (!clan) return null;
    const record = await kv.get<Record<string, unknown>>(clanRecordKey(clan));
    const members = Array.isArray(record?.members) ? record.members as Array<Record<string, unknown>> : [];
    if (!record || !members.some(member => safeName(String(member?.name ?? '')) === player)) return null;
    return {
        player, character, clan: String(record.name ?? clan), clanSlug: clanBareSlug(clan), record, officer: !!clanLeadershipRole(record, player),
        finished: new Set(Object.keys(parseQuestLines(save?.questLines).done)),
    };
}

// ── Found ────────────────────────────────────────────────────────────────────

export async function foundCoastLanding(input: { playerName: string; hallStyle?: unknown; now?: number }): Promise<{ ok: true; landing: CoastLanding } | Refusal> {
    const hallStyle = input.hallStyle === undefined ? DEFAULT_HALL : readHallStyle(input.hallStyle);
    if (!hallStyle) return refuse(400, 'Choose a listed hall design and banner dye.');
    const member = await memberOf(input.playerName);
    if (!member) return refuse(403, 'Only a clan can raise a Landing.');
    if (!member.officer) return refuse(403, "Only a clan's founder, leaders and officers can stake its Landing.");
    return withKvLock(COAST_LAND_LOCK, async () => {
        const now = input.now ?? Date.now();
        const claim = await liveCoastClaimOf(member.clan);
        if (!claim) return refuse(409, 'Your clan holds no ground on the coast. Take a sector first.');
        const key = coastLandingKey(member.clanSlug);
        return withKvLock(key, async () => {
            const prior = await kv.get<CoastLanding>(key);
            if (prior && prior.status !== 'destroyed' && prior.sector === claim.sector && prior.landingEpoch === claim.landingEpoch) {
                return refuse(409, 'Your clan has already staked its Landing here.');
            }
            const landing: CoastLanding = {
                clan: claim.clan, clanSlug: claim.clanSlug, generation: claim.generation, sector: claim.sector, landingEpoch: claim.landingEpoch,
                hallStyle, status: 'active', tier: 0, stores: {}, foundedAt: now, foundedBy: member.player, upkeepWeek: coastWeek(now), dormantWeeks: 0, contributions: {},
                // A fallen Landing's receipts are kept, so an old contribution retried now is still recognised.
                ...(prior?.settlementReceipts ? { settlementReceipts: prior.settlementReceipts } : {}),
            };
            await kv.set(key, landing);
            // Staking a Landing protects the holding while it is raised: once, however often it is refounded.
            if (!claim.graceGiven) {
                await kv.set(coastClaimKey(claim.sector), { ...claim, graceGiven: true, immuneUntil: Math.max(claim.immuneUntil, now + COAST_LAND.foundingGraceMs) });
            }
            return { ok: true as const, landing };
        }, lockOptions);
    }, lockOptions);
}

// ── Contribute ───────────────────────────────────────────────────────────────

/**
 * Put materials from the member's backpack into the Landing's stores. The debit
 * and the credit are two writes, so they run as a save-debit saga: retrying the
 * same request id finishes an interrupted contribution and never repeats one.
 * Throws SaveDebitRefusal for anything the player should be told.
 */
export async function contributeToCoastLanding(input: { playerName: string; itemId: unknown; count: unknown; requestId: unknown; now?: number }) {
    const player = safeName(input.playerName), now = input.now ?? Date.now();
    const requestId = parseSettlementRequestId(input.requestId), itemId = String(input.itemId ?? ''), count = Number(input.count);
    if (!requestId || !isCoastLandingMaterial(itemId) || !Number.isSafeInteger(count) || count < 1 || count > COAST_LANDING.perContribution) {
        throw new SaveDebitRefusal(400, `Choose 1 to ${COAST_LANDING.perContribution} of a material the Landing takes, and keep the request id.`);
    }
    // A retry names the Landing its first attempt was for, even if the member has changed clan since.
    const retained = await kv.get<EconomyTxRecord>(economyTxKey(saveDebitTransactionId(COAST_LANDING_SAGA.kind, player, requestId)));
    const clanSlug = retained ? String(retained.meta?.clanSlug ?? '') : (await memberOf(player))?.clanSlug ?? '';
    if (!clanSlug) throw new SaveDebitRefusal(403, 'Only a member of a clan can stock its Landing.');
    const week = coastWeek(now);

    const settled = await runSaveDebitSaga<Record<string, unknown>, CoastLandingContribution, Record<string, never>>({
        definition: COAST_LANDING_SAGA, playerName: player, requestId,
        identity: { clanSlug, itemId, count }, sharedKey: coastLandingKey(clanSlug), resource: `item:${itemId}`, amount: count, meta: { clanSlug },
        decide: ({ character, shared }) => {
            const landing = shared as unknown as CoastLanding | null;
            if (!landing || landing.status === 'destroyed') return { ok: false, status: 409, error: 'Your clan has no Landing standing. An officer must stake one first.' };
            if (clanBareSlug(String(character.clan ?? '')) !== landing.clanSlug) return { ok: false, status: 403, error: 'You are no longer in that clan.' };
            const used = coastLandingMemberUse(landing, player, week), cap = coastLandingMemberCap(landing);
            if (used + count > cap) {
                return { ok: false, status: 409, error: `That is more than you may give this week. You have ${Math.max(0, cap - used)} of ${cap} left.` };
            }
            // countOwned reads the backpack only, so nothing worn is ever given away.
            if (countOwned(character, itemId) < count) return { ok: false, status: 409, error: 'You do not hold that many.' };
            return { ok: true, character: removeOwned(character, itemId, count), plan: { name: player, itemId, count, week, landingEpoch: landing.landingEpoch }, result: {} };
        },
        messages: {
            pending: 'Your materials are recorded. Send the same contribution again to finish it.',
            refunded: 'The Landing could not be reached. Your materials were returned; give them again when ready.',
        },
    });
    return { landing: settled.shared as unknown as CoastLanding, character: settled.character, _saveVersion: settled._saveVersion, replayed: settled.replayed };
}

// ── Raise ────────────────────────────────────────────────────────────────────

export async function dressCoastHall(playerName: string, raw: unknown) {
    const hallStyle = readHallStyle(raw);
    if (!hallStyle) return refuse(400, 'Choose a listed hall design and banner dye.');
    const member = await memberOf(playerName);
    if (!member?.officer) return refuse(403, 'A clan officer chooses the hall appearance.');
    return withKvLock(COAST_LAND_LOCK, async () => {
        const key = coastLandingKey(member.clanSlug);
        return withKvLock(key, async () => {
            const landing = await kv.get<CoastLanding>(key);
            if (!landing || landing.status !== 'active') return refuse(409, 'Your clan needs an active Landing.');
            const claim = await readCoastClaim(landing.sector);
            if (claim?.clanSlug !== member.clanSlug || claim.landingEpoch !== landing.landingEpoch) return refuse(409, 'Your clan no longer holds that ground.');
            const next = { ...landing, hallStyle };
            if (!(await kv.compareSet(key, landing, next))) return refuse(409, 'The Landing changed. Try again.');
            return { ok: true as const, landing: next };
        }, lockOptions);
    }, lockOptions);
}

export async function raiseCoastLanding(input: { playerName: string }): Promise<{ ok: true; landing: CoastLanding } | Refusal> {
    const member = await memberOf(input.playerName);
    if (!member) return refuse(403, 'Only a clan can raise a Landing.');
    if (!member.officer) return refuse(403, "Only a clan's founder, leaders and officers can raise its Landing.");
    const key = coastLandingKey(member.clanSlug);
    return withKvLock(key, async () => {
        const landing = await kv.get<CoastLanding>(key);
        if (!landing || landing.status === 'destroyed') return refuse(409, 'Your clan has no Landing standing.');
        if (landing.status === 'dormant') return refuse(409, 'The Landing is dormant. Stock its stores so it can pay its upkeep first.');
        if (landing.tier >= COAST_LANDING_MAX_TIER) return refuse(409, 'The Landing stands as tall as it can.');
        // Built only on ground the clan still holds, under the same epoch.
        const claim = await readCoastClaim(landing.sector);
        if (!claim || claim.clanSlug !== landing.clanSlug || claim.landingEpoch !== landing.landingEpoch) return refuse(409, 'Your clan no longer holds that ground.');
        if (!canRaiseCoastLanding(landing)) {
            const next = coastLandingTier(landing.tier + 1);
            return refuse(409, `The ${next.name} still needs ${namedUnits(coastLandingShortfall(landing))} in the stores.`);
        }
        const raised = raiseCoastLandingTier(landing);
        if (!(await kv.compareSet(key, landing, raised))) return refuse(409, 'The Landing changed. Try again.');
        return { ok: true as const, landing: raised };
    }, lockOptions);
}

// ── Build a work ─────────────────────────────────────────────────────────────

/**
 * Build one of the Landing's works (COAST_LANDING_WORKS) from its stores. An
 * officer does it, and only one who has finished the quest that opens that
 * work: the quest is read from the officer's own save, never from the request.
 */
export async function buildCoastLandingWorkFor(input: { playerName: string; workId: unknown }): Promise<{ ok: true; landing: CoastLanding } | Refusal> {
    const work = coastLandingWork(input.workId);
    if (!work) return refuse(400, 'That is not something a Landing can build.');
    const member = await memberOf(input.playerName);
    if (!member) return refuse(403, 'Only a clan can build on a Landing.');
    if (!member.officer) return refuse(403, "Only a clan's founder, leaders and officers can build on its Landing.");
    if (!member.finished.has(work.quest)) return refuse(403, `Finish ${work.questTitle} first. It teaches how the ${work.name} is built.`);
    const key = coastLandingKey(member.clanSlug);
    return withKvLock(key, async () => {
        const landing = await kv.get<CoastLanding>(key);
        if (!landing) return refuse(409, 'Your clan has no Landing standing.');
        const block = coastLandingWorkBlock(landing, work);
        if (block === 'fallen') return refuse(409, 'Your clan has no Landing standing.');
        if (block === 'dormant') return refuse(409, 'The Landing is dormant. Stock its stores so it can pay its upkeep first.');
        if (block === 'built') return refuse(409, `The ${work.name} already stands.`);
        if (block === 'tier') return refuse(409, `The ${work.name} needs a ${coastLandingTier(work.minTier).name}.`);
        if (block === 'stores') return refuse(409, `The ${work.name} still needs ${namedUnits(coastLandingWorkShortfall(landing, work))} in the stores.`);
        // Built only on ground the clan still holds, under the same epoch.
        const claim = await readCoastClaim(landing.sector);
        if (!claim || claim.clanSlug !== landing.clanSlug || claim.landingEpoch !== landing.landingEpoch) return refuse(409, 'Your clan no longer holds that ground.');
        const built = buildCoastLandingWork(landing, work);
        if (!(await kv.compareSet(key, landing, built))) return refuse(409, 'The Landing changed. Try again.');
        return { ok: true as const, landing: built };
    }, lockOptions);
}

// ── An admin puts a Landing back ─────────────────────────────────────────────

/**
 * Stand a fallen Landing up again as it was, on the ground the clan holds now.
 * For a Landing lost to a fault, not to a contest: its tier, stores and works
 * come back, bound to the clan's present claim. It refuses when the clan holds
 * no ground, because a Landing stands on a sector. The route audits every use.
 */
export async function restoreCoastLanding(clanName: string, now = Date.now()): Promise<{ ok: true; landing: CoastLanding } | Refusal> {
    const clanSlug = clanBareSlug(clanName);
    if (!clanSlug) return refuse(400, 'Name the clan.');
    return withKvLock(COAST_LAND_LOCK, async () => {
        const claim = await liveCoastClaimOf(clanName);
        if (!claim) return refuse(409, 'That clan holds no ground on the coast. Grant it a sector first.');
        const key = coastLandingKey(clanSlug);
        return withKvLock(key, async () => {
            const landing = await kv.get<CoastLanding>(key);
            if (!landing) return refuse(404, 'That clan has never staked a Landing.');
            if (landing.status !== 'destroyed') return refuse(409, 'That clan’s Landing is standing.');
            // A clan's name can be used again after it is gone. The fallen row is
            // kept under the name, so it is given back only to the same clan.
            if (landing.generation !== claim.generation) return refuse(409, 'That Landing belonged to an earlier clan of the same name. It cannot be given to this one.');
            const { destroyedAt: _at, destroyedReason: _reason, lost, ...rest } = landing; void _at; void _reason;
            const restored: CoastLanding = {
                ...rest, status: 'active', sector: claim.sector, landingEpoch: claim.landingEpoch, generation: claim.generation,
                // A row that fell before this was kept comes back as a staked plot.
                tier: lost?.tier ?? 0, stores: lost?.stores ?? {}, works: lost?.works ?? [],
                // This week counts as settled, so it cannot fall straight back; upkeep is asked again next week.
                upkeepWeek: coastWeek(now), dormantWeeks: 0,
            };
            await kv.set(key, restored);
            return { ok: true as const, landing: restored };
        }, lockOptions);
    }, lockOptions);
}

// ── What a member is shown ───────────────────────────────────────────────────

/** Why a Landing fell, said plainly. The stored word is for the audit log, not for a player. */
const FALLEN_SENTENCES: Readonly<Record<string, string>> = {
    'sector-taken': 'Another clan took the ground it stood on.',
    'ground-lost': 'Your clan no longer held the ground it stood on.',
    'upkeep-unpaid': 'Its upkeep went unpaid for two weeks.',
    'clan-gone': 'The clan that raised it was gone.',
};
function fallenSentence(reason: string | undefined): string {
    return (reason && Object.hasOwn(FALLEN_SENTENCES, reason) ? FALLEN_SENTENCES[reason] : null) ?? 'The ground it stood on was given up.';
}

export async function coastLandingView(playerName: string, now = Date.now()) {
    const member = await memberOf(playerName);
    if (!member) return { clan: null, landing: null, canFound: false };
    const [landing, claim] = await Promise.all([readCoastLanding(member.clanSlug), liveCoastClaimOf(member.clan)]);
    const standing = landing && landing.status !== 'destroyed' ? landing : null;
    const week = coastWeek(now);
    const next = standing && standing.tier < COAST_LANDING_MAX_TIER ? coastLandingTier(standing.tier + 1) : null;
    return {
        clan: member.clan,
        officer: member.officer,
        // `supply` is the War Supply the sector has produced and the clan has not collected yet (whole days only).
        holds: claim ? { sector: claim.sector, name: coastSectorName(claim.sector) ?? `Sector ${claim.sector}`, supply: coastClaimSupplyDue(claim, now).supply } : null,
        canFound: member.officer && !!claim && !(standing && standing.sector === claim.sector && standing.landingEpoch === claim.landingEpoch),
        landing: standing ? {
            sector: standing.sector, status: standing.status, tier: standing.tier, name: coastLandingTier(standing.tier).name,
            // The clan town: which village facilities this Landing offers its members now (_landing-rules.ts).
            hallStyle: standing.hallStyle ?? DEFAULT_HALL,
            town: coastTownFacilities(standing),
            stores: Object.fromEntries(COAST_LANDING_MATERIALS.map(itemId => [itemId, whole(standing.stores[itemId])])),
            next: next ? { tier: next.tier, name: next.name, cost: next.cost, ready: canRaiseCoastLanding(standing) } : null,
            upkeep: { perWeek: coastLandingUpkeep(standing), dormantWeeks: standing.dormantWeeks, graceUntil: standing.foundedAt + COAST_LANDING.graceMs },
            thisWeek: standing.contributions[String(week)] ?? {},
            yours: { used: coastLandingMemberUse(standing, member.player, week), cap: coastLandingMemberCap(standing) },
            // Every work, built or not, with what stands between this Landing and it.
            // `canBuild` is for this player: an officer who has finished its quest.
            works: COAST_LANDING_WORKS.map(work => {
                const block = coastLandingWorkBlock(standing, work);
                return {
                    id: work.id, name: work.name, does: work.does, built: block === 'built',
                    quest: work.questTitle, needsTier: coastLandingTier(work.minTier).name, cost: work.cost,
                    block, canBuild: block === null && member.officer && member.finished.has(work.quest),
                    ...(block !== 'built' && !member.finished.has(work.quest) ? { needsQuest: true } : {}),
                };
            }),
        } : null,
        // The last Landing the clan lost, so the Hall can say what happened to it.
        // `reason` is a sentence the screen can print as it is; `cause` is the stored word.
        fallen: landing?.status === 'destroyed'
            ? { sector: landing.sector, at: landing.destroyedAt ?? 0, reason: fallenSentence(landing.destroyedReason), cause: landing.destroyedReason ?? '' }
            : null,
    };
}

// ── The scheduled pass ───────────────────────────────────────────────────────

/**
 * Settle upkeep for every Landing, and bring down any whose ground is no
 * longer its clan's (a guard: losing a claim already does this). A Landing
 * that has gone unpaid too long loses its sector to the Unmoored.
 */
export async function settleCoastLandings(now = Date.now()): Promise<{ dormant: string[]; fallen: string[] }> {
    const week = coastWeek(now), dormant: string[] = [], fallen: string[] = [];
    // While an admin has the contests paused, no Landing is charged upkeep and
    // none falls. A pause is for an incident, and a clan should not lose its
    // base to one. Weeks that pass under a pause are not charged afterwards.
    if (await readCoastLandPause()) return { dormant, fallen };
    for (const key of await kv.keys('coast:landing:*')) {
        const clanSlug = key.slice('coast:landing:'.length);
        const outcome = await withKvLock(key, async () => {
            const landing = await kv.get<CoastLanding>(key);
            if (!landing || landing.status === 'destroyed') return null;
            const settled = settleCoastLandingUpkeep(landing, week, now);
            if (settled.landing !== landing) await kv.set(key, settled.landing);
            return { landing: settled.landing, fell: settled.fell };
        }, lockOptions);
        if (!outcome) continue;
        const { landing } = outcome;
        const claim = await readCoastClaim(landing.sector);
        const held = !!claim && claim.clanSlug === landing.clanSlug && claim.landingEpoch === landing.landingEpoch;
        if (!held) { await destroyCoastLanding(landing, 'ground-lost', now); fallen.push(clanSlug); continue; }
        if (outcome.fell) {
            // Unpaid too long: the sector goes back to the Unmoored, and the Landing falls with it.
            await releaseCoastClaim(landing.sector, 'upkeep-unpaid', { clanSlug: landing.clanSlug, landingEpoch: landing.landingEpoch });
            fallen.push(clanSlug);
        } else if (landing.status === 'dormant') dormant.push(clanSlug);
    }
    return { dormant, fallen };
}

/** Everything the coast's five-minute tick does: land first, then the Landings standing on it. */
export async function runCoastLandTick(now = Date.now()) {
    const land = await settleDueCoastLand(now);
    const landings = await settleCoastLandings(now);
    return { ...land, ...landings };
}
