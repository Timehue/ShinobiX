"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWarCrate = parseWarCrate;
exports.warCrateClaimDecision = warCrateClaimDecision;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
/*
 * /api/village/claim-war-crate  — POST only  (P0.2c, warCrateServerAuth.v1)
 *
 * Server-authoritative grant of the Legendary War Crate players earn when their
 * side WINS a war — both VILLAGE wars (world:war:<id>) and CLAN wars
 * (clan-war:<id>). Today the client appends the crate inline (Arena.winBattle +
 * the claimPendingWarCrates sweep); it's a legendary loot container with no
 * per-item sanitizer cap, so a crafted client can fabricate it. This endpoint
 * moves GRANT authority to the server: it validates the crate against the
 * AUTHORITATIVE war record (winnerVillage / winnerClan are stamped only when the
 * loser's HP actually hit 0, and the record is frozen once ended — a losing leader
 * can't self-declare), then grants under the save lock with claimedWarCrateIds
 * idempotency.
 *
 * Contract: { playerName, warCrateId } → { ok, granted, reason }. Idempotent. The
 * client (behind warCrateServerAuth.v1) claims via the post-poll sweep and mirrors
 * `granted`; a network/5xx failure falls back to a local grant so a legitimately-won
 * crate is never lost, while a definitive decline is respected.
 */
// Mirrors LEGENDARY_WAR_CRATE_ID / WAR_CRATE_EXPIRY_MS in
// shinobij.client/src/constants/game.ts, VILLAGE_WAR_KEY_PREFIX in
// api/world-state.ts, and CLAN_WAR_KEY_PREFIX in api/clan/war/_storage.ts. KEEP IN
// SYNC (all literals there too).
const LEGENDARY_WAR_CRATE_ID = 'legendary-war-crate';
const WAR_CRATE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const VILLAGE_WAR_KEY_PREFIX = 'world:war:';
const CLAN_WAR_KEY_PREFIX = 'clan-war:';
// Canonical crate ids: `war-crate-<warId>` (village) or `clan-war-crate-<warId>`
// (clan), where warId is `<slugA>-vs-<slugB>` (sorted lowercase-alphanumeric slugs).
// Strict shape so the warId we splice into a KV key can't read an unrelated key.
const CRATE_ID_RE = /^(clan-war-crate|war-crate)-([a-z0-9]+-vs-[a-z0-9]+)$/;
/** Parse a crate id into its war kind + warId, or null if malformed. Pure. */
function parseWarCrate(crateId) {
    const m = CRATE_ID_RE.exec(String(crateId ?? ''));
    if (!m)
        return null;
    return { kind: m[1] === 'clan-war-crate' ? 'clan' : 'village', warId: m[2] };
}
/** Pure eligibility decision. `granted` only when the war is a real, ended, unexpired
 *  win by the claimant's side and the crate isn't already claimed. Every gate reads a
 *  SERVER-STAMPED field (winner/endedAt/warCrateId are never client-writable — see
 *  api/world-state.ts + api/clan/war), so it can't be forged. */
function warCrateClaimDecision(war, crateId, claimantSide, claimedIds, now) {
    if (!parseWarCrate(crateId))
        return { granted: false, reason: 'bad-crate-id' };
    if (!war || !war.endedAt || !war.winner || war.warCrateId !== crateId) {
        return { granted: false, reason: 'no-won-war' };
    }
    if (now - Number(war.endedAt) > WAR_CRATE_EXPIRY_MS)
        return { granted: false, reason: 'expired' };
    if (String(claimantSide).trim() !== war.winner)
        return { granted: false, reason: 'not-winner' };
    if (claimedIds.includes(crateId))
        return { granted: false, reason: 'already-claimed' };
    return { granted: true, reason: 'granted' };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const warCrateId = String(body.warCrateId ?? '').trim().slice(0, 80);
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own war crate.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'claim-war-crate', 20, 60_000, identity.name)))
            return;
        const parsed = parseWarCrate(warCrateId);
        if (!parsed)
            return res.status(200).json({ ok: true, granted: false, reason: 'bad-crate-id' });
        // Read the AUTHORITATIVE war record + normalize to a winner-bearing shape. The
        // winner / endedAt / warCrateId are all server-stamped (never client-writable),
        // and the record is frozen once ended, so it's safe to read before the lock.
        let war;
        if (parsed.kind === 'village') {
            const v = await _storage_js_1.kv.get(`${VILLAGE_WAR_KEY_PREFIX}${parsed.warId}`);
            war = v ? { endedAt: v.endedAt, warCrateId: v.warCrateId, winner: v.winnerVillage } : null;
        }
        else {
            const c = await _storage_js_1.kv.get(`${CLAN_WAR_KEY_PREFIX}${parsed.warId}`);
            war = c ? { endedAt: c.endedAt, warCrateId: c.warCrateId, winner: c.winnerClan } : null;
        }
        // Decide + grant under the save lock. The claimant's SIDE (their village for a
        // village crate, their clan for a clan crate) and claimedWarCrateIds are re-read
        // fresh; the crate is appended only on a granted decision. failClosed — this
        // mints a legendary item, so we abort rather than race an unlocked write.
        const saveKey = `save:${playerName}`;
        const outcome = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const fresh = await _storage_js_1.kv.get(saveKey);
            const c = (fresh?.character ?? null);
            if (!fresh || !c)
                return { granted: false, reason: 'no-save' };
            const side = String((parsed.kind === 'village' ? c.village : c.clan) ?? '').trim();
            const claimed = Array.isArray(c.claimedWarCrateIds) ? c.claimedWarCrateIds.map(String) : [];
            const decision = warCrateClaimDecision(war, warCrateId, side, claimed, Date.now());
            if (!decision.granted)
                return { ...decision, _saveVersion: Number(fresh._saveVersion ?? 0) };
            const inventory = Array.isArray(c.inventory) ? [...c.inventory] : [];
            inventory.push(LEGENDARY_WAR_CRATE_ID);
            const updated = (0, _save_version_js_1.bumpSaveVersion)({
                ...fresh,
                character: { ...c, inventory, claimedWarCrateIds: [...claimed, warCrateId] },
            });
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, fresh));
            return { granted: true, reason: 'granted', _saveVersion: Number(updated._saveVersion ?? 0) };
        }, { failClosed: true });
        return res.status(200).json({ ok: true, ...outcome });
    }
    catch (err) {
        console.error('[village/claim-war-crate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
