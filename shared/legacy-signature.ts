/** Table-free progression rules shared by sealed loadouts and client previews. */
export const LEGACY_SIGNATURE_MIN_STAGE = 2;

export function legacySignatureMasteryLevel(stage: number): number {
    return Number.isInteger(stage) && stage >= LEGACY_SIGNATURE_MIN_STAGE && stage <= 5
        ? stage * 10 : 0;
}

export function legacySignatureShape(jutsu: { method: string; target: string; ap: number }): string {
    if (jutsu.method === 'AOE_BURST') return 'Area nova';
    if (jutsu.method === 'AOE_CIRCLE') return 'Dashing strike';
    if (jutsu.ap === 40) return jutsu.target === 'SELF' ? 'Self technique' : 'Opponent technique';
    return 'Focused strike';
}
