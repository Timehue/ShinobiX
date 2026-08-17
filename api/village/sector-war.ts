import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { isWarVillage } from '../_war-map-sectors.js';
import { heldSectorsForVillage } from '../_war-held-sectors.js';
import {
    normalizeVillageWarRecord,
    villageWarKey,
    type WinCondition,
} from '../_war-state.js';
import { defenderPointsMultiplier, sectorWarDamageMultiplier } from '../_war-structures.js';
import { sealedSectorWarRoleOf, sectorControlSwing } from '../_war-role.js';
import { villageWarMapEnabled } from '../_release-flags.js';
import {
    sectorWarId,
    sectorWarKey,
    projectSectorWarForClient,
    newSectorWarSession,
    normalizeSectorWarSession,
    applySectorWarBattle,
    findSectorWarBattleReceipt,
    recordSectorWarBattleOutcome,
    canDeclareSectorWar,
    newSectorWarBattleToken,
    sectorDeclareLockKey,
    isSectorWarActive,
    MAX_ACTIVE_ATTACK_SIEGES,
    SECTOR_RESIEGE_COOLDOWN_SEC,
    abandonSectorWar,
    type SectorWarDeclineReason,
    type SectorWarSession,
} from '../_sector-war.js';
import {
    loadSectorWar,
    saveSectorWar,
    activeContestOnSector,
    listActiveSectorWars,
    listFundingSectorWars,
    listUnsettledDueSectorWars,
    mintSectorWarToken,
    loadSectorWarToken,
    loadSectorWarResolutionReceipt,
    commitSectorWarResolutionReceipt,
    findSectorWarAppliedBattle,
    getSectorOwnerVillage,
    activeSectorWarsForVillage,
} from '../_sector-war-store.js';
import type { SectorWarResolutionReceipt } from '../_sector-war-store.js';
import { villageHasActiveWar, seedHomeSectorOwnership } from '../world-state.js';
import {
    WAR_DECLARATION_FUNDING_FIELD,
    abortWarDeclarationFunding,
    newWarDeclarationFundingOwnerId,
    reserveWarDeclarationFunding,
    warDeclarationFundingFingerprint,
    warDeclarationFundingMarkerFromRow,
    type WarDeclarationFundingPlan,
    type WarDeclarationFundingSource,
} from '../_war-declaration-funding.js';
import { settleReservedSectorWarDeclarationFunding } from '../_sector-war-declaration-funding.js';
import {
    claimVillageWarReservations,
    normalizedWarVillage,
    releaseVillageWarReservations,
    reserveClaimedVillageWarReservations,
    type VillageWarReservationPlan,
} from '../_war-village-reservation.js';
import { settleDueSectorWars } from '../_sector-war-settle.js';
import { recordWarEcoEvent } from '../_war-telemetry.js';
import { legacyEnabled, bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';
import { pvpSessionMayGrantProgress, type PvpSession } from '../pvp/session.js';
import { loadPvpRewardRecoverySnapshot } from '../pvp/_reward-recovery.js';
import { pvpSessionPublicationTombstoneFor } from '../pvp/_session-publication-tombstone.js';
import { SESSION_TTL } from '../combat-core/constants.js';
import { settlePvpSectorWarContinuation } from '../pvp/_sector-war-continuation.js';

/*
 * /api/village/sector-war — POST only. The sector-war battle-wiring (Phase 4c).
 *
 * Actions (body.action):
 *   - declare : the seated Kage opens a sector war on an enemy-held sector — debits
 *               250 WR (× comeback discount) from the attacking village's WR pool and
 *               opens the Control-HP siege. Mutually exclusive with a village war.
 *   - attack  : after the launcher fights the sector's defender through the existing
 *               sector-attack → PvP flow, this mints a SINGLE-USE token sealing the
 *               contest context for the resulting pvp:<battleId>.
 *   - resolve : reads the AUTHORITATIVE finished pvp:<battleId> (never a client claim),
 *               applies the win/loss to Control HP (War-Academy-boosted), and on
 *               capture flips world:territory:<sector>.ownerVillage to the attacker.
 *   - garrison: retired. Sector Combat belongs to the PvP runtime; until that
 *               owner provides a headless adapter, the former Tower-backed AI
 *               assault fails closed without touching contest or reward state.
 *   - abandon : the attacking Kage calls off their own siege.
 *   - status  : read-only — the owner + active contest for a sector (or all contests).
 *   - seed    : admin — one-time idempotent seed of home-sector ownership (Phase 4d).
 *
 * Server-gated: 404 when the default-on Sector Map campaign is disabled. Combat
 * battles run here (attack/resolve); Card battles run via /village/sector-card and
 * Pet duels via /village/sector-pet — all three settle the same contest Control HP
 * server-authoritatively. A client-claimed result never flips territory.
 */

// Win-conditions whose server-authoritative battle path is wired this build:
// Combat here, Card via /village/sector-card, Pet via /village/sector-pet (the
// deterministic pet engine ported to api/pet-sim, Phase 7).
const WIRED_WIN_CONDITIONS: readonly WinCondition[] = ['combat', 'card', 'pet'];

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;
type ReadBattle = PvpSession;

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}
async function isSeatedKage(village: string, playerName: string): Promise<boolean> {
    const st = await kv.get<{ seatedKage?: string }>(kageKey(village));
    return safeName(st?.seatedKage ?? '') === playerName;
}
async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
    return String(save?.character?.village ?? '').trim();
}

