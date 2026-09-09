import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { KNOWN_TAG_NAMES, canonicalTagName } from '../pvp/_tags.js';
import { budgetItemBonuses } from '../_item-budget.js';

export function prepareCreatorItems(incoming: Record<string, unknown>, RAW_BLOODLINE_IMAGE_MAX_BYTES: number) {

    // ─── creatorItems normalization (top-level, persisted) ─────────────────────
    // Player-forged Named Weapons / armor live on the save at the TOP LEVEL
    // (incoming.creatorItems), NOT under .character — so the character sanitizer
    // above never touched them and they round-tripped UNVALIDATED. A forged save
    // could store a Named Weapon with weaponEp 999999 / arbitrary tags, and the
    // weapon name (echoed into the public PvP battle log) bypassed the moderation
    // the bloodline/jutsu names get. Clamp numerics, whitelist tags/element/
    // quality, moderate player text, strip inline SVG / oversized images —
    // mirroring the savedBloodlines normalizer above + sanitizePvpItems. (PvP
    // also re-clamps these at session-create, so this is storage-side defense in
    // depth + name moderation.) The `delete char.creatorItems` above only strips
    // an admin-content injection from the .character sub-object; players
    // legitimately own this top-level array, so it is kept (sanitized).
    const CREATOR_ITEM_CAP = 500;
    const VALID_WEAPON_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
    const VALID_WEAPON_EFFECT_TARGETS = new Set(['self', 'opponent', 'enemy', 'both']);
    const KNOWN_ARMOR_QUALITIES = new Set(['Standard', 'Reinforced', 'Rare', 'Elite', 'Legendary', 'Mythic']);
    let sanitizedCreatorItems: unknown;
    if (Array.isArray(incoming.creatorItems)) {
        sanitizedCreatorItems = (incoming.creatorItems as Array<Record<string, unknown>>)
            .slice(0, CREATOR_ITEM_CAP)
            .map((item) => {
                if (!item || typeof item !== 'object') return {};
                const out: Record<string, unknown> = { ...item };
                // Player-authored text — moderate + length-cap (the name appears
                // in the public PvP battle log; description/flavor in tooltips).
                if (typeof out.name === 'string') out.name = sanitizeUserText(out.name, TEXT_LIMITS.storyName);
                if (typeof out.description === 'string') out.description = sanitizeUserText(out.description, TEXT_LIMITS.description);
                if (typeof out.flavorText === 'string') out.flavorText = sanitizeUserText(out.flavorText, TEXT_LIMITS.description);
                // Strip inline SVG / oversized images — same rule as bloodlines
                // (shared image storage hosts real images via /api/images). A
                // normal small data-URL / reference is preserved.
                if (typeof out.image === 'string') {
                    const img = out.image;
                    if (/^data:image\/svg/i.test(img) || img.length > RAW_BLOODLINE_IMAGE_MAX_BYTES) out.image = undefined;
                }
                // Weapon numerics — match sanitizePvpItems bounds (api/pvp/session.ts).
                // Match the authoritative PvP item ceiling. Named weapons roll
                // 30-35 EP, so 60 preserves legitimate/custom headroom while
                // preventing a persisted 600-EP item from dominating PvE modes.
                if (out.weaponEp != null) out.weaponEp = Math.max(0, Math.min(60, Number(out.weaponEp) || 0));
                if (out.weaponRange != null) out.weaponRange = Math.max(0, Math.min(30, Number(out.weaponRange) || 0));
                if (out.weaponCooldown != null) out.weaponCooldown = Math.max(0, Math.min(30, Number(out.weaponCooldown) || 0));
                if (out.apCost != null) out.apCost = Math.max(0, Math.min(200, Number(out.apCost) || 40));
                if (out.weaponEffectValue != null) out.weaponEffectValue = Math.max(0, Math.min(100, Number(out.weaponEffectValue) || 0));
                if (out.restoreChakra != null) out.restoreChakra = Math.max(0, Math.min(5000, Number(out.restoreChakra) || 0));
                if (out.restoreStamina != null) out.restoreStamina = Math.max(0, Math.min(5000, Number(out.restoreStamina) || 0));
                // weaponTags — whitelist + clamp + cap (same as sanitizePvpItems).
                if (out.weaponTags != null) {
                    const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
                    out.weaponTags = (rawTags as unknown[])
                        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                        .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                        .map((t) => {
                            const tag: Record<string, unknown> = { name: canonicalTagName(String(t.name)) };
                            if (t.percent != null) tag.percent = Math.max(0, Math.min(100, Number(t.percent) || 0));
                            return tag;
                        })
                        .slice(0, 10);
                }
                // Whitelisted enums — drop a single bad field, not the whole item.
                if (out.weaponEffect != null) {
                    if (KNOWN_TAG_NAMES.has(String(out.weaponEffect))) out.weaponEffect = canonicalTagName(String(out.weaponEffect));
                    else delete out.weaponEffect;
                }
                if (out.weaponElement != null && !VALID_WEAPON_ELEMENTS.has(String(out.weaponElement))) delete out.weaponElement;
                if (out.weaponEffectTarget != null && !VALID_WEAPON_EFFECT_TARGETS.has(String(out.weaponEffectTarget))) delete out.weaponEffectTarget;
                if (out.armorQuality != null && !KNOWN_ARMOR_QUALITIES.has(String(out.armorQuality))) delete out.armorQuality;
                // Bonus stat grants — clamp each numeric to a sane ceiling so a
                // forged item can't ship a 999999 stat (PvP also caps total stats
                // at MAX_STAT, this is storage hygiene).
                if (out.bonuses && typeof out.bonuses === 'object') {
                    // sub-5: clamp custom-item bonuses to the maximum legitimate
                    // built-in/Named-Armor envelope. Honest forge rolls are no-ops;
                    // forged passives, shields, vitals, and specialty totals are bounded.
                    return budgetItemBonuses(out);
                }
                return out;
            });
    }
    return { CREATOR_ITEM_CAP, sanitizedCreatorItems };
}
