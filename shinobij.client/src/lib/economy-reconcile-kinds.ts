/*
 * Which stuck economy journals /api/admin/economy-reconcile can finish, so the
 * admin economy view offers Reconcile exactly where the server can act.
 *
 * - Retry-safe save->shared settlements (api/_save-debit-saga.ts): the server
 *   resumes any unfinished journal of these kinds with the same idempotent
 *   credit step a retry would run. The list mirrors SAVE_DEBIT_SAGAS in
 *   api/_save-debit-kinds.ts (economy-reconcile-kinds.test.ts keeps them equal).
 * - Two stake refunds whose automatic refund failed (`needs-reconcile`): the
 *   Hollow Gate unlock's Honor Seals and the Kage declaration's ryo.
 * - A clan territory War Supply collection (`needs-reconcile`).
 */
export const RECONCILABLE_SAGA_KINDS = [
    'shrine-offer',
    'pvp-bounty-place',
    'clan-treasury-donate',
    'village-treasury-donate',
    'village-tax',
    'village-hollow-gate-unlock',
    'clan-war-declare',
    'kage-challenge-stake',
] as const;

const LEGACY_STAKE_REFUNDS: Readonly<Record<string, string>> = {
    'hollow-gate-unlock': 'honorSeals',
    'kage-challenge-declare': 'ryo',
};

export function canReconcileEconomyTx(tx: { state: string; kind: string; resource: string }): boolean {
    if ((RECONCILABLE_SAGA_KINDS as readonly string[]).includes(tx.kind)) {
        return tx.state !== 'complete' && tx.state !== 'refunded';
    }
    if (tx.state !== 'needs-reconcile') return false;
    if (LEGACY_STAKE_REFUNDS[tx.kind] === tx.resource) return true;
    return tx.kind === 'clan-territory-collect-supply' && tx.resource === 'warSupply';
}
