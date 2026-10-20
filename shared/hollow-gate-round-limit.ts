/** Applies only to shrine shinobi combat. Other runtimes keep their own rules. */
export const HOLLOW_GATE_SHINOBI_ROUND_LIMIT = 40;
export const HOLLOW_GATE_LEGACY_SHINOBI_ROUND_LIMIT = 25;

export function hollowGateShinobiRoundLimit(session: {
    runtime?: string;
    encounter?: { kind: string };
    status: string;
    hollowGateRoundLimit?: number;
}): number | undefined {
    if (session.runtime !== 'solo-pve' || session.encounter?.kind !== 'hollow-gate') return undefined;
    // Active legacy fights adopt the approved rule. Finished fights retain
    // their original cap and outcome; this never reopens a terminal encounter.
    return session.status === 'active' || session.hollowGateRoundLimit === HOLLOW_GATE_SHINOBI_ROUND_LIMIT
        ? HOLLOW_GATE_SHINOBI_ROUND_LIMIT : HOLLOW_GATE_LEGACY_SHINOBI_ROUND_LIMIT;
}
