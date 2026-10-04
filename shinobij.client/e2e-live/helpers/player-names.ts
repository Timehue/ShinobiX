import { isCleanPlayerName, TEXT_LIMITS } from '../../../api/_text-moderation';

// Throwaway player names that registration is certain to accept.
//
// Live specs register fresh accounts named from the clock, such as
// `defeat${side}${Date.now().toString(36)}`. Registration refuses a name whose
// leetspeak-collapsed form holds a blocked term (isCleanPlayerName), and a
// clock stamp spells one now and then: "defeatdmutp3dol" holds "pedo". About
// one name in 18,000 was refused that way, and its spec failed at the first
// request with "That username is not allowed", before it tested anything.
// Every candidate here goes through the server's own name gate, so a spec only
// registers names the server accepts, whatever the clock reads and however the
// blocklist grows.

// A refused stamp is re-rolled into a numeric range of its own, far above any
// real millisecond clock. A re-rolled stamp therefore never repeats a stamp
// another spec drew from the clock, and none of its digits keeps the term the
// refused stamp spelled.
const STAMP_REROLLS = 8;
const REROLL_RANGE = 10 ** 13;

/** Whether registration's name gate passes `name` on the checks a stamp can trip: length and blocked terms. */
export function nameGateAccepts(name: string): boolean {
    return name.trim().length <= TEXT_LIMITS.playerName && isCleanPlayerName(name);
}

/**
 * A unique stamp, `head` followed by a base-36 clock reading, for which every
 * name `names` builds passes registration's name gate. One stamp can name
 * several accounts, such as a Kage and the rival who challenges them.
 */
export function uniqueNameStamp(
    names: (stamp: string) => readonly string[],
    { head = '', now = Date.now() }: { head?: string; now?: number } = {},
): string {
    for (let reroll = 0; reroll <= STAMP_REROLLS; reroll++) {
        const stamp = `${head}${(now + reroll * REROLL_RANGE).toString(36)}`;
        if (names(stamp).every(nameGateAccepts)) return stamp;
    }
    const refused = names(`${head}${now.toString(36)}`).filter((name) => !nameGateAccepts(name));
    throw new Error(
        `Registration refuses ${JSON.stringify(refused)} whatever the stamp: a name is at most `
        + `${TEXT_LIMITS.playerName} characters, and its fixed text must not hold a blocked term.`,
    );
}

/** One unique player name, built by `name` from a stamp, that registration accepts. */
export function uniquePlayerName(name: (stamp: string) => string, options: { now?: number } = {}): string {
    return name(uniqueNameStamp((stamp) => [name(stamp)], options));
}
