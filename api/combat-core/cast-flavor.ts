/*
 * Cast-flavor resolution — the one place a jutsu's authored battle line is
 * turned into the sentence that lands in a battle log.
 *
 * Flavor carries two tokens, `%user` and `%target`. `%user` is always the
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

type FlavorJutsu = {
    battleDescription?: unknown;
    target?: unknown;
};

/**
 * Resolve a jutsu's authored flavor into a finished log sentence.
 *
 * Returns '' when there is no authored flavor, so callers can omit the trailing
 * ": …" rather than printing a bare colon.
 */
export function resolveCastFlavor(jutsu: FlavorJutsu, casterName: string, opponentName: string): string {
    const raw = typeof jutsu.battleDescription === 'string' ? jutsu.battleDescription.trim() : '';
    if (!raw) return '';
    // A SELF cast's target IS its caster. Anything else (OPPONENT, OTHER_USER,
    // CHARACTER, EMPTY_GROUND) points outward, so it keeps the opponent's name —
    // EMPTY_GROUND included, since a ground cast still resolves against whoever
    // is caught in it and its flavor is written that way.
    const target = jutsu.target === 'SELF' ? casterName : opponentName;
    return raw.replace(/%user/g, casterName).replace(/%target/g, target);
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
): string {
    const flavor = resolveCastFlavor(jutsu, casterName, opponentName);
    const name = typeof jutsu.name === 'string' && jutsu.name ? jutsu.name : 'a jutsu';
    return `${casterName} uses ${name}:${flavor ? ` ${flavor}` : ''}`;
}
