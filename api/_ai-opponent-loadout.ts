/*
 * Resolve an AI profile's `jutsuIds` into the real jutsu objects an
 * `EnemyTemplate` carries — the loadout half of the generic AI-fight migration
 * (docs/runbooks/combat-mode-migration.md, step 2).
 *
 * `buildSoloPveAiEncounter` resolves this list while sealing the server-owned
 * Solo-PvE enemy. Keeping catalog resolution here leaves that encounter builder
 * deterministic and keeps the retired Tower-style generic-AI constructor out of
 * the production dependency graph.
 *
 * Resolution order mirrors `resolveEquippedLoadout` (api/pvp/session.ts) so an AI
 * casts the same object a player would: the built-in server catalog
 * (api/pvp/_jutsu-catalog.ts) WINS over admin-authored content for a shared id,
 * and admin content only fills ids the built-in catalog does not carry. Unknown
 * ids are dropped rather than faked — the Solo-PvE enemy builder supplies its
 * bounded fallback signature when this resolver returns no usable jutsu, so the
 * opponent is never left unable to act.
 *
 * Everything is run through `sanitizeJutsuList`, the same clamp/canonicalize
 * pass a PvP loadout gets: authored effectPower is capped, tag names are
 * canonicalized and deduped, Pierce rules are enforced. An admin-authored AI
 * therefore cannot be given an instant-kill jutsu the player half would reject.
 */
import { JUTSU_CATALOG } from './pvp/_jutsu-catalog.js';
import { sanitizeJutsuList } from './pvp/session.js';
import type { AdminCombatContent } from './_admin-content.js';
import type { CombatJutsu } from './combat-core/types.js';
import { isDamagingAiGapCloser, isAiFlicker } from './combat-core/ai-mobility.js';
import { equipPveAiItems } from './combat-core/ai-items.js';

/** Runtime-neutral AI jutsu seal. Tower's EnemyJutsu is a structural subset;
 * solo PvE keeps the additional resolver fields instead of dropping them at a
 * Tower-specific type boundary. */
export type AiOpponentJutsu = CombatJutsu & { visualEffect?: string };

/** Cap on profile-selected jutsu (the fattest built-in loadout is 6).
 * Server-authored PvE may supplement this with Ambush, Blitz and Flicker. */
export const MAX_AI_LOADOUT_JUTSU = 8;
/** Explicit veteran challenges may learn up to the player's baseline capacity.
 * Unclassified hosts and admin-authored profiles retain the historical cap. */
export const MAX_CHALLENGE_AI_LOADOUT_JUTSU = 12;

const ORDINARY_PROGRESSIVE_KITS: Record<string, { damage: string[]; setup: string[] }> = {
    'builtin-ai-rogue-ninja': { damage: ['starter-tai-water-2', 'starter-tai-earth-2', 'starter-tai-fire-2', 'starter-tai-wind-2', 'starter-tai-lightning-2', 'starter-buki-earth-2'], setup: ['starter-tai-fire-4'] },
    'builtin-ai-ember-duelist': { damage: ['starter-tai-water-2', 'starter-buki-fire-2', 'starter-nin-lightning-2', 'starter-tai-fire-2', 'starter-tai-wind-2', 'starter-tai-lightning-2'], setup: ['starter-tai-fire-4'] },
    'builtin-ai-shadow-weaver': { damage: ['starter-gen-water-2', 'starter-gen-earth-2', 'starter-gen-lightning-2', 'starter-gen-wind-2', 'starter-gen-fire-2', 'starter-buki-wind-2'], setup: ['starter-gen-water-1'] },
    'builtin-ai-frost-sealer': { damage: ['starter-gen-lightning-2', 'starter-gen-water-2', 'starter-gen-earth-2', 'starter-nin-water-2', 'starter-nin-lightning-2', 'starter-nin-fire-2'], setup: ['starter-gen-earth-1'] },
    'builtin-ai-mist-sentinel': { damage: ['starter-gen-lightning-2', 'starter-gen-water-2', 'starter-gen-earth-2', 'starter-buki-water-2', 'starter-buki-wind-2', 'starter-gen-wind-2'], setup: ['starter-gen-fire-1', 'starter-gen-earth-1'] },
};

/** A larger rotation supplies real damaging turns while signatures recover.
 * Only server-classified ordinary encounters opt in. Named rivals, authored
 * missions, bosses, player copies and protected low-level/weaker kits keep
 * their own definitions. Every learned technique is the player catalog object;
 * no EP/AP/cooldown/resource overrides and no extra damage multiplier. */
export function progressiveOrdinaryAiJutsuIds(profileId: string, level: number, difficulty: unknown): string[] | null {
    const kit = Object.hasOwn(ORDINARY_PROGRESSIVE_KITS, profileId) ? ORDINARY_PROGRESSIVE_KITS[profileId] : undefined;
    if (!kit || level <= 35 || difficulty === 'weaker' || !['standard', 'dangerous', 'elite'].includes(String(difficulty))) return null;
    const accelerated = difficulty === 'elite' ? 2 : difficulty === 'dangerous' ? 1 : 0;
    const damageCount = Math.min(6, (level >= 86 ? 6 : 5) + accelerated);
    const extraSetup = level >= 61 ? difficulty === 'elite'
        ? ['starter-nin-lightning-4', 'starter-nin-earth-1', 'starter-buki-wind-1', 'starter-gen-fire-3']
        : difficulty === 'dangerous'
            ? ['starter-nin-lightning-4', 'starter-nin-earth-1', 'starter-buki-wind-1']
            : ['starter-nin-lightning-4', 'starter-buki-wind-1'] : [];
    const setup = [...new Set([...kit.setup, ...extraSetup])].slice(0,
        (level >= 61 ? MAX_CHALLENGE_AI_LOADOUT_JUTSU : MAX_AI_LOADOUT_JUTSU) - damageCount - 1);
    return [...kit.damage.slice(0, damageCount), ...setup, 'starter-universal-flicker'];
}

