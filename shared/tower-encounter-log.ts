export type EmbeddedTowerEncounter = 'hunt' | 'caravan';

/** Replace internal embedded-floor result text at presentation boundaries. */
export function presentEmbeddedTowerLog(
    log: readonly string[],
    floorId: number,
    encounter: EmbeddedTowerEncounter,
): string[] {
    const result = encounter === 'hunt'
        ? { won: 'Hunt encounter cleared!', lost: 'Hunt encounter ended.' }
        : { won: 'The road is open.', lost: 'The escort has ended.' };
    return log.map(line => {
        if (line === `Floor ${floorId} cleared!`) return result.won;
        if (line === 'Squad wiped — floor failed.'
            || line === 'Round limit reached — floor failed.'
            || line === 'Floor resolution stalled — floor failed.') return result.lost;
        return line;
    });
}
