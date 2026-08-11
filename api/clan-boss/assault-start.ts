import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { getFloor } from '../towers/_floor-catalog.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import { makeRng } from '../towers/_sim.js';
import { readSession, writeSession, setTowerInvite } from '../towers/_tower-store.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { loadAssault, saveAssault, selectClanBossParty } from './_assault.js';
import { activatePartyStart, clanBossPartiesEnabled, loadParty, preparePartyStart, reopenPartyStart } from './_party.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { configureClanBossEncounter } from './_encounter-config.js';
import {
    CB_ASSAULT_HP_CAP, CB_MAX_PARTY, clanBossAttemptsLeft,
    clanBossProgressKey, clanBossWeekId, clanSlug, loadClanBossProgress, loadClanBossWeek,
    newClanBossProgress, reserveAttemptForRequest, resolveClanBossDef, saveClanBossProgress,
} from './_storage.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import {
    bindClanBossBattleMarkers,
    claimClanBossBattleMarkers,
    releaseClanBossStartMarkers,
} from '../towers/_battle-lease.js';

/*
 * POST /api/clan-boss/assault-start — begin a co-op assault on THIS week's clan boss.
 *
 * Reserves one of the host's weekly attempts, then mints a Battle-Towers session on
 * the week's clan-boss floor (host + up to 2 clanmate allies). The fight then runs
 * through the EXISTING /api/towers/action loop + battle screen; api/clan-boss/
 * assault-settle banks the server-computed damage into the clan's pool. Gated off by
 * default — 404 unless ENABLE_CLAN_BOSS==='1'. Body: { hostName, allies?: string[] }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();
    let preparedParty: { id: string; requestId: string } | null = null;
    let clanMarker: { requestId: string; proposedRunId: string; members: string[]; published: boolean } | null = null;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = safeName(String(body.hostName ?? ''));
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(body.requestId)
            ? body.requestId
            : '';
        if (!hostName || !requestId) return res.status(400).json({ error: 'Invalid host name or request ID.' });
        if (!enforceRateLimit(req, res, 'clan-boss-assault-start', 10, 60_000, hostName)) return;

        const identity = await authedPlayerOrAdmin(req, hostName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName) return res.status(403).json({ error: 'Can only start your own assault.' });

        const hostRec = await kv.get<Record<string, unknown>>(`save:${hostName}`);
        const hostChar = hostRec?.character as Record<string, unknown> | undefined;
        if (!hostChar) return res.status(400).json({ error: 'Your save was not found.' });
        const clanName = typeof hostChar.clan === 'string' ? hostChar.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to raid the clan boss.' });

        const now = Date.now();
        const weekId = clanBossWeekId(now);
        const week = await loadClanBossWeek(weekId);
        if (!week || week.endsAt <= now) return res.status(400).json({ error: 'No clan boss is active right now.' });

        const boss = resolveClanBossDef(week);
        const floor = boss ? getFloor(boss.floorId) : undefined;
        if (!boss || !floor) return res.status(500).json({ error: 'Clan boss floor missing.' });

        // Clan record → roster (member count for the pool; ally membership check).
        const clanRec = await kv.get<{ members?: Array<{ name?: unknown }> }>(`save:clan-${clanSlug(clanName)}`);
        const members = Array.isArray(clanRec?.members) ? clanRec!.members! : [];
        const memberCount = members.length || 1;
        const memberSlugs = members.map(m => safeName(String(m?.name ?? ''))).filter(Boolean);

        // New operation parties are accepted + readied server-side. If the party
        // feature is rolled back, the compatibility path is truthful SOLO — never
        // client-selected offline clanmates presented as live humans.
        const partyId = clanBossPartiesEnabled() && typeof body.partyId === 'string' ? body.partyId : '';
        const loadedParty = partyId ? await loadParty(partyId) : null;
        if (partyId && !loadedParty) return res.status(404).json({ error: 'That operation party no longer exists.' });
        const requestedAllies = loadedParty?.members.map((member) => member.slug).filter((slug) => slug !== hostName) ?? [];
        const partySlugs = selectClanBossParty(hostName, requestedAllies, memberSlugs, loadedParty ? CB_MAX_PARTY : 1);
        if (!partySlugs) {
            return res.status(403).json({ error: 'You are no longer a member of that clan.' });
        }
        if (!identity.admin && await findTowerBattleStartConflict(partySlugs)) {
            return res.status(409).json(towerBattleActiveErrorBody());
        }
        if (loadedParty && (loadedParty.clanName !== clanName || loadedParty.leaderSlug !== hostName || loadedParty.weekId !== weekId || loadedParty.bossId !== boss.id)) {
            return res.status(409).json({ error: 'That party no longer matches this Clan Boss operation.' });
        }

        // Seal every party member from their authoritative save (host also supplies the
        // client-computed pvpItems/passives). All are LIVE humans; absent ones AFK-pass.
        const hostLoadout = (body.hostLoadout && typeof body.hostLoadout === 'object') ? body.hostLoadout as Record<string, unknown> : {};
        // Admin-authored item definitions, loaded ONCE for the whole squad (the
        // read is memoized anyway). Without it an admin-authored equipped item
        // resolves to nothing and is silently dropped — see api/_admin-item-catalog.ts.
        const admin = await loadAdminCombatContent();
        const squad: SquadMemberInput[] = [];
        for (let i = 0; i < partySlugs.length; i++) {
            const slug = partySlugs[i]!;
            const rec = await augmentSaveWithForgedDefs(slug === hostName ? hostRec : await kv.get<Record<string, unknown>>(`save:${slug}`));
            const char = rec?.character as Record<string, unknown> | undefined;
            if (!char) { if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' }); continue; }
            squad.push({
                // Contiguous ids even when an ally save is skipped above.
                id: `sq-${squad.length}`, name: String(char.name ?? slug), ownerSlug: slug, ai: false,
                character: sealTowerFighter(char, rec!, slug === hostName ? hostLoadout : {}, admin),
                itemCharges: sealTowerItemCharges(char),
            });
        }
        if (squad.length === 0) return res.status(400).json({ error: 'No valid party members.' });
        const sealedPartySlugs = squad.map(s => s.ownerSlug);
        const proposedRunId = `cboss-${randomUUID().replace(/-/g, '')}`;
        const proposedSeed = randomInt(1, 0x7fffffff);

        const marker = await claimClanBossBattleMarkers({ requestId, runId: proposedRunId, members: sealedPartySlugs });
        if (!marker.ok) {
            return res.status(409).json({
                error: 'One or more operation members is already in another active battle.',
                errorCode: marker.code,
                members: marker.members,
            });
        }
        clanMarker = { requestId, proposedRunId, members: marker.members, published: false };

        if (loadedParty) {
            if (sealedPartySlugs.length !== loadedParty.members.length || sealedPartySlugs.some((slug) => !loadedParty.members.some((member) => member.slug === slug))) {
                await releaseClanBossStartMarkers(requestId, proposedRunId, clanMarker.members);
                clanMarker = null;
                return res.status(409).json({ error: 'A party member save is unavailable. Remove them or try again after they reconnect.' });
            }
            const prepared = await preparePartyStart({
                partyId: loadedParty.id,
                leaderSlug: hostName,
                requestId,
                expectedVersion: Number(body.expectedVersion),
            });
            if (!prepared.ok) {
                await releaseClanBossStartMarkers(requestId, proposedRunId, clanMarker.members);
                clanMarker = null;
                return res.status(prepared.status).json({ error: prepared.error, errorCode: prepared.code, party: prepared.party });
            }
            preparedParty = { id: loadedParty.id, requestId };
        }

        // Bind one client request to one attempt/run under the progress lock.
        // Re-check attempts + not-already-killed only for a new request.
        const progressKey = clanBossProgressKey(weekId, clanName);
        const fingerprint = createHash('sha256').update(JSON.stringify({ hostName, party: sealedPartySlugs, hostLoadout })).digest('hex');
        const reserved = await withKvLock(progressKey, async () => {
            const progress = (await loadClanBossProgress(weekId, clanName)) ?? newClanBossProgress(clanName, week, memberCount);
            const prior = (progress.startRequests ?? []).find((entry) => entry.host === hostName && entry.requestId === requestId);
            if (prior) {
                const replay = reserveAttemptForRequest(progress, {
                    requestId, host: hostName, runId: proposedRunId, party: sealedPartySlugs,
                    fingerprint, seed: proposedSeed, bossHp: 0, at: now,
                });
                if (!replay.ok) return { ok: false as const, conflict: true as const, error: 'That request ID was already used for another Clan Boss party.' };
                return { ok: true as const, replayed: true, receipt: replay.receipt };
            }
            if (progress.killedAt || progress.pool <= 0) return { ok: false as const, error: 'Your clan already defeated this week\'s boss.' };
            if (clanBossAttemptsLeft(progress, hostName) <= 0) return { ok: false as const, error: 'You\'ve used all your assaults this week.' };
            const receipt = {
                requestId, host: hostName, runId: proposedRunId, party: sealedPartySlugs,
                fingerprint, seed: proposedSeed,
                bossHp: Math.max(1, Math.min(progress.pool, CB_ASSAULT_HP_CAP)),
                at: now,
            };
            const next = reserveAttemptForRequest(progress, receipt);
            if (!next.ok) return { ok: false as const, conflict: true as const, error: 'That request ID was already used for another Clan Boss party.' };
            await saveClanBossProgress(next.progress);
            return { ok: true as const, replayed: false, receipt: next.receipt };
        }, { failClosed: true });
        if (!reserved.ok) {
            if (preparedParty) await reopenPartyStart(preparedParty.id, preparedParty.requestId);
            if (clanMarker) await releaseClanBossStartMarkers(requestId, proposedRunId, clanMarker.members);
            clanMarker = null;
            return res.status('conflict' in reserved ? 409 : 400).json({ error: reserved.error });
        }

        // Mint the tower session on the clan-boss floor.
        const { runId, seed, bossHp } = reserved.receipt;
        let session = await readSession(runId);
        if (!session) {
            session = buildTowerEncounter({ floor, squad, runId, seed, partySize: squad.length, now: reserved.receipt.at });
            // Override the boss's HP to the SHARED pool (capped per assault) so it's
            // the persistent clan boss being chipped, not a fresh chunk.
            configureClanBossEncounter(session, floor, bossHp);
            // Arm the standard-PvE hit guard. MUST precede startRound/runAiUntilHuman,
            // and MUST follow the shared-pool HP override above so it never touches
            // the persistent clan-boss HP.
            //
            // Guard only — no HP/stat band. The boss HP is the SHARED clan pool
            // (authoritative, chipped across assaults) and the floor is already
            // party-scaled, so a level-keyed multiplier here would both corrupt the
            // pool and double-dip.
            // Give the AI its jutsu mastery — without this it casts at 30% (step C).
            // Must follow the guard above, and precede startRound like it.
            startRound(session);
            runAiUntilHuman(session, floor, makeRng(seed));
            stampTurnClock(session, reserved.receipt.at);
            try {
                await writeSession(session);
            } catch (publishError) {
                let published: TowerSession | null;
                try {
                    published = await readSession(runId);
                } catch {
                    // Publication is uncertain: keep the cross-mode markers and
                    // prepared party so the same idempotent request can recover.
                    clanMarker.published = true;
                    throw publishError;
                }
                if (!published) throw publishError;
                session = published;
            }
        }
        clanMarker.published = true;
        await bindClanBossBattleMarkers({ requestId, runId, members: clanMarker.members });
        // Invite EVERY party member — incl. the host — so anyone (incl. the host after
        // an accidental exit) can rediscover + rejoin an unfinished assault via
        // fetchMyRun, rather than losing the reserved attempt. Clan-boss runs use the
        // `cboss-` runId prefix, which the Battle Towers lobby filters out so they only
        // surface in the Clan Boss tab.
        for (const slug of sealedPartySlugs) await setTowerInvite(slug, runId).catch(() => undefined);

        // Tag the run as a clan-boss assault so settle knows where to bank it.
        if (!(await loadAssault(runId))) {
            await saveAssault({ runId, weekId, clanName, host: hostName, party: reserved.receipt.party, partyId: loadedParty?.id, bossId: boss.id, createdAt: reserved.receipt.at });
        }

        if (preparedParty) await activatePartyStart(preparedParty.id, preparedParty.requestId, runId);
        captureServerProductEvent('clan_boss_operation_started', {
            partySizeBucket: String(sealedPartySlugs.length),
            mode: loadedParty ? 'operation-party' : 'solo-compatibility',
        });

        return res.status(200).json({ runId, session, replayed: reserved.replayed, boss: { id: boss.id, name: boss.name, icon: boss.icon } });
    } catch (err) {
        if (preparedParty && !clanMarker?.published) {
            await reopenPartyStart(preparedParty.id, preparedParty.requestId).catch(() => undefined);
        }
        if (clanMarker && !clanMarker.published) {
            await releaseClanBossStartMarkers(clanMarker.requestId, clanMarker.proposedRunId, clanMarker.members).catch(() => undefined);
        }
        console.error('[clan-boss/assault-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