/** The fields an EnemyTemplate jutsu carries. `target` / `tags` are included on
 *  purpose: the tower engine reads both (EMPTY_GROUND placement, ground zones,
 *  Push/Pull, every status tag), so omitting them would disarm the AI's kit. */
function toEnemyJutsu(raw: Record<string, unknown>): AiOpponentJutsu | null {
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (!id) return null;
    const num = (value: unknown): number | undefined => {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    };
    const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
    const out: AiOpponentJutsu = { id, name: id, type: 'Ninjutsu' };
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
    if (typeof raw.isUtility === 'boolean') out.isUtility = raw.isUtility;
    const bloodlineRank = str(raw.bloodlineRank); if (bloodlineRank) out.bloodlineRank = bloodlineRank;
    const weatherElement = str(raw.weatherElement); if (weatherElement) out.weatherElement = weatherElement;
    const battleDescription = str(raw.battleDescription); if (battleDescription) out.battleDescription = battleDescription;
    const visualEffect = str(raw.visualEffect); if (visualEffect) out.visualEffect = visualEffect;
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
    maxJutsu = MAX_AI_LOADOUT_JUTSU,
): AiOpponentJutsu[] {
    if (!Array.isArray(jutsuIds)) return [];
    const seen = new Set<string>();
    const picked: Record<string, unknown>[] = [];
    for (const rawId of jutsuIds) {
        if (picked.length >= Math.max(1, Math.min(MAX_CHALLENGE_AI_LOADOUT_JUTSU, maxJutsu))) break;
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
        .filter((j): j is AiOpponentJutsu => j !== null);
}

/** Published names, not historical IDs: an old Blitz ID was republished as
 * Overload. Never turn that unrelated utility into an NPC movement attack. */
export function resolvePveGapClosingJutsu(admin: AdminCombatContent | null = null): AiOpponentJutsu[] {
    const catalog = new Map<string, Record<string, unknown>>([
        ...[...(admin?.jutsu ?? [])],
        ...Object.entries(JUTSU_CATALOG),
    ]);
    const ids = [...catalog.values()]
        .filter(j => /^(ambush|blitz)$/i.test(String(j.name ?? '').trim()))
        .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0) || String(a.id).localeCompare(String(b.id)))
        .map(j => String(j.id));
    const seenNames = new Set<string>();
    const result: AiOpponentJutsu[] = [];
    for (const id of ids) {
        const jutsu = resolveAiProfileJutsu([id], admin)[0];
        if (!jutsu || !isDamagingAiGapCloser(jutsu)) continue;
        const name = jutsu.name.trim().toLowerCase();
        if (seenNames.has(name)) continue;
        seenNames.add(name);
        result.push(jutsu);
        if (result.length === 2) break;
    }
    return result;
}

/** The profile's capped kit stays intact (including scripted rule references).
 * Two authoritative movement strikes plus Flicker supplement it; no copied player
 * loadout or published technique is rewritten. */
export function withPveGapClosingJutsu<T extends { id: string }>(kit: readonly T[], mobility: readonly T[]): T[] {
    const result = [...kit];
    for (const jutsu of mobility.filter(j => /^(ambush|blitz)$/i.test(String((j as { name?: string }).name ?? '').trim())
        && isDamagingAiGapCloser(j))) {
        if (!result.some(existing => existing.id === jutsu.id || (isDamagingAiGapCloser(existing)
            && String((existing as { name?: string }).name ?? '').trim().toLowerCase()
                === String((jutsu as { name?: string }).name ?? '').trim().toLowerCase()))) result.push(structuredClone(jutsu));
        if (result.length - kit.length >= 2) break;
    }
    if (!result.some(isAiFlicker)) {
        const flicker = resolveAiProfileJutsu(['starter-universal-flicker'])[0];
        if (flicker) result.push(structuredClone(flicker) as unknown as T);
    }
    return result;
}

/** Supplement a newly sealed NPC after any boss-specific kit normalization.
 * Preserve its original mastery policy, stats, signatures and resource pools. */
export function teachPveGapClosingJutsu(character: Record<string, unknown>, mobility: readonly AiOpponentJutsu[]): void {
    equipPveAiItems(character);
    const original = Array.isArray(character.jutsu) ? character.jutsu as AiOpponentJutsu[] : [];
    const kit = withPveGapClosingJutsu(original, mobility);
    character.jutsu = kit;
    if (Array.isArray(character.jutsuMastery)) {
        const mastery = character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        const level = mastery[0]?.level ?? 0;
        character.jutsuMastery = [...mastery, ...kit.filter(j => !mastery.some(m => m.jutsuId === j.id))
            .map(j => ({ jutsuId: j.id, level }))];
    }
    if (character.summonTemplate && typeof character.summonTemplate === 'object') {
        const template = structuredClone(character.summonTemplate) as Record<string, unknown>;
        template.jutsu = withPveGapClosingJutsu(Array.isArray(template.jutsu) ? template.jutsu as AiOpponentJutsu[] : [], mobility);
        character.summonTemplate = template;
    }
}
