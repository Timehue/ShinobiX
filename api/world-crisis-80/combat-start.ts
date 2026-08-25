import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { sealPveAiMastery } from '../_pve-ai-mastery.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases } from '../towers/_battle-lease.js';
import { initializeTowerActionVersion } from '../towers/_action-idempotency.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { makeRng } from '../towers/_sim.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { readSession, writeSession } from '../towers/_tower-store.js';
import { WORLD_CRISIS_80_ID, WORLD_CRISIS_80_TOWER_ID } from '../../shared/world-crisis-80.js';
import { activeWorldCrisis80Encounter } from './_state.js';
import { buildWorldCrisis80EnemyTemplates, buildWorldCrisis80Floor } from './_encounter.js';

type StartReceipt = { requestId: string; sourceId: string; runId: string; at: number };
const receiptKey = (playerName: string, requestId: string) => `world:crisis:${WORLD_CRISIS_80_ID}:start:${playerName}:${requestId}`;

function statusFor(error: unknown): number {
    const message = error instanceof Error ? error.message : '';
    if (/not-active|village-secured|encounter-stale|village-invalid/.test(message)) return 409;
    return 500;
}

/** POST /api/world-crisis-80/combat-start
 *
 * Mints one server-sealed Tower-engine encounter containing one human and
 * exactly three AI actors. The request names only the village source selector;
 * opponent stats, kits, names, floor rules, and settlement binding are rebuilt
 * from server-owned state. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    let claimedRunId = '';
    let claimedMembers: string[] = [];
    let published = false;
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const sourceId = String(body.sourceId ?? '').trim().slice(0, 160);
        const requestId = String(body.requestId ?? '').trim().slice(0, 96);
        if (!playerName || !sourceId || !/^[A-Za-z0-9_-]{8,96}$/.test(requestId)) {
            return res.status(400).json({ error: 'Missing or invalid crisis battle request.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only deploy as yourself.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-crisis-80-combat-start', 20, 60_000, playerName))) return;

        const hostLoadout = body.hostLoadout && typeof body.hostLoadout === 'object' && !Array.isArray(body.hostLoadout)
            ? body.hostLoadout as Record<string, unknown>
            : {};
        const result = await withKvLock(`world:crisis:${WORLD_CRISIS_80_ID}:start-lock:${playerName}`, async () => {
            const prior = await kv.get<StartReceipt>(receiptKey(playerName, requestId));
            if (prior) {
                if (prior.sourceId !== sourceId) return { status: 409, body: { error: 'That request id is bound to another crisis deployment.' } };
                const existing = await readSession(prior.runId);
                if (existing?.worldCrisis80?.sourceId === sourceId) {
                    return { status: 200, body: { ok: true, replayed: true, runId: prior.runId, session: existing } };
                }
            }

            const record = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
            const character = record?.character as Record<string, unknown> | undefined;
            if (!record || !character) return { status: 404, body: { error: 'Your save was not found.' } };
            const encounter = await activeWorldCrisis80Encounter({ character, sourceId, path: 'shinobi' });

            const runId = `wcr80-${randomUUID().replace(/-/g, '')}`;
            const lease = await claimTowerBattleLeases({ runId, members: [playerName] });
            if (!lease.ok) return { status: 409, body: { error: 'Finish or recover your active battle before defending the witness ledger.', errorCode: lease.code } };
            claimedRunId = runId;
            claimedMembers = lease.members;

            const now = Date.now();
            const seed = randomInt(1, 0x7fffffff);
            const admin = await loadAdminCombatContent();
            const squad: SquadMemberInput[] = [{
                id: 'sq-0',
                name: String(character.name ?? playerName),
                ownerSlug: playerName,
                ai: false,
                character: sealTowerFighter(character, record, hostLoadout, admin),
                itemCharges: sealTowerItemCharges(character),
            }];
            const floor = buildWorldCrisis80Floor(encounter);
            const session = buildTowerEncounter({
                floor,
                squad,
                runId,
                seed,
                partySize: 1,
                now,
                towerId: WORLD_CRISIS_80_TOWER_ID,
                embedFloor: true,
                enemyTemplates: buildWorldCrisis80EnemyTemplates(encounter, character.level, admin),
            });
            session.floorProvenance = {
                kind: 'embedded',
                mintedBy: 'authoritative-pve',
                contentVersion: `${WORLD_CRISIS_80_ID}.1`,
                floorId: floor.id,
            };
            session.worldCrisis80 = { crisisId: WORLD_CRISIS_80_ID, village: encounter.village, sourceId: encounter.sourceId };
            initializeTowerActionVersion(session);
            sealPveDifficultyBand(session, { mode: 'TOWER', scaleHp: false, scaleStats: false });
            sealPveAiMastery(session, { mode: 'TOWER' });
            startRound(session);
            runAiUntilHuman(session, floor, makeRng(seed));
            stampTurnClock(session, now);
            await writeSession(session);
            published = true;
            await kv.set(receiptKey(playerName, requestId), { requestId, sourceId, runId, at: now } satisfies StartReceipt, { ex: 24 * 60 * 60 });
            return { status: 200, body: { ok: true, replayed: false, runId, session } };
        }, { failClosed: true });
        return res.status(result.status).json(result.body);
    } catch (error) {
        if (claimedRunId && claimedMembers.length && !published) {
            await releaseTowerBattleLeases(claimedRunId, claimedMembers).catch(() => undefined);
        }
        console.error('[world-crisis-80/combat-start]', error);
        const status = statusFor(error);
        const message = error instanceof Error ? error.message : '';
        return res.status(status).json({
            error: status === 500 ? 'The witness-ledger defense could not be sealed.'
                : message.includes('village-secured') ? 'Your village witness ledger is already secured.'
                    : message.includes('not-active') ? 'The Hollow Gate Reckoning is not active.'
                        : 'That crisis deployment is no longer available.',
        });
    }
}
