/*
 * Cast-flavor resolution — the one place a jutsu's authored battle line is
 * turned into the sentence that lands in a battle log.
 *
 * Flavor carries fighter tokens `%user` and `%target`, plus `%tag1`, `%tag2`,
 * etc. for the current mastery-scaled effect percentages. `%user` is always the
 * caster. `%target` is NOT always the opponent: a SELF-targeted technique
 * targets its caster, so resolving `%target` to the enemy produced lines that
 * flatly contradicted what happened — the live "Overload" (a self-buff whose
 * authored line is the editor's default "Overload hits %target") logged
 * "Raiko uses Overload: Overload hits Mira" while buffing Raiko and never
 * touching Mira.
 *
 * Fixing it here rather than in the authored text means EVERY self-buff reads
 * correctly, including the ones an admin writes tomorrow, and an authored line
 * that never got real prose still degrades to something true.
 *
 * Every engine that prints a cast header must go through this: PvP
 * (api/pvp/move.ts), solo PvE (api/solo-pve/_engine.ts) and the towers
 * (api/towers/_engine.ts).
 */

import { interpolateJutsuPercentages } from '../../shared/jutsu-description.js';
import { jutsuLevelCapForLevel, poisonPercentForTag, scaledTagPercent, woundCapForJutsu } from './formulas.js';
import { canonicalTagName, CAPPED_AMP_TAGS } from '../pvp/_tags.js';
import { rankedCombatLevel } from '../pvp/_ranked-format.js';

type FlavorJutsu = {
    id?: string;
    bloodlineRank?: string;
    method?: unknown;
    tags?: unknown[];
    battleDescription?: unknown;
    target?: unknown;
};

/**
 * Resolve a jutsu's authored flavor into a finished log sentence.
 *
 * Returns '' when there is no authored flavor, so callers can omit the trailing
 * ": …" rather than printing a bare colon.
 */
export function resolveCastFlavor(jutsu: FlavorJutsu, casterName: string, opponentName: string, character?: Record<string, unknown>): string {
    const raw = typeof jutsu.battleDescription === 'string' ? jutsu.battleDescription.trim() : '';
    if (!raw) return '';
    // A SELF cast's target IS its caster. Anything else (OPPONENT, OTHER_USER,
    // CHARACTER, EMPTY_GROUND) points outward, so it keeps the opponent's name —
    // EMPTY_GROUND included, since a ground cast still resolves against whoever
    // is caught in it and its flavor is written that way.
    const target = jutsu.target === 'SELF' ? casterName : opponentName;
    if (!/%tag[1-9]\d*\b/.test(raw)) return raw.replace(/%user/g, casterName).replace(/%target/g, target);
    const rows = (Array.isArray(character?.jutsuMastery) ? character.jutsuMastery : []) as Array<{ jutsuId: string; level: number }>;
    const mastery = character ? Math.min(
        Math.max(0, Math.min(50, rows.find(row => row.jutsuId === jutsu.id)?.level ?? 0)),
        jutsuLevelCapForLevel(rankedCombatLevel(character)),
    ) : 50;
    const zone = jutsu.target === 'EMPTY_GROUND' && (jutsu.method === 'INSTANT_EFFECT' || jutsu.method === 'AOE_SPIRAL');
    const percentages = (jutsu.tags ?? []).map(value => {
        if (!value || typeof value !== 'object') return undefined;
        const tag = value as { name?: string; percent?: number };
        if (typeof tag.name !== 'string' || !tag.name) return undefined;
        if (!(Number(tag.percent) > 0)) return 0;
        const name = canonicalTagName(tag.name);
        const level = zone ? 50 : mastery;
        if (name === 'Poison') return poisonPercentForTag(tag.percent, level, jutsu);
        const pct = Math.floor(scaledTagPercent(tag.percent ?? 0, level, name, jutsu.bloodlineRank, CAPPED_AMP_TAGS));
        return name === 'Wound' ? Math.min(pct, woundCapForJutsu(jutsu)) : pct;
    });
    // Substitute values before names, so a fighter's name is never parsed as a token.
    return interpolateJutsuPercentages(raw, percentages).replace(/%user/g, casterName).replace(/%target/g, target);
}

/**
 * The full cast header, e.g. `Raiko uses Overload: chakra floods his coils.`
 * Collapses to `Raiko uses Overload:` when the jutsu has no authored flavor,
 * preserving the shape every log consumer already parses (the "X uses Y"
 * grouping in shinobij.client/src/lib/battle-log-format.ts).
 */
export function castHeaderLine(
    jutsu: FlavorJutsu & { name?: unknown },
    casterName: string,
    opponentName: string,
    character?: Record<string, unknown>,
): string {
    const flavor = resolveCastFlavor(jutsu, casterName, opponentName, character);
    const name = typeof jutsu.name === 'string' && jutsu.name ? jutsu.name : 'a jutsu';
    return `${casterName} uses ${name}:${flavor ? ` ${flavor}` : ''}`;
}
