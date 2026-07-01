import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';

/*
 * /api/village/claim-war-crate  — POST only  (P0.2c, warCrateServerAuth.v1)
 *
 * Server-authoritative grant of the Legendary War Crate a village's players earn
 * when their village WINS a village war. Today the client appends the crate inline
 * (Arena.winBattle via recordVillageWarRaid, + the claimPendingWarCrates login
 * sweep); the crate is a legendary loot container with no per-item sanitizer cap,
 * so a crafted client can fabricate it. This endpoint moves the GRANT authority to
 * the server: it validates the crate against the AUTHORITATIVE shared war record
 * (api/world-state.ts stamps winnerVillage only when the enemy village's HP is
 * actually 0 and freezes the record once ended — a losing Kage can't self-declare),
 * then grants under the save lock with claimedWarCrateIds idempotency.
 *
 * Contract: { playerName, warCrateId } → { ok, granted, reason }. Idempotent
 * (claimedWarCrateIds dedup). The client (behind warCrateServerAuth.v1) calls this
 * instead of appending inline and mirrors `granted`; on any failure it falls back
 * to the local grant so a server hiccup never costs a legitimately-won crate.
 */

// Mirrors LEGENDARY_WAR_CRATE_ID / WAR_CRATE_EXPIRY_MS in
// shinobij.client/src/constants/game.ts, and VILLAGE_WAR_KEY_PREFIX in
// api/world-state.ts. KEEP IN SYNC (all three are literals there too).
const LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';
const WAR_CRATE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';

// Canonical crate id is `war-crate-${warId}` where warId is `${slugA}-vs-${slugB}`
// (villageWarId: lowercase alphanumeric village slugs). Strict shape so the warId
// we splice into the KV key can't be used to read an unrelated key.
const WAR_CRATE_ID_RE = /^war-crate-([a-z0-9]+-vs-[a-z0-9]+)$/;

export type VillageWarLite = {
    id: string;
    villages: [string, string];
    winnerVillage?: string;
    endedAt?: number;
    warCrateId?: string;
};

/** Extract the warId from a canonical `war-crate-${warId}` id, or null if the id
 *  is malformed (so it can never be spliced into a KV key). Pure. */
export function parseWarCrateWarId(warCrateId: string): string | null {
    const m = WAR_CRATE_ID_RE.exec(String(warCrateId ?? ''));
    return m ? m[1] : null;
}

/** Pure eligibility decision for a war-crate claim. `granted` only when the war is
 *  a real, ended, unexpired win by the claimant's village and the crate isn't already
 *  claimed. Every gate reads SERVER-STAMPED war fields (winnerVillage/endedAt/warCrateId
 *  are never client-writable — see api/world-state.ts) so this can't be forged. */
export function warCrateClaimDecision(
    war: VillageWarLite | null,
    warCrateId: string,
    village: string,
    claimedIds: readonly string[],
    now: number,
): { granted: boolean; reason: string } {
    if (!parseWarCrateWarId(warCrateId)) return { granted: false, reason: 'bad-crate-id' };
    if (!war || !war.endedAt || !war.winnerVillage || war.warCrateId !== warCrateId) {
        return { granted: false, reason: 'no-won-war' };
    }
    if (now - Number(war.endedAt) > WAR_CRATE_EXPIRY_MS) return { granted: false, reason: 'expired' };
    if (String(village).trim() !== war.winnerVillage) return { granted: false, reason: 'not-winner' };
    if (claimedIds.includes(warCrateId)) return { granted: false, reason: 'already-claimed' };
    return { granted: true, reason: 'granted' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const warCrateId = String(body.warCrateId ?? '').trim().slice(0, 80);
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own war crate.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'claim-war-crate', 20, 60_000, identity.name))) return;

        const warId = parseWarCrateWarId(warCrateId);
        if (!warId) return res.status(200).json({ ok: true, granted: false, reason: 'bad-crate-id' });

        // Read the AUTHORITATIVE war record. winnerVillage / endedAt / warCrateId are
        // all server-stamped (world-state.ts) — never client-writable. The record is
        // frozen once ended, so it's safe to read before taking the save lock.
        const war = await kv.get<VillageWarLite>(`${VILLAGE_WAR_KEY_PREFIX}${warId}`);

        // Decide + grant under the save lock: village + claimedWarCrateIds (the
        // eligibility inputs) are re-read fresh, and the crate is appended only on a
        // granted decision. failClosed — this mints a legendary item, so we abort
        // rather than race an unlocked write. Idempotent: claimedWarCrateIds dedup.
        const saveKey = `save:${playerName}`;
        const outcome = await withKvLock(saveKey, async () => {
            const fresh = await kv.get<Record<string, unknown>>(saveKey);
            const c = (fresh?.character ?? null) as Record<string, unknown> | null;
            if (!fresh || !c) return { granted: false as const, reason: 'no-save' };
            const village = String(c.village ?? '').trim();
            const claimed = Array.isArray(c.claimedWarCrateIds) ? (c.claimedWarCrateIds as unknown[]).map(String) : [];
            const decision = warCrateClaimDecision(war, warCrateId, village, claimed, Date.now());
            if (!decision.granted) return decision;
            const inventory = Array.isArray(c.inventory) ? [...(c.inventory as unknown[])] : [];
            inventory.push(LEGENDARY_WAR_CRATE_ID);
            const updated = bumpSaveVersion({
                ...fresh,
                character: { ...c, inventory, claimedWarCrateIds: [...claimed, warCrateId] },
            });
            await kv.set(saveKey, mergePreservingImages(updated, fresh));
            return { granted: true as const, reason: 'granted' };
        }, { failClosed: true });

        return res.status(200).json({ ok: true, ...outcome });
    } catch (err) {
        console.error('[village/claim-war-crate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
