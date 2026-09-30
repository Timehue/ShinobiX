/** The first independent activity is a journal record, never a reward source. */
export const FIRST_CONTRACT_ROUTES = ['combat', 'discovery', 'companion'] as const;
export type FirstContractRoute = typeof FIRST_CONTRACT_ROUTES[number];
export type FirstContract = {
    version: 1;
    offeredAt: number;
    source: 'academy' | 'skip';
    route?: FirstContractRoute;
    /** Routes whose server-confirmed activity has been completed, in guided order. */
    completedRoutes?: FirstContractRoute[];
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
    if (row.completedRoutes !== undefined && (!Array.isArray(row.completedRoutes)
        || row.completedRoutes.some((route) => !isFirstContractRoute(route)))) return null;
    return row;
}
/** Older first-contract records had one route and one completion stamp. */
export function completedFirstContractRoutes(state: FirstContract): FirstContractRoute[] {
    if (state.completedRoutes) return [...new Set(state.completedRoutes)];
    // Before the guided flow, any one route was the whole assignment. Preserve
    // that completed journal entry instead of pulling an existing player back
    // into a newly introduced three-step path.
    return state.completedAt && state.route ? [...FIRST_CONTRACT_ROUTES] : [];
}
export function nextFirstContractRoute(state: FirstContract): FirstContractRoute | null {
    const completed = new Set(completedFirstContractRoutes(state));
    return FIRST_CONTRACT_ROUTES.find((route) => !completed.has(route)) ?? null;
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
    if (!current || current.route !== route || completedFirstContractRoutes(current).includes(route)) return character;
    const completedRoutes = current.completedRoutes === undefined && current.route !== 'combat'
        ? [...FIRST_CONTRACT_ROUTES]
        : [...completedFirstContractRoutes(current), route];
    return { ...character, firstContract: { ...current, completedRoutes, completedAt: now, evidence } };
}
export function firstContractReturnedLater(state: FirstContract, now: number): boolean {
    return Boolean(state.completedAt && Math.floor(now / 86_400_000) > Math.floor(state.completedAt / 86_400_000));
}
