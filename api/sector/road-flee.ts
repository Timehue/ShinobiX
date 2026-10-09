/*
 * POST /api/sector/road-flee: run from a road ambush, and pay for it.
 *
 * A hostile that catches the player in a sector opens a Fight/Flee choice.
 * Fighting goes through the sealed World or explore fight start as before.
 * Fleeing comes here, and the server charges the price in shared/road-flee.ts
 * (half the HP you have, part of the ryo you carry) against the settled save.
 * The client only shows that price; it never sends an amount.
 *
 * body: { playerName, fleeId, kind: 'road' }
 *     | { playerName, fleeId, kind: 'explore', sector, requestId }
 *
 *   road    : a bandit, night ninja, contract hunter, war mercenary or the
 *             roaming Weekly Boss. Nothing outside the save changes, so there
 *             is nothing to verify beyond the account: a forged call can only
 *             cost its own caller. The hostile backing off is the client's own
 *             cooldown map.
 *   explore : the battle an exploration rolled (api/world/_pending-battle.ts).
 *             That ambush is an obligation, so fleeing it is what settles it:
 *             the one-use fight marker is claimed for the flee, which refuses
 *             a later fight start for the same receipt and stops the next
 *             exploration from being bounced back to it.
 *
 * `fleeId` is minted per choice by the client. A replay of a flee that already
 * committed (a lost reply, a double tap) answers with the current totals and
 * charges nothing more.
 *
 * Deliberately NOT presence-gated: api/_sector-presence-gate.ts guards wild
 * PAYOUTS, and this is a cost. Refusing it on a stale presence row would leave
 * a player who chose to run with Fight as the only way out.
 */
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { isPlayerSaveVersionConflict } from '../save/_projected-write.js';
import {
    EXPLORE_BATTLE_MARKER_TTL_SECONDS,
    exploreBattleMarkerKey,
    ownsExploreReceipt,
} from '../missions/_generic-ai-fight-authority.js';
import { roadFleeCost, type RoadFleeCost } from '../../shared/road-flee.js';

const OPAQUE_ID = /^[A-Za-z0-9_-]{8,96}$/;
// A day, so a reply lost late in a long session still replays rather than
// charging twice. The explore marker carries its own fleeId for 31 days.
const ROAD_FLEE_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

export const roadFleeReceiptKey = (playerName: string, fleeId: string) => `road-flee:${playerName}:${fleeId}`;

type FleeReceipt = { fleeId: string; cost: RoadFleeCost; at: number };
type Reply = Record<string, unknown>;

function num(v: unknown): number {
    return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function opaqueId(v: unknown): string {
    const id = typeof v === 'string' ? v.trim() : '';
    return OPAQUE_ID.test(id) ? id : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'road-flee', 20, 60_000, identity.name))) return;

        const kind = body.kind === 'explore' ? 'explore' : body.kind === 'road' ? 'road' : '';
        const fleeId = opaqueId(body.fleeId);
        if (!kind || !fleeId) return res.status(400).json({ error: 'Missing flee details.' });
        const requestId = kind === 'explore' ? opaqueId(body.requestId) : '';
        const sector = Math.floor(num(body.sector));
        if (kind === 'explore' && (!requestId || !Number.isSafeInteger(sector) || sector < 1 || sector > 66)) {
            return res.status(400).json({ error: 'Missing ambush details.' });
        }

        const receiptKey = roadFleeReceiptKey(playerName, fleeId);
        const committed = await mutatePlayerSave<Reply>(playerName, async ({ character: char, record, saveKey }) => {
            const totals = { hp: num(char.hp), ryo: num(char.ryo) };
            const answer = (reply: Reply) => ({ ok: true as const, write: false, character: char, value: reply });

            const prior = await kv.get<FleeReceipt>(receiptKey);
            if (prior?.fleeId === fleeId) return answer({ ok: true, replay: true, cost: prior.cost, totals });

            const now = Date.now();
            let marker: Record<string, unknown> | null = null;
            const markerKey = exploreBattleMarkerKey(playerName, requestId);
            if (kind === 'explore') {
                if (!(await ownsExploreReceipt(kv, playerName, char, requestId, sector))) {
                    return answer({ ok: false, reason: 'invalid-encounter', error: 'That ambush is no longer on the road.' });
                }
                marker = { playerName, fleeId, fled: true, at: now };
                const claimed = await kv.set(markerKey, marker, { ex: EXPLORE_BATTLE_MARKER_TTL_SECONDS, nx: true });
                if (claimed !== 'OK') {
                    const existing = await kv.get<Record<string, unknown>>(markerKey);
                    if (existing?.fleeId !== fleeId) {
                        return answer({ ok: false, reason: 'already-resolved', error: existing?.token
                            ? 'That fight has already begun.'
                            : 'That ambush has already been settled.' });
                    }
                }
            }

            const cost = roadFleeCost(char.hp, char.ryo, char.level);
            const receipt: FleeReceipt = { fleeId, cost, at: now };
            const handBack = async () => {
                await kv.delIfEqual(receiptKey, receipt);
                if (marker) await kv.delIfEqual(markerKey, marker);
            };
            try {
                await kv.set(receiptKey, receipt, { ex: ROAD_FLEE_RECEIPT_TTL_SECONDS });
            } catch (error) {
                await handBack().catch(() => undefined);
                throw error;
            }
            // Only the charged vitals are written; a value the save never held
            // as a number is left exactly as it was rather than becoming 0.
            const fled = {
                ...char,
                ...(cost.hp > 0 ? { hp: totals.hp - cost.hp } : {}),
                ...(cost.ryo > 0 ? { ryo: totals.ryo - cost.ryo } : {}),
            };
            return {
                ok: true,
                character: fled,
                value: { ok: true, cost, totals: { hp: num(fled.hp), ryo: num(fled.ryo) } },
                // A lost compare-and-set charged nothing, so the flee is not
                // spent either: hand back the receipt and the ambush marker.
                onConflict: handBack,
                // A failed write may or may not have landed. Hand back only when
                // the stored save provably still holds the version this read, so
                // a retry is charged; an unreadable or moved save keeps both, so
                // a flee that DID land is never charged twice.
                onUnconfirmedWrite: async () => {
                    const stored = await kv.get<Record<string, unknown>>(saveKey).catch(() => undefined);
                    if (stored && Number(stored._saveVersion ?? 0) === Number(record._saveVersion ?? 0)) await handBack();
                },
            };
        });
        if (!committed.ok) {
            return committed.status === 404
                ? res.status(404).json({ error: 'Your save was not found.' })
                : res.status(committed.status).json({ error: committed.error });
        }
        // Totals ride with the version they were read from; a refusal changed nothing.
        return res.status(200).json(committed.value.ok === true
            ? { ...committed.value, _saveVersion: committed._saveVersion }
            : committed.value);
    } catch (err) {
        if (err instanceof LockContendedError || isPlayerSaveVersionConflict(err)) {
            return res.status(503).json({ error: 'The road is busy - please retry.' });
        }
        console.error('[sector/road-flee]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
