/** Cosmetic identity only. Seal difficulty, proofs and rewards remain server-owned. */
export function dungeonPresentationId(value: unknown): string {
    return typeof value === 'string' && /^craft-dungeon-(forest|snow|volcano|shadow|central)$/.test(value)
        ? value : 'builtin-hidden-dungeon';
}
