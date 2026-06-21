"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = __importDefault(require("node:crypto"));
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const notify_js_1 = require("../_realtime/notify.js");
const _core_js_1 = require("./_core.js");
/*
 * Global Pet Ladders — Pet Coliseum (1v1) + Pet Tactical (4v4). A Sword-x-Staff
 * style positional ladder (rank 1..N over real players) with OFFLINE defense:
 *   GET  ?mode=coliseum|tactical[&top=N]   → { ladder, you, notifications }
 *   POST { action:'defense', mode, petIds } → seal your defending pet/team (owned)
 *   POST { action:'offer',   mode }         → 3 close-above opponents (+ AI fill)
 *   POST { action:'challenge', mode, targetId } → server-authoritative fight + swap
 *   POST { action:'clearNotify' }           → clear your ladder notifications
 *
 * SERVER-AUTHORITATIVE: the winner is recomputed from a server-minted seed + the
 * sealed rosters via the ported deterministic engines (_core.resolve*). The client
 * gets the seed + sealed rosters back ONLY to replay the cinematic — never trusted.
 * No currency/XP is paid; the only stake is a leaderboard position.
 */
const asMode = (v) => (v === 'coliseum' || v === 'tactical' ? v : null);
const orderKey = (mode) => `petladder:${mode}`;
const defKey = (mode, slug) => `petladder:${mode}:def:${(0, _utils_js_1.safeName)(slug)}`;
const notifyKey = (slug) => `petladder:notify:${(0, _utils_js_1.safeName)(slug)}`;
const dailyKey = (mode, slug, day) => `petladder:${mode}:daily:${(0, _utils_js_1.safeName)(slug)}:${day}`;
const lastKey = (mode, slug) => `petladder:${mode}:last:${(0, _utils_js_1.safeName)(slug)}`; // last opponent fought → no back-to-back rematch
const dayStamp = () => new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
const MAX_LIST = 200;
const NOTIFY_TTL = 7 * 24 * 3600;
const LAST_TTL = 48 * 3600;
function aiOfferSummary(mode, i) {
    if (mode === 'tactical') {
        const t = _core_js_1.AI_TACTICAL[i % _core_js_1.AI_TACTICAL.length];
        return { kind: 'ai', id: `ai:${i}`, name: t.name, rank: null, summary: t.pets.map(_core_js_1.petLite) };
    }
    const p = _core_js_1.AI_COLISEUM[i % _core_js_1.AI_COLISEUM.length];
    return { kind: 'ai', id: `ai:${i}`, name: p.name, rank: null, summary: [(0, _core_js_1.petLite)(p)] };
}
const aiDefense = (mode, i) => (mode === 'tactical' ? (0, _core_js_1.aiTacticalDefense)(i) : (0, _core_js_1.aiColiseumDefense)(i));
async function appendNotify(slug, ev) {
    const key = notifyKey(slug);
    await (0, _lock_js_1.withKvLock)(key, async () => {
        const list = (await _storage_js_1.kv.get(key)) ?? [];
        await _storage_js_1.kv.set(key, [...list, ev].slice(-20), { ex: NOTIFY_TTL });
    });
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    // ── GET: ladder list + the viewer's standing ──────────────────────────────
    if (req.method === 'GET') {
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const me = identity.admin ? (0, _utils_js_1.safeName)(String(req.query.name ?? '')) : identity.name;
        const mode = asMode(req.query.mode);
        if (!mode)
            return res.status(400).json({ error: 'Invalid mode.' });
        const topRaw = Number(req.query.top);
        const limit = Number.isInteger(topRaw) && topRaw > 0 && topRaw <= 100 ? topRaw : MAX_LIST;
        const order = (await _storage_js_1.kv.get(orderKey(mode))) ?? [];
        const myIdx = me ? order.findIndex((e) => e.slug === me) : -1;
        const myDef = me ? await _storage_js_1.kv.get(defKey(mode, me)) : null;
        const usedToday = me ? Number((await _storage_js_1.kv.get(dailyKey(mode, me, dayStamp()))) ?? 0) : 0;
        const notifications = me ? ((await _storage_js_1.kv.get(notifyKey(me))) ?? []) : [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            mode,
            total: order.length,
            ladder: (0, _core_js_1.projectLadder)(order).slice(0, limit),
            you: {
                rank: myIdx >= 0 ? myIdx + 1 : null,
                hasDefense: !!myDef,
                defense: myDef ? myDef.pets.map(_core_js_1.petLite) : null,
                challengesLeft: Math.max(0, _core_js_1.DAILY_CHALLENGES - usedToday),
                band: _core_js_1.CLIMB_BAND,
            },
            notifications,
        });
    }
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, action } = (body ?? {});
        if (!name || !action)
            return res.status(400).json({ error: 'Missing name or action.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name))
            return res.status(403).json({ error: 'Cannot act as another player.' });
        const me = identity.admin ? (0, _utils_js_1.safeName)(name) : identity.name;
        const now = Date.now();
        if (action === 'clearNotify') {
            await _storage_js_1.kv.del(notifyKey(me));
            return res.status(200).json({ ok: true });
        }
        const mode = asMode(body.mode);
        if (!mode)
            return res.status(400).json({ error: 'Invalid mode.' });
        // ── Set / replace your sealed defense (ownership-validated) ────────────
        if (action === 'defense') {
            const count = (0, _core_js_1.petsForMode)(mode);
            const save = await _storage_js_1.kv.get(`save:${me}`);
            const owned = Array.isArray(save?.character?.pets) ? save.character.pets : [];
            const pets = (0, _core_js_1.chooseOwnedLadderPets)(owned, body.petIds, count);
            if (!pets)
                return res.status(400).json({ error: count === 1 ? 'Pick a pet you own.' : `Pick ${count} pets you own.` });
            const displayName = String(save?.character?.name ?? me).slice(0, 40);
            const village = typeof save?.character?.village === 'string' ? save.character.village : undefined;
            const def = { slug: me, name: displayName, village, mode, pets, roles: (0, _core_js_1.ladderRoles)(pets), updatedAt: now };
            await _storage_js_1.kv.set(defKey(mode, me), def);
            // Keep the public list summary fresh if I'm already ranked.
            await (0, _lock_js_1.withKvLock)(orderKey(mode), async () => {
                const order = (await _storage_js_1.kv.get(orderKey(mode))) ?? [];
                const i = order.findIndex((e) => e.slug === me);
                if (i >= 0) {
                    order[i] = { ...order[i], name: displayName, village, summary: pets.map(_core_js_1.petLite), updatedAt: now };
                    await _storage_js_1.kv.set(orderKey(mode), order);
                }
            });
            return res.status(200).json({ ok: true, defense: pets.map(_core_js_1.petLite) });
        }
        // ── Build the 3-opponent offer (close-above humans + AI fill) ──────────
        if (action === 'offer') {
            const myDef = await _storage_js_1.kv.get(defKey(mode, me));
            if (!myDef)
                return res.status(400).json({ error: 'Set your defense first.' });
            const order = (await _storage_js_1.kv.get(orderKey(mode))) ?? [];
            const lastTarget = (await _storage_js_1.kv.get(lastKey(mode, me))) ?? undefined; // exclude the opponent just fought
            const aiStart = node_crypto_1.default.randomInt(0, _core_js_1.AI_SEED_COUNT);
            return res.status(200).json({ offer: (0, _core_js_1.buildOffer)(order, me, (i) => aiOfferSummary(mode, i), aiStart, lastTarget) });
        }
        // ── Challenge (server-authoritative resolution + rank swap) ────────────
        if (action === 'challenge') {
            if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'pet-ladder-challenge', 1, 2_000, me))
                return;
            const targetId = String(body.targetId ?? '');
            const myDef = await _storage_js_1.kv.get(defKey(mode, me));
            if (!myDef)
                return res.status(400).json({ error: 'Set your defense first.' });
            const order0 = (await _storage_js_1.kv.get(orderKey(mode))) ?? [];
            const lastTarget = (await _storage_js_1.kv.get(lastKey(mode, me))) ?? undefined;
            if (lastTarget && targetId === lastTarget)
                return res.status(409).json({ error: 'You just challenged this opponent — pick someone else.' });
            if (!(0, _core_js_1.canChallenge)(order0, me, targetId, lastTarget))
                return res.status(409).json({ error: 'That opponent is not available to challenge.' });
            // Consume one of the day's challenges only once the target is valid.
            const used = await _storage_js_1.kv.incr(dailyKey(mode, me, dayStamp()), { ex: 36 * 3600 });
            if (used > _core_js_1.DAILY_CHALLENGES)
                return res.status(429).json({ error: `Out of challenges today (${_core_js_1.DAILY_CHALLENGES}/day). Come back tomorrow.` });
            // Load the defender's SEALED roster (AI pool or the human's def doc).
            let targetDef;
            if ((0, _core_js_1.isAiId)(targetId)) {
                const i = (0, _core_js_1.aiIndexOf)(targetId);
                targetDef = i >= 0 && i < _core_js_1.AI_SEED_COUNT ? aiDefense(mode, i) : null;
            }
            else
                targetDef = await _storage_js_1.kv.get(defKey(mode, targetId));
            if (!targetDef || targetDef.pets.length === 0)
                return res.status(404).json({ error: 'Opponent has no defense set.' });
            // Server-minted seed → server recomputes the winner (outside the lock).
            const seed = node_crypto_1.default.randomInt(1, 0x7fffffff);
            const won = mode === 'tactical'
                ? (0, _core_js_1.resolveTactical)(myDef, targetDef, seed)
                : (0, _core_js_1.resolveColiseum)(myDef.pets[0], targetDef.pets[0], seed);
            const myEntry = order0.find((e) => e.slug === me)
                ?? { slug: me, name: myDef.name, village: myDef.village, record: { wins: 0, losses: 0, defended: 0, defeated: 0 }, summary: myDef.pets.map(_core_js_1.petLite), updatedAt: now };
            let rank = null;
            let notifySlug = null;
            await (0, _lock_js_1.withKvLock)(orderKey(mode), async () => {
                const order = (await _storage_js_1.kv.get(orderKey(mode))) ?? [];
                if (!(0, _core_js_1.canChallenge)(order, me, targetId)) {
                    const i = order.findIndex((e) => e.slug === me);
                    rank = i >= 0 ? i + 1 : null;
                    return;
                }
                const applied = (0, _core_js_1.applyChallenge)(order, myEntry, targetId, won);
                await _storage_js_1.kv.set(orderKey(mode), applied.order.slice(0, 1000));
                notifySlug = applied.notifySlug;
                const i = applied.order.findIndex((e) => e.slug === me);
                rank = i >= 0 ? i + 1 : null;
            }, { failClosed: true });
            // Notify the offline human defender (lightweight notify + realtime nudge).
            if (notifySlug && !(0, _core_js_1.isAiId)(notifySlug)) {
                await appendNotify(notifySlug, { from: myDef.name, mode, won, at: now });
                (0, notify_js_1.kickPlayer)(notifySlug, 'challenge');
            }
            // Remember this opponent so the next offer/challenge can't immediately repeat it.
            await _storage_js_1.kv.set(lastKey(mode, me), targetId, { ex: LAST_TTL });
            // Sealed replay for the client cinematic (deterministic from seed + rosters).
            const replay = mode === 'tactical'
                ? { kind: 'tactical', seed, blue: myDef.pets.map((p, i) => ({ pet: p, role: myDef.roles[i] })), red: targetDef.pets.map((p, i) => ({ pet: p, role: targetDef.roles[i] })) }
                : { kind: 'coliseum', seed, player: myDef.pets[0], enemy: targetDef.pets[0] };
            return res.status(200).json({ won, mode, targetId, rank, challengesLeft: Math.max(0, _core_js_1.DAILY_CHALLENGES - used), replay });
        }
        return res.status(400).json({ error: 'Invalid action.' });
    }
    catch (err) {
        console.error('[pet-ladder]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
