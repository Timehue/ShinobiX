import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { cors, safeName, clanRecordKey } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { legacyEnabled, bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContribution } from '../_era.js';
import { reportMissionEvent, type CompletedMissionInfo } from '../missions/_progress.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { isWarVillage, isWarSector, homeVillageForSector } from '../_war-map-sectors.js';
import { normalizeVillageWarRecord, villageWarKey } from '../_war-state.js';
import { getSectorOwnerVillage } from '../_sector-war-store.js';
import {
    buildInfiltrationEncounter,
    infiltrationSessionMatches,
} from '../_anbu-infiltration-encounter.js';
import {
    readInfilRun,
    writeInfilRun,
    deleteInfilRun,
    bumpInfilStartCount,
    loadAnbuAppointees,
    pickAnbuDefender,
    getOrSealAnbuSnapshot,
    settleInfiltrationWin,
    settleInfiltrationLoss,
    turnInCachesForSave,
    type InfilRun,
} from '../_anbu-infiltration-store.js';
import { MAX_RAID_ATTEMPTS_PER_DAY, type WarPool } from '../_anbu-infiltration.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { hydrateCharacterFromSave, sealItemCharges } from '../pvp/session.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';

/*
 * /api/village/anbu-infiltration — POST only. The Anbu Vault Infiltration raid
 * (docs/anbu-infiltration-plan.md): a level-100 sector-attrition activity, fully
 * server-authoritative, one route with an action switch (the sector-war.ts shape).
 *
 * Actions (body.action):
 *   - start   : gate-check, pick + daily-seal the defending Anbu, build the vault
 *               Solo PvE fight against a sealed REAL defender snapshot).
 *   - act     : retired compatibility action; combat intents go to /solo-pve/action.
 *   - state   : read-only run fetch (refresh-restore).
 *   - report  : settle a FINISHED run. Win → server-rolled skim of the enemy war
 *               economy (both 50%/day ledgers enforced inside pool locks), caches +
 *               ryo minted under the save lock. Loss persists proven usage and
 *               terminal character state without a reward. Idempotent.
 *   - turn-in : convert held caches into standing points, type-locked (War Supply →
 *               clan 2:1, War Resource → village merit 1:1).
 *
 * LIVE by default — no opt-in flag. Set DISABLE_ANBU_INFILTRATION=1 only as an
 * emergency kill switch. Runs on the base war map (a sector with no seeded
 * world:territory owner falls back to its home village, so it works before any
 * sector-war capture), and defends with the village's appointed Anbu or, if none
 * are appointed yet, its seated Kage. NEVER flips sector ownership; conquest
 * stays with /village/sector-war.
 */

const LEVEL_REQUIREMENT = 100;

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;

