import { clanBossRules } from '../../shared/clan-boss-rules.js';
import { claimClanBossBattleMarkers, releaseClanBossStartMarkers } from '../towers/_battle-lease.js';
import { publishClanBossStart, ClanBossStartPublicationError, clanBossStartLocatorKey, clanBossStartInputsKey, type ClanBossStartLocator } from './_start-publication.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { getFloor } from '../towers/_floor-catalog.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { readSession } from '../towers/_tower-store.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import type { SquadMemberInput } from '../towers/_encounter.js';
import { selectClanBossParty } from './_assault.js';
import { loadParty, preparePartyStart, reopenPartyStart, recoverLegacyPartyStart } from './_party.js';
import { clanBossEnabled, clanBossPartiesEnabled } from '../_release-flags.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';

import {
    CB_MAX_PARTY, clanBossAttemptsLeft,
    clanBossProgressKey, clanBossWeekId, clanSlug, loadClanBossProgress, loadClanBossWeek,
    newClanBossProgress, reserveAttemptForRequest, resolveClanBossDef, saveClanBossProgress,
} from './_storage.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import { isIncapacitated } from '../_elapsed-state.js';

/*
 * POST /api/clan-boss/assault-start — begin a co-op assault on THIS week's clan boss.
 *
 * Reserves weekly attempts under the sealed week's rules, then mints a Battle-Towers
 * session on the clan-boss floor (host + up to 3 clanmate allies). The fight runs
 * through the EXISTING /api/towers/action loop + battle screen; api/clan-boss/
 * assault-settle banks the server-computed damage into the clan's pool. Default on;
 * returns 404 when the core Clan Boss kill switch is set. Body: { hostName, allies?: string[] }.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!clanBossEnabled()) return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();
    let reservationCommitted = false;
    const claimState: { value?: { runId: string; party: string[]; weekId: string; clanName: string; host: string; requestId: string } } = {};
    let preparedParty: { id: string; requestId: string; weekId: string; clanName: string; host: string } | null = null;
    async function reopenOnlyUnpaid() {
        const prepared = preparedParty;
        if (!prepared) return;
        await withKvLock(clanBossProgressKey(prepared.weekId, prepared.clanName), async () => {
            const progress = await loadClanBossProgress(prepared.weekId, prepared.clanName);
            const paid = progress?.startRequests?.some(r => r.host === prepared.host && r.requestId === prepared.requestId);
            if (!paid) await reopenPartyStart(prepared.id, prepared.requestId);
        }, { failClosed: true });
    }
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = safeName(String(body.hostName ?? ''));
        const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(body.requestId)
            ? body.requestId
            : '';
        if (!hostName || !requestId) return res.status(400).json({ error: 'Invalid host name or request ID.' });
        if (!enforceRateLimit(req, res, 'clan-boss-assault-start-preauth', (10) * 20, 60_000)) return;

        const identity = await authedPlayerOrAdmin(req, hostName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName) return res.status(403).json({ error: 'Can only start your own assault.' });
        if (!enforceRateLimit(req, res, 'clan-boss-assault-start', 10, 60_000, identity.admin ? hostName : identity.name)) return;
        const partyId = typeof body.partyId === 'string' ? body.partyId.trim() : '';

        // Resolve a paid request before current-week, readiness, loadout or battle admission.
        const requestFingerprint = createHash('sha256').update(JSON.stringify({ partyId, hostLoadout: body.hostLoadout ?? {} })).digest('hex');
        const locator = await kv.get<ClanBossStartLocator>(clanBossStartLocatorKey(hostName, requestId));
        if (locator) {
            const paid = await loadClanBossProgress(locator.weekId, locator.clanName);
            const receipt = paid?.startRequests?.find(entry => entry.host === hostName && entry.requestId === requestId);
            if (receipt) {
                if (receipt.requestFingerprint && receipt.requestFingerprint !== requestFingerprint) return res.status(409).json({ error: 'That request ID was already used for another Clan Boss party.' });
                reservationCommitted = true;
                const originalWeek = await loadClanBossWeek(locator.weekId);
                if (!originalWeek) throw new Error('Reserved Clan Boss week unavailable.');
                return res.status(200).json({ ...(await publishClanBossStart({ receipt, week: originalWeek, clanName: locator.clanName })), replayed: true });
            }
        }

        const hostRec = await kv.get<Record<string, unknown>>(`save:${hostName}`);
        const hostChar = hostRec?.character as Record<string, unknown> | undefined;
        if (!hostChar) return res.status(400).json({ error: 'Your save was not found.' });
        const clanName = typeof hostChar.clan === 'string' ? hostChar.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to raid the clan boss.' });

        const now = Date.now();
        const weekId = clanBossWeekId(now);
        // Pre-rollout receipts have no locator. Recover the current/previous
        // week's paid request before new-admission gates, including at reset.
        for (const originalId of [weekId, clanBossWeekId(now - 7 * 86400000)]) {
            const paid = await loadClanBossProgress(originalId, clanName);
            const prior = paid?.startRequests?.find(r => r.host === hostName && r.requestId === requestId);
            if (!prior) continue;
            const originalParty = !prior.partyId && partyId ? await loadParty(partyId) : null;
            const matchesParty = originalParty?.leaderSlug === hostName && originalParty.clanName === clanName
                && originalParty.weekId === originalId && originalParty.startRequestId === requestId
                && ['starting', 'active'].includes(originalParty.status)
                && originalParty.members.length === prior.party.length && originalParty.members.every(m => prior.party.includes(m.slug));
            const receipt = matchesParty ? { ...prior, partyId: originalParty!.id } : prior;
            const loadout = body.hostLoadout && typeof body.hostLoadout === 'object' ? body.hostLoadout as Record<string, unknown> : {};
            const originalFingerprint = createHash('sha256').update(JSON.stringify({ hostName, party: receipt.party, hostLoadout: loadout })).digest('hex');
            if (receipt.fingerprint !== originalFingerprint) return res.status(409).json({ error: 'That request ID was already used for another Clan Boss party.' });
            reservationCommitted = true;
            const originalWeek = await loadClanBossWeek(originalId);
            if (!originalWeek) throw new Error('Reserved Clan Boss week unavailable.');
            let legacySquad: SquadMemberInput[] | undefined;
            if (!receipt.inputKey && !receipt.squad && !(await readSession(receipt.runId))) {
                // Old unpublished receipts never saved fighter inputs. Retain their
                // original rebuild behavior and their sealed week/party/HP/seed.
                const [admin, records] = await Promise.all([loadAdminCombatContent(), kv.mget<Record<string, unknown>[]>(...receipt.party.map(s => `save:${s}`))]);
                legacySquad = [];
                for (const [i, slug] of receipt.party.entries()) {
                    const record = await augmentSaveWithForgedDefs(records[i] ?? null);
                    const character = record?.character as Record<string, unknown> | undefined;
                    if (!character) throw new Error('Reserved legacy participant save unavailable.');
                    legacySquad.push({ id: `sq-${i}`, name: String(character.name ?? slug), ownerSlug: slug, ai: false,
                        character: sealTowerFighter(character, record!, slug === hostName ? loadout : {}, admin), itemCharges: sealTowerItemCharges(character) });
                }
            }
            return res.status(200).json({ ...(await publishClanBossStart({ receipt, week: originalWeek, clanName, squad: legacySquad,
                recoverPartyId: !receipt.partyId && partyId && !receipt.inputKey && !receipt.requestFingerprint ? async () => {
                    const restored = await recoverLegacyPartyStart({ partyId, requestId, host: hostName, clanName,
                        weekId: originalId, bossId: originalWeek.bossId, members: receipt.party,
                        reservedAt: receipt.at, expectedVersion: Number(body.expectedVersion) });
                    return restored?.id;
                } : undefined,
            })), replayed: true });
        }
        if (partyId && !clanBossPartiesEnabled()) {
            return res.status(409).json({ error: 'Clan Boss parties are currently unavailable. No attempt was used.', errorCode: 'parties-unavailable' });
        }
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

        // Operation parties are accepted + readied server-side. A request without
        // a party uses solo compatibility; an explicit party request never does.
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
        const allySlugs = partySlugs.filter(slug => slug !== hostName);
        const [admin, allyRecords] = await Promise.all([
            loadAdminCombatContent(),
            allySlugs.length ? kv.mget<Record<string, unknown>[]>(...allySlugs.map(slug => `save:${slug}`)) : [],
        ]);
        const recordsBySlug = new Map(allySlugs.map((slug, index) => [slug, allyRecords[index] ?? null]));
        const squad: SquadMemberInput[] = [];
        // Tower-engine fighters are sealed at FULL vitals (towers/_encounter.ts),
        // so an admitted member would walk out of the hospital into the boss at
        // full strength and spend a weekly attempt doing it. Collected here and
        // refused inside the reservation lock, on a NEW request only, so a replay
        // of an already-reserved assault still resolves (hollow-gate/start's rule).
        const admitted: string[] = [];
        for (let i = 0; i < partySlugs.length; i++) {
            const slug = partySlugs[i]!;
            const rec = await augmentSaveWithForgedDefs(slug === hostName ? hostRec : recordsBySlug.get(slug) ?? null);
            const char = rec?.character as Record<string, unknown> | undefined;
            if (!char) { if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' }); continue; }
            if (!identity.admin && isIncapacitated(char)) admitted.push(slug);
            squad.push({
                // Contiguous ids even when an ally save is skipped above.
                id: `sq-${squad.length}`, name: String(char.name ?? slug), ownerSlug: slug, ai: false,
                character: sealTowerFighter(char, rec!, slug === hostName ? hostLoadout : {}, admin),
                itemCharges: sealTowerItemCharges(char),
            });
        }
        if (squad.length === 0) return res.status(400).json({ error: 'No valid party members.' });
        const sealedPartySlugs = squad.map(s => s.ownerSlug);

        if (loadedParty) {
            if (sealedPartySlugs.length !== loadedParty.members.length || sealedPartySlugs.some((slug) => !loadedParty.members.some((member) => member.slug === slug))) {
                return res.status(409).json({ error: 'A party member save is unavailable. Remove them or try again after they reconnect.' });
            }
            const prepared = await preparePartyStart({
                partyId: loadedParty.id,
                leaderSlug: hostName,
                requestId,
                expectedVersion: Number(body.expectedVersion),
            });
            if (!prepared.ok) return res.status(prepared.status).json({ error: prepared.error, errorCode: prepared.code, party: prepared.party });
            preparedParty = { id: loadedParty.id, requestId, weekId, clanName, host: hostName };
        }

        // Bind one client request to one attempt/run under the progress lock.
        // Re-check attempts + not-already-killed only for a new request.
        const progressKey = clanBossProgressKey(weekId, clanName);
        const proposedRunId = `cboss-${randomUUID().replace(/-/g, '')}`;
        const proposedSeed = randomInt(1, 0x7fffffff);
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
            if (loadedParty) {
                const current = await loadParty(loadedParty.id);
                if (current?.status !== 'starting' || current.startRequestId !== requestId) return { ok: false as const, conflict: true as const, error: 'The party changed before reservation. No attempt was used.' };
            }
            if (admitted.length) {
                return {
                    ok: false as const,
                    conflict: true as const,
                    errorCode: 'hospitalized',
                    members: admitted,
                    error: admitted.length === 1 && admitted[0] === hostName
                        ? 'You are in the hospital. Recover before starting an assault. No attempt was used.'
                        : 'One or more party members is in the hospital. No attempt was used.',
                };
            }
            if (progress.killedAt || progress.pool <= 0) return { ok: false as const, error: 'Your clan already defeated this week\'s boss.' };
            const charged = clanBossRules(progress.rulesVersion).participantAttempts ? sealedPartySlugs : [hostName];
            const exhausted = charged.filter(slug => clanBossAttemptsLeft(progress, slug) <= 0);
            if (exhausted.length) return { ok: false as const, conflict: true as const, errorCode: 'attempts-exhausted', members: exhausted, error: 'A participating member has used all five attempts. No attempt was used.' };
            const receipt = {
                requestId, host: hostName, runId: proposedRunId, party: sealedPartySlugs,
                fingerprint, seed: proposedSeed,
                rulesVersion: progress.rulesVersion, poolAtStart: progress.pool, poolMax: progress.poolMax,
                inputKey: clanBossStartInputsKey(proposedRunId), partyId: loadedParty?.id, requestFingerprint,
                bossHp: Math.max(1, Math.min(progress.pool, clanBossRules(progress.rulesVersion).assaultHp)),
                at: now,
            };
            const next = reserveAttemptForRequest(progress, receipt);
            if (!next.ok) return { ok: false as const, conflict: true as const, error: 'That request ID was already used for another Clan Boss party.' };
            const claim = await claimClanBossBattleMarkers({ requestId: next.receipt.runId, runId: next.receipt.runId, members: next.receipt.party });
            if (!claim.ok) return { ok: false as const, conflict: true as const, errorCode: 'member-busy', members: claim.members, error: 'A party member is already in another battle. No attempt was used.' };
            claimState.value = { runId: next.receipt.runId, party: next.receipt.party, weekId, clanName, host: hostName, requestId };
            // Publish immutable build inputs before the atomic charge. Keep the shared
            // progress ledger small; orphan inputs expire without consuming a ticket.
            const inputTtl = Math.max(2 * 86400, Math.ceil((week.endsAt - now) / 1000) + 2 * 86400);
            if ((await kv.set(receipt.inputKey, { squad }, { ex: inputTtl, nx: true })) === null) throw new Error('Assault fighter snapshot unavailable.');
            // The locator precedes the charge. A failed progress write leaves a harmless locator;
            // a committed charge is discoverable across rollover and clan/loadout changes.
            if ((await kv.set(clanBossStartLocatorKey(hostName, requestId), { weekId, clanName })) === null) throw new Error('Start recovery locator unavailable.');
            await saveClanBossProgress(next.progress);
            reservationCommitted = true;
            return { ok: true as const, replayed: false, receipt: next.receipt };
        }, { failClosed: true });
        if (!reserved.ok) {
            if (preparedParty) await reopenOnlyUnpaid();
            return res.status('conflict' in reserved ? 409 : 400).json({
                error: reserved.error,
                ...('errorCode' in reserved ? { errorCode: reserved.errorCode, members: reserved.members } : {}),
            });
        }

        reservationCommitted = true;
        const published = await publishClanBossStart({ receipt: reserved.receipt, week, clanName, squad });
        captureServerProductEvent('clan_boss_operation_started', {
            partySizeBucket: String(sealedPartySlugs.length),
            mode: loadedParty ? 'operation-party' : 'solo-compatibility',
        });

        return res.status(200).json({ ...published, replayed: reserved.replayed });
    } catch (err) {
        if (err instanceof ClanBossStartPublicationError) return res.status(err.status).json({ error: err.message, errorCode: 'assault-expired' });
        // A storage response can fail after commit: confirm before releasing a paid roster.
        const claimed = claimState.value;
        if (claimed && !reservationCommitted) {
            try {
                const saved = await loadClanBossProgress(claimed.weekId, claimed.clanName);
                reservationCommitted = !!saved?.startRequests?.some(entry => entry.runId === claimed!.runId);
                if (!reservationCommitted) await releaseClanBossStartMarkers(claimed.runId, claimed.runId, claimed.party);
            } catch { reservationCommitted = true; } // uncertain writes remain recoverable, fail closed
        }
        if (preparedParty && !reservationCommitted) await reopenOnlyUnpaid().catch(() => undefined);
        console.error('[clan-boss/assault-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