function declineStatus(e: SectorWarDeclineReason): number {
    switch (e) {
        case 'mutual-exclusion-attacker':
        case 'mutual-exclusion-defender':
        case 'already-contested':
        case 'siege-limit':
        case 'siege-cooldown':
            return 409;
        default:
            return 400;
    }
}
function declineMessage(e: SectorWarDeclineReason, cost?: number): string {
    switch (e) {
        case 'self': return 'You cannot sector-war your own village.';
        case 'not-war-village': return 'Both villages must be war villages.';
        case 'not-war-sector': return 'That sector is not a war sector.';
        case 'protected-core': return 'Village gates cannot be conquered; only their home village may fight to reclaim one.';
        case 'not-enemy-held': return 'That sector is not currently held by an enemy village.';
        case 'mutual-exclusion-attacker': return 'Your village is in a village war — finish it before running sector wars.';
        case 'mutual-exclusion-defender': return 'The defending village is in a village war and cannot be sector-warred.';
        case 'already-contested': return 'That sector already has an active sector war.';
        case 'siege-limit': return `Your village is already attacking ${MAX_ACTIVE_ATTACK_SIEGES} sectors — finish or call one off before opening another front.`;
        case 'siege-cooldown': return 'Your last siege on that sector just failed — the defenders are dug in. Try again tomorrow.';
        case 'win-condition-unavailable': return 'That sector’s win-condition is not available yet.';
        case 'insufficient-wr': return `Declaring this sector war costs ${cost ?? 0} War Resources.`;
        default: return 'Cannot declare a sector war on that sector.';
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!villageWarMapEnabled()) return res.status(404).json({ error: 'Not found.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '');
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }

        switch (action) {
            case 'declare': return await doDeclare(req, res, identity, playerName, body);
            case 'attack': return await doAttack(req, res, identity, playerName, body);
            case 'resolve': return await doResolve(req, res, identity, playerName, body);
            case 'garrison': return res.status(410).json({
                error: 'Sector garrison assaults are unavailable until the PvP runtime owns their resolution.',
            });
            case 'abandon': return await doAbandon(req, res, identity, playerName, body);
            case 'status': return await doStatus(req, res, body);
            case 'seed': return await doSeed(res, identity);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        // Lock contention is an ORDINARY, retryable outcome here, not a fault: two
        // attackers hitting the same sector, or one player retrying quickly, both
        // land on the same contest lock. Every failClosed path in this file can
        // raise it, so translate once — surfacing it as a 500 told the player the
        // server was broken and gave them nothing to act on. Matches the
        // convention in api/admin/legacy.ts.
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'That sector is busy right now — try again in a moment.' });
        }
        console.error('[village/sector-war]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── declare ──────────────────────────────────────────────────────────────────
type SectorFundingContext = {
    session: SectorWarSession;
    fundingPlan: WarDeclarationFundingPlan<Record<string, unknown>>;
    reservationPlan: VillageWarReservationPlan;
};

type SectorFundingOutcome =
    | { status: 'active'; session: SectorWarSession; chargedNow: boolean; cost: number }
    | { status: 'expired'; activated: boolean }
    | { status: 'insufficient'; have: number; cost: number }
    | { status: 'busy' | 'conflict' | 'stale-lease' | 'village-war' | 'taken' | 'ownership-changed' };

function sectorFundingContext(args: {
    session: SectorWarSession;
    source: WarDeclarationFundingSource;
    ownerId: string;
    now: number;
    expectedWar?: Record<string, unknown> | null;
}): SectorFundingContext {
    const generation = Math.floor(Number(args.session.declarationGeneration) || 0);
    if (!Number.isSafeInteger(generation) || generation <= 0) {
        throw new TypeError('Sector declaration generation is invalid.');
    }
    const declarationId = `sector:${args.session.id}:g${generation}`;
    const fingerprint = warDeclarationFundingFingerprint({
        policyVersion: 2,
        declarationId,
        declarationGeneration: generation,
        contestId: args.session.id,
        sector: args.session.sector,
        attackerVillage: args.session.attackerVillage,
        defenderVillage: args.session.defenderVillage,
        winCondition: args.session.winCondition,
        startedAt: args.session.startedAt,
        endsAt: args.session.endsAt,
        source: args.source,
    });
    const { declarationFunding: _funding, ...baseSession } = args.session;
    const villages = [args.session.attackerVillage, args.session.defenderVillage] as [string, string];
    const pairId = villages
        .map(normalizedWarVillage)
        .sort((left, right) => left.localeCompare(right))
        .join('-vs-');
    const warKey = sectorWarKey(args.session.id);
    return {
        session: args.session,
        fundingPlan: {
            warKey,
            declarationId,
            fingerprint,
            war: baseSession as unknown as Record<string, unknown>,
            ...(args.expectedWar === undefined ? {} : { expectedWar: args.expectedWar }),
            source: args.source,
            ownerId: args.ownerId,
            now: args.now,
            leaseMs: 30_000,
        },
        reservationPlan: {
            pairId,
            warKey,
            villages,
            generation,
            declarationId,
            fingerprint,
            source: args.source,
            ownerId: args.ownerId,
            now: args.now,
            leaseMs: 30_000,
        },
    };
}

function sealedFighterVillage(battle: ReadBattle, side: 'p1' | 'p2'): string {
    return String(battle[side]?.character?.village ?? '').trim();
}

function safeTerminalClock(battle: ReadBattle): { createdAt: number; endedAt: number } | null {
    const createdAt = battle.createdAt;
    const endedAt = battle.endedAt;
    return typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt > 0
        && typeof endedAt === 'number' && Number.isSafeInteger(endedAt) && endedAt >= createdAt
        ? { createdAt, endedAt }
        : null;
}

function receiptParticipant(receipt: SectorWarResolutionReceipt, playerName: string): boolean {
    return playerName === receipt.p1Name || playerName === receipt.p2Name;
}

function sendSectorResolutionReceipt(res: VercelResponse, receipt: SectorWarResolutionReceipt) {
    return res.status(200).json({
        ok: true,
        outcome: receipt.outcome,
        attackerWon: receipt.attackerWon,
        points: receipt.points,
        attackerPoints: receipt.attackerPoints,
        defenderPoints: receipt.defenderPoints,
        replayed: true,
    });
}

async function loadTerminalSectorBattle(battleId: string): Promise<ReadBattle | null> {
    const live = await kv.get<ReadBattle>(`pvp:${battleId}`);
    // A publication fence is not a battle row: keep falling through to the
    // durable terminal snapshot rather than reading the fence as the battle.
    if (live && !pvpSessionPublicationTombstoneFor(live, battleId)) return live;
    return await loadPvpRewardRecoverySnapshot(kv, battleId);
}

async function abortChangedSectorAuthority(context: SectorFundingContext, now: number): Promise<SectorFundingOutcome> {
    const { fundingPlan } = context;
    const current = await kv.get<Record<string, unknown>>(fundingPlan.warKey);
    const marker = warDeclarationFundingMarkerFromRow(current);
    if (!marker
        || marker.status !== 'funding'
        || marker.declarationId !== fundingPlan.declarationId
        || marker.fingerprint !== fundingPlan.fingerprint) {
        return { status: 'ownership-changed' };
    }
    const reservation = await reserveWarDeclarationFunding(kv, { ...fundingPlan, now });
    if (reservation.status === 'busy') return { status: 'busy' };
    if (reservation.status === 'conflict') return { status: 'conflict' };
    if (reservation.status === 'active') return { status: 'conflict' };
    const aborted = await abortWarDeclarationFunding(
        kv,
        fundingPlan.warKey,
        reservation.row,
        'authority-changed',
        now,
    );
    if (aborted.status === 'aborted') return { status: 'ownership-changed' };
    // A pre-existing debit under changed authority must never activate a stale
    // attacker-vs-old-owner contest. New code prevents this state by making the
    // hidden funding row block every territory-owner writer; legacy/corrupt
    // occurrences fail closed for explicit administrative resolution.
    return { status: 'conflict' };
}
function territoryKey(sector: number): string {
    return `world:territory:${Math.floor(Number(sector) || 0)}`;
}

async function continueSectorDeclaration(context: SectorFundingContext): Promise<SectorFundingOutcome> {
    const { session, fundingPlan, reservationPlan } = context;
    const admission = await claimVillageWarReservations(kv, reservationPlan);
    if (admission.status === 'busy') return { status: 'busy' };
    if (admission.status === 'blocked') return { status: 'village-war' };

    try {
        return await withKvLock(sectorDeclareLockKey(session.sector), async () => {
            return withKvLock(territoryKey(session.sector), async () => {
            // Territory ownership is declaration authority, not an advisory
            // pre-read. Share the exact writer lock and bind the owner again
            // across publication, debit, and activation. A due older contest is
            // also an in-flight ownership writer, so let it settle first.
            const authorityNow = Date.now();
            const ownerNow = await getSectorOwnerVillage(session.sector);
            if (ownerNow !== session.defenderVillage) {
                return abortChangedSectorAuthority(context, authorityNow);
            }
            const dueOnSector = (await listUnsettledDueSectorWars(authorityNow))
                .some(candidate => candidate.sector === session.sector);
            if (dueOnSector) return abortChangedSectorAuthority(context, authorityNow);

            const live = await activeContestOnSector(session.sector, authorityNow);
            if (live) {
                const marker = warDeclarationFundingMarkerFromRow(live);
                if (live.id === session.id
                    && live.declarationGeneration === session.declarationGeneration
                    && marker?.declarationId === fundingPlan.declarationId
                    && marker.fingerprint === fundingPlan.fingerprint) {
                    return { status: 'active' as const, session: live, chargedNow: false, cost: fundingPlan.source.amount };
                }
                return { status: 'taken' as const };
            }

            // The two exact village rows bridge the last cross-protocol window.
            // Ignore only this declaration while checking for a competing
            // all-out village war immediately before row-first publication.
            const ignoreReservation = {
                declarationId: fundingPlan.declarationId,
                fingerprint: fundingPlan.fingerprint,
            };
            const [attackerNowInWar, defenderNowInWar] = await Promise.all([
                villageHasActiveWar(session.attackerVillage, ignoreReservation),
                villageHasActiveWar(session.defenderVillage, ignoreReservation),
            ]);
            if (attackerNowInWar || defenderNowInWar) return { status: 'village-war' as const };

            // Publication is deliberately NON-PLAYABLE (`funding`). Only after
            // the exact source CAS co-writes the permanent debit receipt does an
            // exact activation CAS make the contest visible to sector scans.
            const reservation = await reserveWarDeclarationFunding(kv, fundingPlan);
            if (reservation.status === 'busy') return { status: 'busy' as const };
            if (reservation.status === 'conflict') return { status: 'conflict' as const };
            const promoted = await reserveClaimedVillageWarReservations(kv, reservationPlan);
            if (promoted.status !== 'reserved') return { status: 'conflict' as const };
            const settlementNow = Date.now();
            const funded = await settleReservedSectorWarDeclarationFunding(
                kv,
                fundingPlan,
                reservation,
                session.endsAt,
                settlementNow,
            );
            if (funded.status === 'expired') {
                return { status: 'expired' as const, activated: funded.activated };
            }
            if (funded.status === 'insufficient') return funded;
            if (funded.status !== 'active') return { status: funded.status } as SectorFundingOutcome;
            const active = normalizeSectorWarSession(funded.row);
            if (!active || !isSectorWarActive(active, settlementNow)) return { status: 'conflict' as const };
            const chargedNow = funded.receipt.ownerId === fundingPlan.ownerId
                && funded.receipt.debitedAt === settlementNow;
            return {
                status: 'active' as const,
                session: active,
                chargedNow,
                cost: funded.receipt.amount,
            };
            }, { failClosed: true });
        }, { failClosed: true });
    } finally {
        // `active` is the atomic hand-off to the authoritative sector scan;
        // `aborted` proves no contest exists. Funding rows keep their durable
        // reservations, so a crash cannot reopen the village-war race.
        await releaseVillageWarReservations(
            kv,
            reservationPlan,
            'sector-published',
            Date.now(),
        ).catch(() => undefined);
    }
}

async function sendSectorFundingOutcome(
    res: VercelResponse,
    outcome: SectorFundingOutcome,
    session: SectorWarSession,
) {
    if (outcome.status === 'taken') return res.status(409).json({ error: declineMessage('already-contested') });
    if (outcome.status === 'village-war') {
        return res.status(409).json({ error: 'One of those villages entered an active village war.' });
    }
    if (outcome.status === 'ownership-changed') {
        return res.status(409).json({ error: 'That sector changed owners while the declaration was settling.' });
    }
    if (outcome.status === 'expired') {
        if (outcome.activated) await settleDueSectorWars();
        return res.status(409).json({ error: 'That sector-war declaration window expired before it could activate.' });
    }
    if (outcome.status === 'insufficient') {
        return res.status(400).json({ error: `Declaring this sector war costs ${outcome.cost} War Resources.` });
    }
    if (outcome.status !== 'active') {
        return res.status(503).json({ error: 'Sector-war funding is settling — try again.' });
    }
    if (outcome.cost > 0) {
        void recordWarEcoEvent({
            eventId: `declare:${session.id}:g${session.declarationGeneration}`,
            village: session.attackerVillage,
            kind: 'wr.spend.declare',
            amount: outcome.cost,
            meta: `sector:${session.sector}`,
        });
    }
    return res.status(200).json({
        ok: true,
        cost: outcome.chargedNow ? outcome.cost : 0,
        alreadyOpen: !outcome.chargedNow,
        contest: projectSectorWarForClient(outcome.session),
    });
}

async function doDeclare(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const village = typeof body.village === 'string' ? body.village.trim() : ''; // attacker
    const sector = Math.floor(Number(body.sector) || 0);
    if (!isWarVillage(village)) return res.status(400).json({ error: 'Not a war village.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-declare', 20, 60_000, identity.name))) return;

    // Settle anything whose 72 hours just closed BEFORE reading ownership: a due
    // war on this very sector may be about to flip it, and declaring over an
    // unsettled record would erase a finished war's verdict.
    await settleDueSectorWars();

    const defender = await getSectorOwnerVillage(sector);
    if (!defender) return res.status(409).json({ error: 'That sector has no current owner — it must be seeded first.' });

    // Hidden funding rows are keyed by their SEALED defender. Discover them by
    // sector+attacker, not by the current owner-derived contest id: ownership may
    // have changed while the original process was down, in which case recovery
    // must exact-abort/fence the old authority rather than strand it forever.
    const pendingFunding = (await listFundingSectorWars())
        .filter(candidate => candidate.sector === sector && candidate.attackerVillage === village);
    if (pendingFunding.length > 1) {
        return res.status(503).json({ error: 'Multiple sector-war funding rows require administrator inspection.' });
    }
    const pendingSession = pendingFunding[0];
    if (pendingSession) {
        const pendingMarker = pendingSession.declarationFunding;
        if (!pendingMarker
            || pendingMarker.source.kind !== 'war-resources'
            || pendingMarker.source.recordKey !== villageWarKey(village)
            || pendingMarker.source.accountId !== village) {
            return res.status(503).json({ error: 'Sector-war funding identity is invalid; an administrator must inspect it.' });
        }
        const resumed = sectorFundingContext({
            session: pendingSession,
            source: pendingMarker.source,
            ownerId: newWarDeclarationFundingOwnerId(),
            now: Date.now(),
        });
        if (resumed.fundingPlan.declarationId !== pendingMarker.declarationId
            || resumed.fundingPlan.fingerprint !== pendingMarker.fingerprint) {
            return res.status(503).json({ error: 'Sector-war funding fingerprint is invalid; an administrator must inspect it.' });
        }
        return sendSectorFundingOutcome(res, await continueSectorDeclaration(resumed), pendingSession);
    }

    const contestId = sectorWarId(sector, village, defender);
    const contestKey = sectorWarKey(contestId);
    const rawContest = await kv.get<Record<string, unknown>>(contestKey);
    const storedMarker = warDeclarationFundingMarkerFromRow(rawContest);
    const storedSession = rawContest ? normalizeSectorWarSession(rawContest) : null;
    if (rawContest && Object.prototype.hasOwnProperty.call(rawContest, WAR_DECLARATION_FUNDING_FIELD) && !storedMarker) {
        return res.status(503).json({ error: 'Sector-war funding state is invalid; an administrator must inspect it.' });
    }

    if (!identity.admin && !(await isSeatedKage(village, playerName))) {
        return res.status(403).json({ error: 'Only the seated Kage can declare a sector war.' });
    }

    // Live held count (NOT the static home table) so the comeback discount can
    // actually fire for a village that has been pushed off the map.
    const attackerSectorsHeld = await heldSectorsForVillage(village);
    const atkKey = villageWarKey(village);
    const [attackerInWar, defenderInWar, existing, atkRecord, defRaw, mySieges] = await Promise.all([
        villageHasActiveWar(village),
        isWarVillage(defender) ? villageHasActiveWar(defender) : Promise.resolve(false),
        activeContestOnSector(sector),
        kv.get<Record<string, unknown>>(atkKey),
        isWarVillage(defender) ? kv.get<Record<string, unknown>>(villageWarKey(defender)) : Promise.resolve(null),
        activeSectorWarsForVillage(village).then((all) => all.filter((c) => c.attackerVillage === village).length),
    ]);
    // A lingering FAILED record (expired/abandoned, not a capture) for this exact
    // attacker+sector is the re-siege cooldown — its TTL is the clock.
    const priorFailedSiegeActive = !!storedSession && !storedSession.flipped && !!storedSession.expiredAt;
    const attackerRecord = normalizeVillageWarRecord(village, atkRecord ?? undefined);
    const defenderRecord = isWarVillage(defender) ? normalizeVillageWarRecord(defender, defRaw ?? undefined) : null;
    const winCondition = (defenderRecord?.sectors[String(sector)]?.winCondition ?? 'combat') as WinCondition;

    const check = canDeclareSectorWar({
        attackerVillage: village,
        defenderVillage: defender,
        sector,
        sectorOwnerVillage: defender,
        winCondition,
        attackerInActiveVillageWar: attackerInWar,
        defenderInActiveVillageWar: defenderInWar,
        contestAlreadyActive: !!existing,
        attackerWr: attackerRecord.warResources,
        attackerSectorsHeld,
        attackerActiveSieges: mySieges,
        priorFailedSiegeActive,
        allowedWinConditions: WIRED_WIN_CONDITIONS,
    });
    if (!check.ok) return res.status(declineStatus(check.error)).json({ error: declineMessage(check.error, check.cost) });
    if (rawContest && !storedSession) {
        return res.status(503).json({ error: 'Existing sector-war state is invalid; an administrator must inspect it.' });
    }

    const priorGeneration = Math.floor(Number(storedSession?.declarationGeneration) || 0);
    const generation = priorGeneration + 1;
    if (!Number.isSafeInteger(generation) || generation <= 0) {
        return res.status(503).json({ error: 'Sector-war declaration generation is exhausted.' });
    }
    const now = Date.now();
    const session: SectorWarSession = {
        ...newSectorWarSession({ sector, attackerVillage: village, defenderVillage: defender, winCondition, now }),
        declarationGeneration: generation,
    };
    const source: WarDeclarationFundingSource = {
        kind: 'war-resources',
        recordKey: atkKey,
        accountId: village,
        amount: check.cost,
    };
    const context = sectorFundingContext({
        session,
        source,
        ownerId: newWarDeclarationFundingOwnerId(),
        now,
        expectedWar: rawContest,
    });
    return sendSectorFundingOutcome(res, await continueSectorDeclaration(context), session);
}

