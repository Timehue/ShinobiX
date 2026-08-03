/*
 * Resolve an AI profile's `jutsuIds` into the real jutsu objects an
 * `EnemyTemplate` carries — the loadout half of the generic AI-fight migration
 * (docs/runbooks/combat-mode-migration.md, step 2).
 *
 * `aiOpponentEnemyTemplate` (api/_authoritative-pve.ts) is deliberately PURE and
 * takes `resolvedJutsu` already built; this module is the impure-ish half that
 * knows about the catalogs. Keeping them apart is what lets the template stay
 * unit-testable without the catalog graph.
 *
 * Resolution order mirrors `resolveEquippedLoadout` (api/pvp/session.ts) so an AI
 * casts the same object a player would: the built-in server catalog
 * (api/pvp/_jutsu-catalog.ts) WINS over admin-authored content for a shared id,
 * and admin content only fills ids the built-in catalog does not carry. Unknown
 * ids are dropped rather than faked — an AI with an unresolvable loadout falls
 * back to a generic signature inside aiOpponentEnemyTemplate, so it is never
 * left unable to act.
 *
 * Everything is run through `sanitizeJutsuList`, the same clamp/canonicalize
 * pass a PvP loadout gets: authored effectPower is capped, tag names are
 * canonicalized and deduped, Pierce rules are enforced. An admin-authored AI
 * therefore cannot be given an instant-kill jutsu the player half would reject.
 */
import { JUTSU_CATALOG } from './pvp/_jutsu-catalog.js';
import { sanitizeJutsuList } from './pvp/session.js';
import type { AdminCombatContent } from './_admin-content.js';
import type { EnemyJutsu } from './_authoritative-pve.js';

/** An AI never fights with more than this many jutsu (the fattest built-in
 *  loadout is 6; the cap only bounds a hand-authored `shared:ai-profiles` entry). */
export const MAX_AI_LOADOUT_JUTSU = 8;

/** The fields an EnemyTemplate jutsu carries. `target` / `tags` are included on
 *  purpose: the tower engine reads both (EMPTY_GROUND placement, ground zones,
 *  Push/Pull, every status tag), so omitting them would disarm the AI's kit. */
function toEnemyJutsu(raw: Record<string, unknown>): EnemyJutsu | null {
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) return null;
    const num = (value: unknown): number | undefined => {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    };
    const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
    const out: EnemyJutsu = { id };
    const name = str(raw.name); if (name) out.name = name;
    const type = str(raw.type); if (type) out.type = type;
    const element = str(raw.element); if (element) out.element = element;
    const method = str(raw.method); if (method) out.method = method;
    const target = str(raw.target); if (target) out.target = target;
    const ap = num(raw.ap); if (ap !== undefined) out.ap = ap;
    const range = num(raw.range); if (range !== undefined) out.range = range;
    const effectPower = num(raw.effectPower); if (effectPower !== undefined) out.effectPower = effectPower;
    const chakraCost = num(raw.chakraCost); if (chakraCost !== undefined) out.chakraCost = chakraCost;
    const staminaCost = num(raw.staminaCost); if (staminaCost !== undefined) out.staminaCost = staminaCost;
    const cooldown = num(raw.cooldown); if (cooldown !== undefined) out.cooldown = cooldown;
    if (Array.isArray(raw.tags) && raw.tags.length) out.tags = raw.tags;
    return out;
}

/**
 * Resolve `jutsuIds` → EnemyJutsu[]. Deduped, order-preserving, capped, and
 * sanitized. Returns [] when nothing resolves, which the template treats as
 * "give it a generic signature".
 */
export function resolveAiProfileJutsu(
    jutsuIds: unknown,
    admin: AdminCombatContent | null = null,
): EnemyJutsu[] {
    if (!Array.isArray(jutsuIds)) return [];
    const seen = new Set<string>();
    const picked: Record<string, unknown>[] = [];
    for (const rawId of jutsuIds) {
        if (picked.length >= MAX_AI_LOADOUT_JUTSU) break;
        const id = typeof rawId === 'string' ? rawId.trim().slice(0, 120) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        // Built-in catalog first (same precedence as resolveEquippedLoadout),
        // admin-authored content only for ids the built-ins do not define.
        const builtin = Object.prototype.hasOwnProperty.call(JUTSU_CATALOG, id) ? JUTSU_CATALOG[id] : undefined;
        const authored = builtin ? undefined : admin?.jutsu.get(id);
        const found = builtin ?? authored;
        if (found) picked.push(found as unknown as Record<string, unknown>);
    }
    if (!picked.length) return [];
    return (sanitizeJutsuList(picked) as Record<string, unknown>[])
        .map(toEnemyJutsu)
        .filter((j): j is EnemyJutsu => j !== null);
}