async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName}`);
    return String(save?.character?.village ?? '').trim();
}

/** The seated Kage of a village (a real appointed leader) — the defender fallback
 *  when a village hasn't appointed Anbu yet. Mirrors sector-war's kage key. */
async function seatedKageOf(village: string): Promise<string> {
    const st = await kv.get<{ seatedKage?: string }>(`village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`);
    return safeName(st?.seatedKage ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.DISABLE_ANBU_INFILTRATION === '1') {
        return res.status(404).json({ error: 'Not found.' });
    }

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
            case 'start': return await doStart(req, res, identity, playerName, body);
            case 'act': return res.status(410).json({ error: 'ANBU combat actions moved to /api/solo-pve/action.', code: 'anbu-solo-pve-cutover' });
            case 'state': return await doState(res, identity, playerName, body);
            case 'report': return await doReport(req, res, identity, playerName, body);
            case 'turn-in': return await doTurnIn(req, res, identity, playerName, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[village/anbu-infiltration]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── start ─────────────────────────────────────────────────────────────────────
async function doStart(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-start', 10, 60_000, identity.name))) return;
    const sector = Math.floor(Number(body.sector) || 0);
    if (!sector) return res.status(400).json({ error: 'Missing sector.' });

    // The raider: save exists, level 100+, belongs to a village.
    const rec = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
    const char = rec?.character as Record<string, unknown> | undefined;
    if (!char) return res.status(404).json({ error: 'Your save was not found.' });
    const level = Math.floor(Number(char.level) || 0);
    if (!identity.admin && level < LEVEL_REQUIREMENT) {
        return res.status(403).json({ error: `Anbu infiltration requires level ${LEVEL_REQUIREMENT}.` });
    }
    const raiderVillage = String(char.village ?? '').trim();
    if (!raiderVillage) return res.status(403).json({ error: 'You must belong to a village.' });

    // The target: an enemy-held war sector. Prefer the live captured owner; fall
    // back to the sector's HOME village when world:territory isn't seeded yet, so
    // infiltration works on the base war map before any sector-war has run.
    if (!isWarSector(sector)) return res.status(400).json({ error: 'That sector is not a war sector.' });
    const targetVillage = (await getSectorOwnerVillage(sector)) || (homeVillageForSector(sector) ?? '');
    if (!targetVillage || !isWarVillage(targetVillage)) return res.status(409).json({ error: 'That sector is not held by a war village.' });
    if (targetVillage === raiderVillage) return res.status(400).json({ error: 'You cannot infiltrate your own village’s sector.' });

    // Defenders: the village's appointed Anbu, or — if none are appointed yet —
    // its seated Kage (also a real appointed leader). Either way the defender is
    // a real player's sealed loadout, shown behind the village's Anbu mask.
    let appointees = await loadAnbuAppointees(targetVillage);
    if (appointees.length === 0) {
        const kage = await seatedKageOf(targetVillage);
        if (kage) appointees = [kage];
    }
    if (appointees.length === 0) {
        return res.status(409).json({ error: 'That village has no Anbu or Kage to defend its vault yet.' });
    }

    // Daily attempt cap (counts ATTEMPTS — abandoning a run does not refund it).
    const started = await bumpInfilStartCount(playerName);
    if (!identity.admin && started > MAX_RAID_ATTEMPTS_PER_DAY) {
        return res.status(429).json({ error: 'Daily infiltration limit reached.' });
    }

    // Defender: least-recently-defended Anbu, sealed daily from their save.
    const anbuSlug = await pickAnbuDefender(targetVillage, appointees);
    const snapshot = anbuSlug ? await getOrSealAnbuSnapshot(targetVillage, anbuSlug) : null;
    if (!anbuSlug || !snapshot) {
        return res.status(409).json({ error: 'No defending Anbu could be prepared — try again shortly.' });
    }

    // Defender home-terrain edge: the sector's Kage-set terrain seals in as the
    // fight biome (identical mechanic to sector-war's terrain seal).
    const defRec = normalizeVillageWarRecord(targetVillage, (await kv.get<Record<string, unknown>>(villageWarKey(targetVillage))) ?? undefined);
    const terrain = String(defRec.sectors[String(sector)]?.terrain ?? 'central');

    // Seal both sides through the canonical server hydrator. Client-computed
    // loadout fields are deliberately ignored; equipped content and passives
    // resolve from the authoritative save and admin catalogs.
    const raiderCharacter = hydrateCharacterFromSave(char, {}, rec ?? null, await loadAdminCombatContent());

    const runId = `infil-${randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    const shortVillage = targetVillage.replace(/\s+Village$/i, '').trim();
    const maskedAnbuName = `The ${shortVillage || 'Village'} Anbu`;
    const session = buildInfiltrationEncounter({
        runId, now,
        raider: { slug: playerName, name: String(char.name ?? playerName), character: raiderCharacter, itemCharges: sealItemCharges(raiderCharacter, char) },
        anbu: { slug: snapshot.slug, name: maskedAnbuName, character: snapshot.character },
        terrain, sector, targetVillage,
    });

    const run: InfilRun = {
        runId, raiderSlug: playerName, sector, targetVillage,
        anbuSlug: snapshot.slug, anbuName: maskedAnbuName, terrain,
        createdAt: now,
    };
    await writeSoloPveSession(session);
    await writeInfilRun(run);
    return res.status(200).json({
        ok: true, runId, sector, targetVillage,
        anbu: { name: maskedAnbuName }, session,
    });
}

// ── state (read-only refresh-restore) ─────────────────────────────────────────
async function doState(res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const runId = String(body.runId ?? '');
    if (!runId) return res.status(400).json({ error: 'Missing runId.' });
    const run = await readInfilRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found or expired.' });
    if (!identity.admin && run.raiderSlug !== playerName) return res.status(403).json({ error: 'Not your run.' });
    const session = await readSoloPveSession(runId);
    if (!infiltrationSessionMatches(run, session)) return res.status(409).json({ error: 'The infiltration combat binding is invalid.' });
    return res.status(200).json({ ok: true, runId, sector: run.sector, targetVillage: run.targetVillage, anbu: { name: run.anbuName }, session });
}

