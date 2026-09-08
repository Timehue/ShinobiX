import { safeLogValue } from "../_safe-log.js";
import type { VercelRequest, VercelResponse } from "../_vercel.js";
import { authedPlayerOrAdmin } from "../_auth.js";
import { enforceRateLimitKv } from "../_ratelimit.js";
import { cors, safeName } from "../_utils.js";
import { mutatePlayerSave } from "../save/_mutate-player-save.js";
import { academyNarrativeRecordPatch, applyAcademyNarrativeAction, type AcademyNarrativeAction } from "./_academy-narrative.js";
import { kv } from '../_storage.js';
import { onlineStore } from '../_realtime/online-store.js';
import { engagedInWorldDuel } from '../_realtime/world-duel-engagement.js';
import { getTravelLease, settleMaturedTravelForAction, travelLeaseReceipt } from '../_realtime/travel-lease.js';

const ACTIONS = new Set<AcademyNarrativeAction>(["incident", "trace", "seal", "complete", "skip"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).end();
    try {
        const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ""));
        const action = String(body.action ?? "") as AcademyNarrativeAction;
        if (!playerName || !ACTIONS.has(action)) return res.status(400).json({ error: "Invalid Academy narrative request." });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: "Authentication required." });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: "Can only update your own Academy journey." });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, "academy-narrative", 30, 60_000, identity.name))) return;
        if (action === 'trace' || action === 'complete') await settleMaturedTravelForAction(playerName);
        const result = await mutatePlayerSave(playerName, async ({ character, record }) => {
            const applied = applyAcademyNarrativeAction(character, record, action, body.sector);
            if (!applied.ok) return applied;
            // A completed ceremony is a replay, not a reusable field escape.
            const recordPatch = applied.changed ? academyNarrativeRecordPatch(record, action) : undefined;
            if (recordPatch) {
                const travel = await getTravelLease(playerName);
                if (travel && (travel.arrivalAt > Date.now() || record.worldTravelReceipt !== travelLeaseReceipt(travel))) {
                    return { ok: false as const, status: 409, error: 'Finish travelling before completing the Academy path.' };
                }
                if (await engagedInWorldDuel(kv, playerName, onlineStore.get(playerName))) {
                    return { ok: false as const, status: 409, error: 'Finish the world duel before returning to the Academy.' };
                }
                recordPatch.currentTile = null;
            }
            return {
                ok: true as const,
                character: applied.character,
                value: { action, replayed: !applied.changed && !recordPatch },
                recordPatch,
                write: applied.changed || Boolean(recordPatch),
            };
        });
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        if (action === 'complete' && !result.value.replayed) {
            const live = onlineStore.get(playerName);
            if (live) live.locationUnverified = true;
        }
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    } catch (error) {
        console.error("[player/academy-narrative]", safeLogValue(error));
        return res.status(500).json({ error: "Internal server error." });
    }
}
