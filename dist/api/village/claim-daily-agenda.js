"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _village_agenda_js_1 = require("../_village-agenda.js");
/*
 * /api/village/claim-daily-agenda  — POST only
 *
 * Server-authoritative VILLAGE-TREASURY half of the daily-agenda reward. The old
 * flow credited the shared village treasury (+15 honorSeals / +1500 ryo / +2
 * boneCharms) via the save blob, which the village-state validator could only
 * cap, not verify — a crafted client could credit arbitrary amounts or claim
 * repeatedly (#17 credit-without-debit on the shared pool).
 *
 * This endpoint credits the FIXED treasury amounts under the village-state lock,
 * at most once per player per UTC day, gated by a server-side NX idempotency
 * marker. What this closes for the treasury is the arbitrary-amount + repeat
 * vectors (the credit-without-debit hole #17 is about).
 *
 * It ALSO credits the player's own fixed PERSONAL reward (audit #7 / Stage 3
 * Phase 2): +750 ryo, +1 boneCharm, +8 honorSeals (Vanguard only). That credit
 * runs under lock:save:<name> (the same lock the autosave takes) with its OWN
 * NX day-marker placed atomically inside the lock — exactly-once, failClosed →
 * 503/retry — so the player save can no longer be raced and a crafted client
 * can no longer claim the personal reward repeatedly or inflate it. The client
 * still adds the returned `granted` delta to its OWN balance (preserving
 * concurrent ryo gains) and re-asserts via autosave; the two converge. The
 * sanitizer stays permissive for these currencies (they have other legit
 * sources — missions/raids/hunts — until later Stage-3 phases move those too).
 * Task COMPLETION is now PARTIALLY re-verified: the server re-derives today's
 * seeded agenda (api/_village-agenda.ts, mirroring the client's seeding) and
 * authoritatively checks any task it can — currently only "control" (sectors
 * held, from world:territory:*, written solely by server endpoints). The other
 * kinds (missions/explore/ai/pet) still live in client-incremented save counters
 * and stay trusted until a server-side daily ledger lands (TODO, Stage-3).
 *
 * Body: { playerName, village }. Caller MUST be the player (or admin) and a
 * member of `village`. Rate-limited 30/min per actor.
 */
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const AGENDA_TREASURY = { honorSeals: 15, ryo: 1500, boneCharms: 2 };
// Personal reward (audit #7 / Stage 3 Phase 2). VERBATIM port of the client
// (App.tsx claimVillageAgenda): flat ryo + boneCharm for everyone; honorSeals
// only for the Vanguard profession (vanguardOnlyHonorSeals). The client's
// fateShards line is nonVanguardShardSubstitute(8) = floor(8/25) = 0, so there
// is no fateShard grant here — omitting it is a zero-balance change.
const AGENDA_PERSONAL = { ryo: 750, boneCharms: 1, honorSeals: 8 };
const CLAIM_MARKER_TTL_SEC = 2 * 24 * 60 * 60; // 2 days — comfortably past one UTC day
const AUDIT_LOG_PREFIX = 'audit:village-agenda-claim:';
function villageSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function utcDate() {
    return new Date().toISOString().slice(0, 10);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village)
            return res.status(400).json({ error: 'Missing playerName or village.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-agenda-claim', 30, 60_000, identity.name)))
            return;
        const slug = villageSlug(village);
        if (!slug)
            return res.status(400).json({ error: 'Invalid village name.' });
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${slug}`;
        // Membership: the caller's character must belong to this village (admin exempt).
        if (!identity.admin) {
            const donorRec = await _storage_js_1.kv.get(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null);
            if (!donorChar)
                return res.status(404).json({ error: 'Your save was not found.' });
            if (String(donorChar.village ?? '').trim() !== village) {
                return res.status(403).json({ error: 'You are not a member of this village.' });
            }
        }
        const date = utcDate();
        // ── Server-side task-completion check (verifiable subset) ──────────────
        // Re-derive today's seeded agenda and authoritatively verify any task the
        // server can, BEFORE crediting / placing any NX marker. Today that's only
        // "control" (sectors held): world:territory:* is written solely by server
        // endpoints, so the count can't be faked (same source as claim-map-
        // control). missions/explore/ai/pet live in client-incremented save
        // counters and stay trusted (TODO: server-side daily ledger). Rejecting
        // here (no marker placed) lets the player re-claim once they genuinely
        // meet the task. Admins skip — they may test without holding territory.
        if (!identity.admin) {
            const seededKinds = (0, _village_agenda_js_1.seededVillageAgenda)(village, date).map((task) => task.kind);
            let heldSectors = 0;
            if (seededKinds.includes('control')) {
                const territoryKeys = await _storage_js_1.kv.keys('world:territory:*');
                const territories = territoryKeys.length
                    ? (await _storage_js_1.kv.mget(...territoryKeys)).filter(Boolean)
                    : [];
                heldSectors = territories.filter((t) => String(t.ownerVillage ?? '').trim() === village).length;
            }
            const gate = (0, _village_agenda_js_1.verifyAgendaCompletion)(seededKinds, heldSectors);
            if (!gate.ok)
                return res.status(403).json({ error: gate.error });
        }
        // ── PERSONAL reward (audit #7 / Stage 3 Phase 2) ───────────────────────
        // Credit the player's OWN fixed agenda reward under lock:save:<name> (the
        // same lock the autosave takes — option A) with its OWN NX day-marker
        // placed atomically inside the lock: exactly-once, and a contention abort
        // (failClosed → 503) leaves nothing placed for a clean retry (the
        // claim-rewards pattern). Done BEFORE the treasury credit so a personal
        // 503 can't burn the treasury day-marker. The client adds the returned
        // `granted` delta to its OWN balance (not the absolute — so concurrent ryo
        // gains elsewhere survive) and re-asserts via autosave; the two converge.
        const personalMarker = `agenda-personal:${playerName.toLowerCase()}:${date}`;
        let personal;
        try {
            const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
                const rec = await _storage_js_1.kv.get(`save:${playerName}`);
                const char = (rec?.character ?? null);
                if (!rec || !char)
                    return { error: 'no-save' };
                const seals = char.profession === 'vanguard' ? AGENDA_PERSONAL.honorSeals : 0;
                const placed = await _storage_js_1.kv.set(personalMarker, { ts: Date.now() }, { nx: true, ex: CLAIM_MARKER_TTL_SEC });
                if (placed !== 'OK') {
                    return { alreadyClaimed: true, granted: { ryo: 0, boneCharms: 0, honorSeals: 0 } };
                }
                const granted = { ryo: AGENDA_PERSONAL.ryo, boneCharms: AGENDA_PERSONAL.boneCharms, honorSeals: seals };
                const nextChar = {
                    ...char,
                    ryo: num(char.ryo) + granted.ryo,
                    boneCharms: num(char.boneCharms) + granted.boneCharms,
                    honorSeals: num(char.honorSeals) + granted.honorSeals,
                };
                await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)({ ...rec, character: nextChar }, rec));
                return { alreadyClaimed: false, granted };
            }, { failClosed: true });
            if ('error' in out)
                return res.status(404).json({ error: 'Your save was not found.' });
            personal = out;
        }
        catch (e) {
            console.error('[village/claim-daily-agenda] personal credit failed', e);
            return res.status(503).json({ error: 'Could not credit your daily reward — please retry.' });
        }
        // One treasury credit per player per UTC day. NX reserve = authoritative
        // idempotency; if the marker already exists, the treasury half was claimed
        // today (the personal half above is gated independently by its own marker).
        const claimKey = `agenda-claimed:${slug}:${playerName.toLowerCase()}:${date}`;
        const reserved = await _storage_js_1.kv.set(claimKey, { ts: Date.now() }, { nx: true, ex: CLAIM_MARKER_TTL_SEC });
        if (reserved !== 'OK') {
            const state = await _storage_js_1.kv.get(villageStateKey);
            return res.status(200).json({ ok: true, alreadyClaimed: true, treasury: (state?.treasury ?? {}), personal });
        }
        // NOT failClosed (unlike the donate/transfer/collect endpoints): the NX
        // marker above is the authoritative once-per-day idempotency guard and
        // it's already consumed at this point. Throwing on lock contention would
        // burn the marker without crediting → the player loses the day's reward.
        // Falling through to run the fixed-amount credit unlocked is the safer
        // choice; the only racy writers to this treasury (other agenda claims /
        // donations) are themselves serialized, so the window is negligible.
        const treasury = await (0, _lock_js_1.withKvLock)(villageStateKey, async () => {
            const state = (await _storage_js_1.kv.get(villageStateKey)) ?? {};
            const prevT = (state.treasury ?? {});
            const nextT = {
                ...prevT,
                honorSeals: num(prevT.honorSeals) + AGENDA_TREASURY.honorSeals,
                ryo: num(prevT.ryo) + AGENDA_TREASURY.ryo,
                boneCharms: num(prevT.boneCharms) + AGENDA_TREASURY.boneCharms,
            };
            await _storage_js_1.kv.set(villageStateKey, { ...state, treasury: nextT });
            return nextT;
        });
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            village,
            player: playerName,
            granted: AGENDA_TREASURY,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({ ok: true, treasury, granted: AGENDA_TREASURY, personal });
    }
    catch (err) {
        console.error('[village/claim-daily-agenda]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
