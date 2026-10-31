/** Replace effect slots with already-scaled percentages in canonical tag order.
 * Missing values stay visible so authoring mistakes aren't hidden.
 * The percent sign is included: write `%tag1`, not `%tag1%`.
 */
export function interpolateJutsuPercentages(text: string, percentages: ReadonlyArray<number | undefined>): string {
    return text.replace(/%tag([1-9]\d*)\b/g, (token, slot: string) => {
        const value = percentages[Number(slot) - 1];
        return typeof value === 'number' && Number.isFinite(value) ? `${value}%` : token;
    });
}
