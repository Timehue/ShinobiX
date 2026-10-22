/** The fixed price a natural road bandit accepts instead of a fight. */
export const BANDIT_TOLL_RYO = 500;

export function offersBanditToll(dialog: {
    w: { id: string; archetype: string };
    ambush?: unknown;
    nemesis?: boolean;
}): boolean {
    return dialog.w.archetype === 'bandit' && /^w-\d+-\d+-\d+$/.test(dialog.w.id)
        && !dialog.ambush && !dialog.nemesis;
}