// ── attack (register a battle → mint the single-use token) ────────────────────
// Either warring side may register a battle they fought over the sector (so the
// defender's wins count for regen, §17.6). The token records the CONTEST's
// villages, so resolve maps the authoritative winner by village regardless of
// who registered — an attacker can't suppress the defender's regen by only
// reporting their own wins.
async function doAttack(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const sector = Math.floor(Number(body.sector) || 0);
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-attack', 40, 60_000, identity.name))) return;

    const contest = await activeContestOnSector(sector);
    // Most world PvP is not part of a Combat sector contest. Registration is
    // still an idempotent prerequisite for the client, so absence is a
    // canonical success/no-op rather than a permanent completion error.
    if (!contest || contest.winCondition !== 'combat') {
        return res.status(200).json({ ok: true, registered: false, battleId, noContest: true });
    }
    const { attackerVillage, defenderVillage } = contest;

    // The battle must be a real PvP session fought between a member of the
    // attacking village and a member of the defending village (the sanctioned
    // sector-attack). We seal the contest binding into the token; resolve trusts
    // only the authoritative session winner.
    const battle = await kv.get<ReadBattle>(`pvp:${battleId}`);
    if (!battle) return res.status(404).json({ error: 'Battle session not found or expired.' });
    if (!identity.admin && battle.rewardAuthority !== 'world') {
        return res.status(409).json({ error: 'That battle is not an authorized world-sector match.' });
    }
    if (!Number.isSafeInteger(battle.createdAt) || battle.createdAt < contest.startedAt) {
        return res.status(409).json({ error: 'That battle predates this sector war.' });
    }
    const p1 = safeName(battle.p1?.name ?? '');
    const p2 = safeName(battle.p2?.name ?? '');
    if (!p1 || !p2) return res.status(409).json({ error: 'That battle is not a two-fighter PvP session.' });
    if (!identity.admin && identity.name !== p1 && identity.name !== p2) {
        return res.status(403).json({ error: 'Only a fighter in that battle may register it for the sector war.' });
    }
    const v1 = sealedFighterVillage(battle, 'p1');
    const v2 = sealedFighterVillage(battle, 'p2');
    if (v1 === v2 || !(v1 === attackerVillage || v2 === attackerVillage) || !(v1 === defenderVillage || v2 === defenderVillage)) {
        return res.status(200).json({ ok: true, registered: false, battleId, noContest: true });
    }

    const existingToken = await loadSectorWarToken(battleId);
    if (existingToken) {
        const exactBinding = existingToken.sectorWarId === contest.id
            && existingToken.sector === sector
            && existingToken.p1Name === p1
            && existingToken.p2Name === p2
            && existingToken.p1Village === v1
            && existingToken.p2Village === v2;
        if (!exactBinding) return res.status(409).json({ error: 'That battle is already bound to a different sector contest.' });
        return res.status(200).json({ ok: true, registered: true, replayed: true, battleId, sectorWarId: contest.id });
    }

    // Seal the DEFENDER's chosen sector terrain into the fight as its biome, so the
    // home-terrain school bonus actually applies (+10% to the terrain's jutsu school
    // via api/pvp/move.ts terrainMultiplier — §17.3 "defender home advantage"; the
    // valid terrains forest/snow/volcano/shadow are exactly the buffed biomes, central
    // is neutral). This is server-authoritative and runs at battle registration —
    // BEFORE any move resolves and reads session.biome — so an attacker can't dodge
    // the defender's home terrain by opening the duel on a biome that suits their own
    // school. Registration is fail-closed: the fight stays unsanctioned unless
    // the authoritative terrain and durable contest token are both sealed first.
    const battleKey = `pvp:${battleId}`;
    const lockKey = `${battleKey}:lock`;
    const lockToken = `sector-war:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let lockResult: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        lockResult = await kv.set(lockKey, lockToken, { nx: true, ex: 3 } as never);
        if (lockResult) break;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
    }
    if (!lockResult) return res.status(503).json({ error: 'That battle is busy; retry registration before making a move.' });

    try {
        const fresh = await kv.get<ReadBattle>(battleKey);
        const freshP1 = safeName(fresh?.p1?.name ?? '');
        const freshP2 = safeName(fresh?.p2?.name ?? '');
        if (!fresh || freshP1 !== p1 || freshP2 !== p2) {
            return res.status(409).json({ error: 'Battle participants changed before registration completed.' });
        }
        if (!identity.admin && fresh.rewardAuthority !== 'world') {
            return res.status(409).json({ error: 'Battle authorization changed before registration completed.' });
        }
        const pristine = fresh.status === 'active'
            && Number(fresh.round) === 1
            && Number(fresh.actionsThisTurn) === 0
            && (!Array.isArray(fresh.recentMoveTokens) || fresh.recentMoveTokens.length === 0)
            && Array.isArray(fresh.log)
            && fresh.log.length === 1;
        if (!pristine) {
            return res.status(409).json({ error: 'Register the sector-war battle before either fighter makes a move.' });
        }

        const defRec = normalizeVillageWarRecord(defenderVillage, (await kv.get<Record<string, unknown>>(villageWarKey(defenderVillage))) ?? undefined);
        const terrain = defRec.sectors[String(sector)]?.terrain;
        if (terrain && fresh.biome !== terrain) {
            const intended = { ...fresh, biome: terrain };
            try {
                if (!(await kv.compareSet(battleKey, fresh, intended, { ex: SESSION_TTL }))) {
                    return res.status(503).json({ error: 'Battle advanced before terrain registration completed; retry.' });
                }
            } catch (error) {
                const recovered = await kv.get<ReadBattle>(battleKey).catch(() => null);
                if (!isDeepStrictEqual(recovered, intended)) throw error;
            }
        }

        await mintSectorWarToken(newSectorWarBattleToken({
            battleId,
            sectorWarId: contest.id,
            sector,
            attackerVillage,
            defenderVillage,
            registeredBy: playerName,
            winCondition: 'combat',
            p1Name: p1,
            p2Name: p2,
            p1Village: v1,
            p2Village: v2,
            biome: terrain || fresh.biome || 'central',
            now: battle.createdAt,
        }));
    } finally {
        await kv.delIfEqual(lockKey, lockToken);
    }
    return res.status(200).json({ ok: true, registered: true, battleId, sectorWarId: contest.id });
}

// ── resolve (apply the authoritative outcome; flip on capture) ─────────────────
async function doResolve(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const battleId = String(body.battleId ?? '').trim();
    if (!battleId) return res.status(400).json({ error: 'Missing battleId.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-resolve', 40, 60_000, identity.name))) return;

    const priorResolution = await loadSectorWarResolutionReceipt(battleId);
    if (priorResolution) {
        if (!identity.admin && !receiptParticipant(priorResolution, playerName)) {
            return res.status(403).json({ error: 'Only a fighter in that battle may replay its sector result.' });
        }
        return sendSectorResolutionReceipt(res, priorResolution);
    }

    const battle = await loadTerminalSectorBattle(battleId);
    const clock = battle ? safeTerminalClock(battle) : null;
    if (!battle || battle.status !== 'done' || !battle.winner || !clock) {
        return res.status(409).json({ error: 'Battle is not a valid finished PvP session.' });
    }
    if (battle.rewardAuthority !== 'world' || !pvpSessionMayGrantProgress(battle)) {
        return res.status(409).json({ error: 'The battle was not authorized for world progression.' });
    }
    const battleP1 = safeName(battle.p1?.name ?? '');
    const battleP2 = safeName(battle.p2?.name ?? '');
    if (!battleP1 || !battleP2) return res.status(409).json({ error: 'Battle participants are invalid.' });
    if (!identity.admin && playerName !== battleP1 && playerName !== battleP2) {
        return res.status(403).json({ error: 'Only a fighter in that battle may resolve its sector result.' });
    }

    const canonical = await settlePvpSectorWarContinuation(battle);
    return sendSectorResolutionReceipt(res, canonical);

    /* Retired inline resolver: the canonical implementation now lives in
     * pvp/_sector-war-continuation.ts so terminal replay and this route share
     * one server-owned authority path.
    const receiptBase = {
        version: 1 as const,
        battleId,
        p1Name: battleP1,
        p2Name: battleP2,
        sessionCreatedAt: clock.createdAt,
        sessionEndedAt: clock.endedAt,
    };
    const commitNoop = async (outcome: 'superseded' | 'not-applicable', sectorWarId: string | null = null) => {
        const receipt = await commitSectorWarResolutionReceipt({
            ...receiptBase,
            outcome,
            sectorWarId,
            attackerWon: null,
            points: 0,
            attackerPoints: null,
            defenderPoints: null,
        });
        return sendSectorResolutionReceipt(res, receipt);
    };

    if (battle.winner === 'draw') return commitNoop('not-applicable');

    const sealedP1Village = sealedFighterVillage(battle, 'p1');
    const sealedP2Village = sealedFighterVillage(battle, 'p2');
    const winnerName = battle.winner === 'p1' ? battleP1 : battleP2;
    const winnerSide = battle.winner === 'p1' ? 'p1' : 'p2';
    const loserSide = winnerSide === 'p1' ? 'p2' : 'p1';
    const winnerVillage = winnerSide === 'p1' ? sealedP1Village : sealedP2Village;

    // Crash recovery: the contest CAS embeds the score before the external
    // per-battle receipt is published. Recover that exact proof before looking
    // at the registration token, whose TTL is only an admission horizon.
    const embedded = await findSectorWarAppliedBattle(battleId);
    if (embedded) {
        const contest = embedded.session;
        const participantVillages = new Set([sealedP1Village, sealedP2Village]);
        const embeddedAttackerWon = winnerVillage === contest.attackerVillage;
        if (!sealedP1Village
            || !sealedP2Village
            || participantVillages.size !== 2
            || !participantVillages.has(contest.attackerVillage)
            || !participantVillages.has(contest.defenderVillage)
            || contest.sector !== battle.rewardSector
            || embedded.receipt.attackerWon !== embeddedAttackerWon
            || embedded.receipt.at !== clock.endedAt
            || safeName(embedded.receipt.by) !== winnerName) {
            throw new Error('sector-war-embedded-receipt-authority-conflict');
        }
        const durable = await commitSectorWarResolutionReceipt({
            ...receiptBase,
            outcome: 'applied',
            sectorWarId: contest.id,
            attackerWon: embeddedAttackerWon,
            points: embedded.receipt.points,
            attackerPoints: contest.attackerPoints,
            defenderPoints: contest.defenderPoints,
        });
        return sendSectorResolutionReceipt(res, durable);
    }

    const token = await loadSectorWarToken(battleId);
    // A sanctioned world fight without a contest token is ordinary territory
    // PvP. It has no sector-war side effect, but still needs a durable canonical
    // receipt so both participants and lost-response retries can finish ACK.
    if (!token) return commitNoop('not-applicable');

    if ((token.p1Name && battleP1 !== token.p1Name) || (token.p2Name && battleP2 !== token.p2Name)) {
        return res.status(409).json({ error: 'Battle participants no longer match the sealed sector-war token.' });
    }
    if (sealedP1Village !== token.p1Village
        || sealedP2Village !== token.p2Village
        || battle.rewardSector !== token.sector) {
        return res.status(409).json({ error: 'Battle authority no longer matches the sealed sector contest.' });
    }
    const tokenWinnerVillage = winnerSide === 'p1' ? token.p1Village : token.p2Village;
    const attackerWon = !!tokenWinnerVillage && tokenWinnerVillage === token.attackerVillage;
    const tokenLoserVillage = loserSide === 'p1' ? token.p1Village : token.p2Village;
    // Roles are immutable session evidence. A post-battle village switch or
    // Kage/ANBU appointment can never amplify an older fight.
    const winnerRole = sealedSectorWarRoleOf(battle.warRoleEvidence, winnerSide, tokenWinnerVillage, clock.createdAt);
    const loserRole = sealedSectorWarRoleOf(battle.warRoleEvidence, loserSide, tokenLoserVillage, clock.createdAt);

    const id = token.sectorWarId;
    const result = await withKvLock(sectorWarKey(id), async () => {
        const rawContest = await kv.get<Partial<SectorWarSession>>(sectorWarKey(id));
        const contest = rawContest ? normalizeSectorWarSession(rawContest) : null;
        if (!contest || clock.createdAt < contest.startedAt) return { outcome: 'superseded' as const, contest };
        // A siege that timed out (or was called off) while this battle was being
        // fought is a defender hold. Eligibility uses immutable terminal time,
        // never delayed claim wall-clock.
        if (!isSectorWarActive(contest, clock.endedAt)) return { outcome: 'superseded' as const, contest };
        const prior = findSectorWarBattleReceipt(contest, battleId);
        if (prior) {
            if (prior.attackerWon !== attackerWon) throw new Error('sector-war-embedded-receipt-conflict');
            return { outcome: 'applied' as const, replayed: true, awarded: prior.points, session: contest };
        }
        // Score the kill. Sectors never flip mid-war -- settlement compares the
        // tallies when the 72 hours close (api/_sector-war-settle.ts).
        const [atkRaw, defRaw] = await Promise.all([
            kv.get<Record<string, unknown>>(villageWarKey(token.attackerVillage)),
            kv.get<Record<string, unknown>>(villageWarKey(token.defenderVillage)),
        ]);
        const outcome = applySectorWarBattle(contest, attackerWon, {
            now: clock.endedAt,
            roleSwing: sectorControlSwing(winnerRole, loserRole),
            attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(token.attackerVillage, atkRaw ?? undefined)),
            defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(token.defenderVillage, defRaw ?? undefined)),
            by: winnerName,
        });
        const recorded = recordSectorWarBattleOutcome(outcome, { battleId, attackerWon, by: winnerName, at: clock.endedAt });
        try {
            if (!(await kv.compareSet(sectorWarKey(id), rawContest, recorded.session))) {
                throw new Error('sector-war-contest-version-conflict');
            }
        } catch (error) {
            const recovered = await kv.get<unknown>(sectorWarKey(id)).catch(() => null);
            if (!isDeepStrictEqual(recovered, recorded.session)) throw error;
        }
        return { outcome: 'applied' as const, replayed: false, awarded: outcome.awarded, session: recorded.session };
    }, { failClosed: true });

    if (result.outcome === 'superseded') {
        return commitNoop('superseded', id);
    }

    const durable = await commitSectorWarResolutionReceipt({
        ...receiptBase,
        outcome: 'applied',
        sectorWarId: id,
        attackerWon,
        points: result.awarded,
        attackerPoints: result.session.attackerPoints,
        defenderPoints: result.session.defenderPoints,
    });
    // Legacy tracking (ENABLE_LEGACY): war credit from the authoritative
    // resolve — winner banked a war kill + contribution; a defender hold is a
    // defense, an attacker capture is a capture. Best-effort, after the lock.
    if (!result.replayed && legacyEnabled() && winnerName) {
        await bumpLegacyStats(winnerName, {
            warPvpKills: 1,
            // Flat war-contribution points per validated war battle (role swings
            // are small numbers — using them raw made every warContribution floor
            // unreachable; verification finding). Sector captures are settlement's
            // business now, not any single battle's.
            warContribution: 2000,
            ...(!attackerWon ? { sectorDefenses: 1, defensiveWins: 1 } : {}),
        });
        await bumpEraContribution('warBattles');
    }
    return sendSectorResolutionReceipt(res, durable);
    */
}

// ── abandon (the attacking Kage calls off their own siege) ────────────────────
// The counterpart to the village war's "call peace". Without it a Kage who
// mis-declared had to wait out the idle timeout before that sector — or a village
// war — could be opened again. Only the ATTACKER may withdraw: letting a defender
// dismiss a siege would be free defence.
async function doAbandon(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const sector = Math.floor(Number(body.sector) || 0);
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-war-abandon', 10, 60_000, identity.name))) return;

    const contest = await activeContestOnSector(sector);
    if (!contest) return res.status(409).json({ error: 'No active sector war on that sector.' });
    if (!identity.admin && !(await isSeatedKage(contest.attackerVillage, playerName))) {
        return res.status(403).json({ error: 'Only the attacking village’s seated Kage can call off a sector war.' });
    }

    const out = await withKvLock(sectorWarKey(contest.id), async () => {
        const fresh = await loadSectorWar(contest.id);
        if (!fresh || !isSectorWarActive(fresh, Date.now())) return { ok: false as const };
        const { session, changed } = abandonSectorWar(fresh, Date.now());
        // The stamped record carries the re-siege cooldown TTL. (It previously had
        // NO ttl here, so an abandoned siege lingered in the keyspace forever.)
        if (changed) await saveSectorWar(session, SECTOR_RESIEGE_COOLDOWN_SEC);
        return { ok: true as const, session };
    }, { failClosed: true });

    if (!out.ok) return res.status(409).json({ error: 'That sector war is already over.' });
    // The WR spent declaring is NOT refunded — a called-off siege still cost the
    // village, which is what keeps declare-spam from being free.
    return res.status(200).json({ ok: true, sector, contest: projectSectorWarForClient(out.session) });
}

// ── status (read-only) ─────────────────────────────────────────────────────────
async function doStatus(_req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
    // The war map polls this every 15s, which makes it the near-instant
    // settlement path: a war whose 72 hours just closed flips (or holds) within
    // one poll of someone looking at it. The daily pass is only the backstop.
    await settleDueSectorWars();
    const sector = Math.floor(Number(body.sector) || 0);
    if (sector) {
        const [ownerVillage, contest] = await Promise.all([getSectorOwnerVillage(sector), activeContestOnSector(sector)]);
        return res.status(200).json({ ok: true, sector, ownerVillage, contest: contest ? projectSectorWarForClient(contest) : null });
    }
    const contests = await listActiveSectorWars();
    return res.status(200).json({ ok: true, contests: contests.map(projectSectorWarForClient) });
}

// ── seed (admin, Phase 4d) ─────────────────────────────────────────────────────
async function doSeed(res: VercelResponse, identity: Identity) {
    if (!identity.admin) return res.status(403).json({ error: 'Admin only.' });
    const seeded = await seedHomeSectorOwnership(Date.now());
    return res.status(200).json({ ok: true, ...seeded });
}