// ── report (settle a finished run — the ONLY reward path) ─────────────────────
async function doReport(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-report', 10, 60_000, identity.name))) return;
    const runId = String(body.runId ?? '');
    if (!runId) return res.status(400).json({ error: 'Missing runId.' });

    const run = await readInfilRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found, expired, or already settled.' });
    if (!identity.admin && run.raiderSlug !== playerName) return res.status(403).json({ error: 'Not your run.' });
    const session = await readSoloPveSession(runId);
    if (!infiltrationSessionMatches(run, session)) return res.status(409).json({ error: 'The infiltration combat binding is invalid.' });
    if (session.status !== 'done' || !session.terminalEvidence) return res.status(409).json({ error: 'The fight is not finished.' });

    if (session.outcome !== 'win') {
        // The Anbu held. No reward, no drain — the vault stands.
        const loss = await settleInfiltrationLoss(run, session);
        if (!loss.ok) return res.status(404).json({ error: 'Your save was not found.' });
        await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
            kind: 'anbu-infiltration', id: runId, settledAt: Date.now(), rewards: { won: false },
        }));
        await deleteInfilRun(runId);
        return res.status(200).json({
            ok: true,
            won: false,
            alreadySettled: loss.alreadySettled,
            ...(!loss.alreadySettled ? { character: loss.character, _saveVersion: loss.saveVersion } : {}),
        });
    }

    // Server-side roll — the client never picks the pool, the outcome, or amounts.
    const roll = randomInt(0, 1_000_000_000) / 1_000_000_000;
    const out = await settleInfiltrationWin(run, roll, {}, session);
    if (!out.ok) {
        if (out.error === 'no-save') return res.status(404).json({ error: 'Your save was not found.' });
        return res.status(503).json({
            ok: false,
            error: 'The raid succeeded but the reward could not be saved. An admin can reconcile it — please do not retry.',
        });
    }
    await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
        kind: 'anbu-infiltration',
        id: runId,
        settledAt: Date.now(),
        rewards: out.alreadySettled ? { won: true } : {
            won: true,
            supplyCaches: out.supplyCaches,
            wrCaches: out.wrCaches,
            ryo: out.ryo,
        },
    }));
    await deleteInfilRun(runId);
    if (out.alreadySettled) return res.status(200).json({ ok: true, won: true, alreadySettled: true });

    // ── Mission / legacy / clan hooks (docs plan §9) ──────────────────────────
    // Best-effort AFTER the authoritative settle — a hook failure must never
    // unwind the paid reward. An infiltration win is a server-proofed raid:
    //   • Vanguards progress their 'vanguard-raids' daily missions.
    //   • Legacy (the L100 system) credits raidsCompleted + warContribution and
    //     the era's warBattles — identical to sector-war's resolve credit.
    //   • The raider's clan gets +1 eventContrib, which feeds the EXISTING clan
    //     'raid' mission (progress = eventContrib/3) and 'training'.
    let missionsCompleted: CompletedMissionInfo[] = [];
    let missionXp = 0;
    try {
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = save?.character as Record<string, unknown> | undefined;
        if (char?.profession === 'vanguard') {
            const missionRes = await reportMissionEvent({ playerName, profession: 'vanguard', kind: 'vanguard-raids' });
            missionsCompleted = missionRes.missionsCompleted;
            missionXp = missionRes.xpAwarded;
        }
        if (legacyEnabled()) {
            await bumpLegacyStats(playerName, { raidsCompleted: 1, warContribution: 500 });
            await bumpEraContribution('warBattles');
        }
        const clan = String(char?.clan ?? '').trim();
        if (clan) {
            await withKvLock(clanRecordKey(clan), async () => {
                const key = clanRecordKey(clan);
                const rec = await kv.get<Record<string, unknown>>(key);
                if (!rec) return;
                const members = Array.isArray(rec.members) ? [...(rec.members as Record<string, unknown>[])] : [];
                const i = members.findIndex(m => safeName(String((m as Record<string, unknown>)?.name ?? '')) === playerName);
                if (i < 0) return;
                members[i] = { ...members[i], eventContrib: (Number((members[i] as Record<string, unknown>).eventContrib) || 0) + 1 };
                await kv.set(key, { ...rec, members });
            }); // default lock semantics — contrib is a counter, not currency
        }
    } catch (hookErr) {
        console.error('[village/anbu-infiltration] post-win hooks (non-fatal)', hookErr);
    }

    return res.status(200).json({
        ok: true, won: true, alreadySettled: false,
        rolled: out.rolled,
        supplySkim: out.supplySkim, wrSkim: out.wrSkim,
        supplyCaches: out.supplyCaches, wrCaches: out.wrCaches,
        ryo: out.ryo, overflowLost: out.overflowLost,
        character: out.character,
        missionsCompleted, missionXp,
        _saveVersion: out.saveVersion,
    });
}

// ── turn-in (caches → standing points, type-locked) ───────────────────────────
async function doTurnIn(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-turnin', 20, 60_000, identity.name))) return;
    const cacheRaw = String(body.cache ?? '');
    if (cacheRaw !== 'warSupply' && cacheRaw !== 'warResources') {
        return res.status(400).json({ error: 'Invalid cache type.' });
    }
    const cache = cacheRaw as WarPool;
    const countRaw = Number(body.count);
    const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : undefined;

    const out = await turnInCachesForSave({ playerName, cache, count });
    if (!out.ok) {
        if (out.error === 'no-save') return res.status(404).json({ error: 'Your save was not found.' });
        if (out.error === 'not-in-clan') return res.status(403).json({ error: 'You are not in a clan.' });
        // nothing-to-turn-in / cap-reached are normal game states, not errors.
        return res.status(200).json({ ok: false, reason: out.error });
    }
    return res.status(200).json({
        ok: true, dest: out.dest, points: out.points, consumed: out.consumed,
        remaining: out.remaining, _saveVersion: out.saveVersion,
    });
}
