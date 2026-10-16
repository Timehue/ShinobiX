/**
 * A player's name as other people see it: each word starts with a capital
 * letter ("rill" → "Rill", "storm walker" → "Storm Walker"). The rest of the
 * name is left exactly as the player typed it, so "McKay" stays "McKay".
 *
 * Display only. Lookups, save keys and comparisons keep using the lowercase
 * slug (safeName on the server, `.toLowerCase()` on the client).
 */
export function displayPlayerName(name: unknown): string {
    const text = typeof name === 'string' ? name.trim() : '';
    return text.replace(/(^|\s)(\p{Ll})/gu, (match: string, gap: string, letter: string) => {
        const upper = letter.toUpperCase();
        // A few letters do not survive the round trip ("ß" → "SS", "ı" → "I"),
        // and the new name would lowercase to a different account slug. Leave them.
        return upper.length === 1 && upper.toLowerCase() === letter ? gap + upper : match;
    });
}
