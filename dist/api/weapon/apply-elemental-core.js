"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideElementalCoreAttunement = decideElementalCoreAttunement;
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const _elements_js_1 = require("../pvp/_elements.js");
// Server-authoritative weapon elemental attunement.
//
// Trust model (CLAUDE.md hard rule — never trust the client for outcomes that
// change combat power): applying an Elemental Core sets a legendary/mythic
// weapon's `weaponElement`, which lets that weapon ride the wielder's bloodline
// damage multiplier (api/pvp/move.ts resolveBaseDamage gate). So the whole thing
// is validated + written server-side under the per-save lock:
//   1. the chosen element must be one the player has AWAKENED (characterOwnsElement),
//   2. the target must be a legendary/mythic melee (hand) weapon the player owns,
//   3. the player must own an Elemental Core, which is atomically consumed.
// The attunement is stored in character.weaponElements (server-owned; the save
// sanitizer re-injects the stored copy so a tampered autosave can't self-attune).
const ELEMENTAL_CORE_ID = 'elemental-core';
const APPLY_RATE_LIMIT_MS = 3_000; // one attunement attempt per 3s per player
// A true weapon carries offensive weapon fields; armor that merely shares the
// "hand" slot (gloves/gauntlets — e.g. bulwark-gloves) has none of these, only
// weaponCooldown + bonuses. Used to reject attuning gear as a fake weapon.
function isWeaponShape(item) {
    return Boolean(item.weaponEp || item.weaponRange || item.weaponEffect ||
        (Array.isArray(item.weaponTags) && item.weaponTags.length));
}
// Resolve a weapon's slot + rarity + whether it's a real weapon, from the built-in
// catalog ∪ the player's own creatorItems (named weapons). Returns null for unknown ids.
function resolveWeaponMeta(weaponId, creatorItems) {
    const builtin = _item_catalog_js_1.ITEM_CATALOG[weaponId];
    if (builtin)
        return { slot: String(builtin.slot ?? ''), rarity: String(builtin.rarity ?? ''), isWeapon: isWeaponShape(builtin) };
    if (Array.isArray(creatorItems)) {
        const c = creatorItems.find((i) => i && typeof i === 'object' && i.id === weaponId);
        if (c)
            return { slot: String(c.slot ?? ''), rarity: String(c.rarity ?? ''), isWeapon: isWeaponShape(c) };
    }
    return null;
}
// Count an item across the two stores (counted itemStacks + unique inventory[]).
function ownedItemCount(character, id) {
    let n = 0;
    const stacks = character.itemStacks;
    if (Array.isArray(stacks)) {
        for (const s of stacks) {
            if (s && typeof s === 'object' && s.itemId === id) {
                n += Math.max(0, Math.floor(Number(s.count) || 0));
            }
        }
    }
    const inv = character.inventory;
    if (Array.isArray(inv))
        for (const it of inv)
            if (String(it) === id)
                n += 1;
    return n;
}
// Consume exactly ONE `id`: decrement a counted stack, else drop one inventory
// entry. Returns the new { itemStacks, inventory } pair, or null if none owned.
function consumeOne(character, id) {
    const stacks = Array.isArray(character.itemStacks)
        ? character.itemStacks.map((s) => ({ ...s }))
        : [];
    const si = stacks.findIndex((s) => s?.itemId === id && Math.floor(Number(s.count) || 0) > 0);
    if (si >= 0) {
        stacks[si].count = Math.floor(Number(stacks[si].count) || 0) - 1;
        return { itemStacks: stacks.filter((s) => Math.floor(Number(s.count) || 0) > 0), inventory: character.inventory };
    }
    const inv = Array.isArray(character.inventory) ? character.inventory.map(String) : [];
    const ii = inv.indexOf(id);
    if (ii >= 0) {
        inv.splice(ii, 1);
        return { itemStacks: character.itemStacks, inventory: inv };
    }
    return null;
}
// Pure decision core (exported for unit tests): validate the attunement against
// the authoritative character + the player's own creatorItems, and — on success —
// return the mutated character (Core consumed, attunement written). No IO.
function decideElementalCoreAttunement(character, creatorItems, weaponId, element) {
    // 1. The element must be one the player has AWAKENED (not merely a valid token).
    //    canonicalElement is the stored casing so PvP's case-sensitive whitelist honors it.
    const canonicalElement = (0, _elements_js_1.canonicalOwnedElement)(character, element);
    if (!canonicalElement) {
        return { ok: false, status: 400, error: 'You have not awakened that element.' };
    }
    // 2. The target must be a legendary/mythic melee (hand) WEAPON — not gear that
    //    merely shares the hand slot (gloves/gauntlets), which would otherwise ride
    //    the bloodline multiplier as a fake weapon swing in combat.
    const meta = resolveWeaponMeta(weaponId, creatorItems);
    if (!meta)
        return { ok: false, status: 404, error: 'Unknown weapon.' };
    if (meta.slot !== 'hand' || !meta.isWeapon)
        return { ok: false, status: 400, error: 'Only melee weapons can be attuned.' };
    const rarity = meta.rarity.toLowerCase();
    if (rarity !== 'legendary' && rarity !== 'mythic') {
        return { ok: false, status: 400, error: 'Only legendary or mythic weapons can be attuned.' };
    }
    // 3. The player must own the weapon (in a bag store or equipped).
    const equippedIds = character.equipment && typeof character.equipment === 'object'
        ? Object.values(character.equipment).map(String)
        : [];
    if (ownedItemCount(character, weaponId) < 1 && !equippedIds.includes(weaponId)) {
        return { ok: false, status: 400, error: 'You do not own that weapon.' };
    }
    // 4. The player must own an Elemental Core — consumed atomically.
    const consumed = consumeOne(character, ELEMENTAL_CORE_ID);
    if (!consumed) {
        return { ok: false, status: 400, error: 'You need an Elemental Core to attune a weapon.' };
    }
    const prior = (character.weaponElements && typeof character.weaponElements === 'object' && !Array.isArray(character.weaponElements))
        ? character.weaponElements
        : {};
    const weaponElements = { ...prior, [weaponId]: canonicalElement };
    return {
        ok: true,
        character: { ...character, itemStacks: consumed.itemStacks, inventory: consumed.inventory, weaponElements },
        value: { weaponId, element: canonicalElement },
    };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const bodyPeek = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'apply-core', 20, 60_000, peekName))
        return;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'apply-core-burst', 1, APPLY_RATE_LIMIT_MS, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const weaponId = String(body.weaponId ?? '');
        const element = String(body.element ?? '').trim();
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!weaponId)
            return res.status(400).json({ error: 'Missing weaponId.' });
        if (!element)
            return res.status(400).json({ error: 'Missing element.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!(0, _auth_js_1.bodyNameMatchesAuth)(identity, playerName)) {
            return res.status(403).json({ error: 'Can only attune your own weapons.' });
        }
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ record, character }) => decideElementalCoreAttunement(character, record.creatorItems, weaponId, element));
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        return res.status(200).json({
            ok: true,
            weaponId: result.value.weaponId,
            element: result.value.element,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    }
    catch (err) {
        console.error('[weapon/apply-elemental-core]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
