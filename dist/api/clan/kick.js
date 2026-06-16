"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _storage_js_2 = require("./war/_storage.js");
const _kick_core_js_1 = require("./_kick-core.js");
/*
 * /api/clan/kick — POST only
 *
 * Server-authoritative clan kick. Removing a member from the shared clan record
 * alone does NOT stick: the kicked player's client re-adds itself on the next
 * Clan Hall load while their `character.clan` still points here (the validator
 * permits a member self-add, and the save endpoint's membership gate still
 * passes). The ONLY way to truly remove someone is to also clear their
 * `character.clan` on THEIR save — a cross-save write the client can't do.
 *
 * Apply / approve / reject / leave / disband already work through the validated
 * `save:clan-<slug>` blob + the save endpoint's join-request carve-out; KICK is
 * the one membership action that genuinely needs a server endpoint.
 *
 * Gate: caller must be clan leadership (founder / Leader / Officer — same model
 * as clan-war declare / upgrade purchase). The founder can't be kicked, and a
 * non-founder leader/officer can't kick another leader/officer.
 *
 * Body: { playerName, clan, targetName }
 * Locks: clan save row (outer) → kicked player's save row (inner) — same
 * ordering as clan/treasury/donate, so the nesting can't deadlock.
 */
const AUDIT_LOG_PREFIX = 'audit:clan-kick:';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const targetName = (0, _utils_js_1.safeName)(String(body.targetName ?? ''));
        if (!playerName || !clan || !targetName) {
            return res.status(400).json({ error: 'Missing playerName, clan, or targetName.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-kick', 30, 60_000, identity.name)))
            return;
        const targetSlug = (0, _kick_core_js_1.clanSlugBare)(clan);
        if (!targetSlug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        // Leadership gate (founder / Leader / Officer) — same model as declaring a
        // clan war / purchasing an upgrade. Also proves actor membership. Admins
        // bypass and act with founder-level authority (founder still un-kickable).
        let actorRole = 'founder';
        if (!identity.admin) {
            const ctx = await (0, _storage_js_2.loadClanContext)(playerName);
            if ((0, _kick_core_js_1.clanSlugBare)(ctx.clan) !== targetSlug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
            if (!(0, _storage_js_2.canActAsClanLeadership)(ctx.role)) {
                return res.status(403).json({ error: 'Only clan leadership can remove members.' });
            }
            actorRole = ctx.role;
        }
        const clanSaveKey = `save:clan-${targetSlug}`;
        const targetSaveKey = `save:${targetName}`;
        const result = await (0, _lock_js_1.withKvLock)(clanSaveKey, async () => {
            const clanRec = await _storage_js_1.kv.get(clanSaveKey);
            if (!clanRec)
                return { ok: false, status: 404, error: 'Clan not found.' };
            const decision = (0, _kick_core_js_1.resolveClanKick)(clanRec, actorRole, playerName, targetName);
            if (!decision.ok)
                return decision;
            // Clear the kicked player's clan pointer on THEIR save FIRST (committed
            // before we shrink the roster). Safe failure mode: if the roster write
            // below never happens, the player's clan is already cleared and the
            // stale members[] entry self-cleans on the next clan write. The reverse
            // order would let them re-add themselves on next load.
            await (0, _lock_js_1.withKvLock)(targetSaveKey, async () => {
                const targetRec = await _storage_js_1.kv.get(targetSaveKey);
                const targetChar = (targetRec?.character ?? null);
                if (targetRec && targetChar && (0, _kick_core_js_1.clanSlugBare)(String(targetChar.clan ?? '')) === targetSlug) {
                    const nextChar = { ...targetChar };
                    delete nextChar.clan;
                    nextChar.clanFounder = false;
                    nextChar.guardQueued = false;
                    await _storage_js_1.kv.set(targetSaveKey, { ...targetRec, character: nextChar });
                }
            }, { failClosed: true });
            await _storage_js_1.kv.set(clanSaveKey, {
                ...clanRec,
                members: decision.nextMembers,
                roleOverrides: decision.nextRoleOverrides,
                joinRequests: decision.nextJoinRequests,
            });
            return { ok: true, members: decision.nextMembers };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            target: targetName,
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({ ok: true, members: result.members });
    }
    catch (err) {
        console.error('[clan/kick]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
