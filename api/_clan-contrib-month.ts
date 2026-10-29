/*
 * The three monthly clan contribution counters share ONE month stamp,
 * `clanContribMonth`, and the clan roster only counts a member's row while that
 * stamp is the current month (api/_clan-save-validate.ts). Every writer used to
 * add +1 to its own counter and re-stamp the month without zeroing the others,
 * so the first mission of a new month carried all of last month's battle, event
 * and mission totals into it.
 *
 * Any write that stamps a month goes through here: the counters come back as
 * they stand IN `month` (all zero when the stamp is older), ready to add to.
 */
export const CLAN_CONTRIB_FIELDS = ['clanBattleContrib', 'clanEventContrib', 'clanMissionContrib'] as const;
export type ClanContribField = typeof CLAN_CONTRIB_FIELDS[number];
export type ClanContribCounters = Record<ClanContribField, number> & { clanContribMonth: string };

const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/**
 * The character's counters for `month` (YYYY-MM). Returns null when the stored
 * stamp is a LATER month: a late settlement from last month must not pull the
 * counters back to it.
 */
export function clanContribForMonth(character: Record<string, unknown>, month: string): ClanContribCounters | null {
    const stored = typeof character.clanContribMonth === 'string' ? character.clanContribMonth : '';
    if (stored > month) return null;
    const same = stored === month;
    return {
        clanBattleContrib: same ? count(character.clanBattleContrib) : 0,
        clanEventContrib: same ? count(character.clanEventContrib) : 0,
        clanMissionContrib: same ? count(character.clanMissionContrib) : 0,
        clanContribMonth: month,
    };
}

/** Fields to spread onto the character to add `amount` to one counter in `month`. */
export function addClanContrib(
    character: Record<string, unknown>,
    field: ClanContribField,
    month: string,
    amount = 1,
): Partial<ClanContribCounters> {
    const current = clanContribForMonth(character, month);
    if (!current) return {};
    return { ...current, [field]: current[field] + Math.max(0, Math.floor(amount)) };
}

export const currentClanContribMonth = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
