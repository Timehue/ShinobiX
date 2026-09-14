/** The first independent activity is a journal record, never a reward source. */
export const FIRST_CONTRACT_ROUTES = ['combat', 'discovery', 'companion'] as const;
export type FirstContractRoute = typeof FIRST_CONTRACT_ROUTES[number];
export type FirstContract = {
    version: 1;
    offeredAt: number;
    source: 'academy' | 'skip';
    route?: FirstContractRoute;
    selectedAt?: number;
    completedAt?: number;
    acknowledgedAt?: number;
    returnedAt?: number;
    evidence?: { kind: 'combat-claim' | 'field-explore' | 'companion-care'; sector?: number };
};
export function isFirstContractRoute(value: unknown): value is FirstContractRoute {
    return FIRST_CONTRACT_ROUTES.some((route) => route === value);
}
export function readFirstContract(value: unknown): FirstContract | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as FirstContract;
    if (row.version !== 1 || !Number.isSafeInteger(row.offeredAt) || row.offeredAt <= 0
        || !['academy', 'skip'].includes(row.source)) return null;
    if (row.route !== undefined && !isFirstContractRoute(row.route)) return null;
    return row;
}
export function offerFirstContract<T extends Record<string, unknown>>(character: T, source: FirstContract['source'], now = Date.now()): T {
    if (readFirstContract(character.firstContract) || Number(character.level) >= 15) return character;
    return { ...character, firstContract: { version: 1, offeredAt: now, source } satisfies FirstContract };
}
/** Call ONLY inside an existing authoritative success/settlement write. */
export function recordFirstContractActivity<T extends Record<string, unknown>>(
    character: T, route: FirstContractRoute, evidence: NonNullable<FirstContract['evidence']>, now = Date.now(),
): T {
    const current = readFirstContract(character.firstContract);
    if (!current || current.route !== route || current.completedAt) return character;
    return { ...character, firstContract: { ...current, completedAt: now, evidence } };
}
export function firstContractReturnedLater(state: FirstContract, now: number): boolean {
    return Boolean(state.completedAt && Math.floor(now / 86_400_000) > Math.floor(state.completedAt / 86_400_000));
}
