/**
 * Overload's stable content contract.
 *
 * The technique is admin-authored, so older/stale published records can carry
 * only one Increase Damage Given tag even though the move is designed to pulse
 * exactly twice. Keep the repair in shared code so the client preview and the
 * server-sealed combat definition cannot disagree.
 */
export const OVERLOAD_JUTSU_ID = 'starter-universal-blitz';
export const OVERLOAD_DAMAGE_GIVEN_TAG = 'Increase Damage Given';

type OverloadTagLike = { name?: unknown };

/**
 * Preserve the authored stack value, but repair one-or-many Overload IDG tags
 * to exactly two. A tagless definition is left alone so this compatibility
 * rule cannot manufacture an effect from an unrelated/corrupt record that only
 * happens to reuse the id.
 */
export function canonicalizeOverloadTags<T extends OverloadTagLike>(jutsuId: unknown, tags: readonly T[]): T[] {
    const copy = [...tags];
    if (jutsuId !== OVERLOAD_JUTSU_ID) return copy;

    const stackIndexes = copy
        .map((tag, index) => tag.name === OVERLOAD_DAMAGE_GIVEN_TAG ? index : -1)
        .filter((index) => index >= 0);
    if (stackIndexes.length === 0) return copy;

    if (stackIndexes.length === 1) {
        const index = stackIndexes[0]!;
        copy.splice(index + 1, 0, { ...copy[index]! });
        return copy;
    }

    let stacksKept = 0;
    return copy.filter((tag) => {
        if (tag.name !== OVERLOAD_DAMAGE_GIVEN_TAG) return true;
        stacksKept += 1;
        return stacksKept <= 2;
    });
}
