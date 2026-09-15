import { HG_CLAWBACK_KEYS, type HgCurrencyKey } from './_run-token.js';

type Character = Record<string, unknown>;
export type HollowGateCurrencySource = 'external' | 'run' | 'checkpoint';
export type HollowGateExternalCredits = {
    runToken: string;
    currencies: Partial<Record<HgCurrencyKey, number>>;
    outstandingBankDepositsRyo?: number;
    checkpointVersion?: number;
};

export type HollowGateCreditBasis = { runToken: string; checkpointVersion: number };

function activeRunToken(character: Character): string | null {
    const run = character.hollowGateRun;
    if (!run || typeof run !== 'object' || Array.isArray(run)) return null;
    const token = (run as Character).runToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
}

export function hollowGateCreditBasis(character: Character): HollowGateCreditBasis | null {
    const runToken = activeRunToken(character);
    if (!runToken) return null;
    const ledger = character.hollowGateExternalCredits as HollowGateExternalCredits | null | undefined;
    const checkpointVersion = ledger?.runToken === runToken ? ledger.checkpointVersion ?? 0 : 0;
    if (typeof checkpointVersion !== 'number' || !Number.isSafeInteger(checkpointVersion) || checkpointVersion < 0) {
        throw new Error('Invalid Hollow Gate credit checkpoint.');
    }
    return { runToken, checkpointVersion };
}

/** A compensation reverses spending only within the same entry/checkpoint.
 * Money withheld before this basis is legitimate incoming currency. */
export function hollowGateRefundCurrencySource(charged: Character, current: Character): HollowGateCurrencySource {
    const before = hollowGateCreditBasis(charged);
    const after = hollowGateCreditBasis(current);
    return before && after && before.runToken === after.runToken && before.checkpointVersion === after.checkpointVersion
        ? 'run' : 'external';
}

function walletAmount(value: unknown): number {
    const amount = Math.max(0, Math.floor(Number(value) || 0));
    if (!Number.isSafeInteger(amount)) throw new RangeError('Invalid Hollow Gate currency amount.');
    return amount;
}

function outstandingBankDeposits(character: Character, token: string): number {
    const ledger = character.hollowGateExternalCredits as HollowGateExternalCredits | null | undefined;
    if (!ledger || ledger.runToken !== token || ledger.outstandingBankDepositsRyo === undefined) return 0;
    const value = ledger.outstandingBankDepositsRyo;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid Hollow Gate bank-deposit provenance.');
    }
    return value;
}

/** Only the server-owned field is read; neither the public run projection nor
 * an unexplained wallet surplus can establish external-credit provenance. */
export function hollowGateExternalCredits(character: Character, runToken: string): Partial<Record<HgCurrencyKey, number>> {
    const raw = character.hollowGateExternalCredits;
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Hollow Gate external-credit ledger.');
    const ledger = raw as Record<string, unknown>;
    if (ledger.runToken !== runToken) return {};
    if (!ledger.currencies || typeof ledger.currencies !== 'object' || Array.isArray(ledger.currencies)) {
        throw new Error('Invalid Hollow Gate external-credit currencies.');
    }
    const currencies = ledger.currencies as Record<string, unknown>;
    const result: Partial<Record<HgCurrencyKey, number>> = {};
    for (const key of HG_CLAWBACK_KEYS) {
        const value = currencies[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
            throw new Error('Invalid Hollow Gate external-credit amount.');
        }
        if (value) result[key] = value;
    }
    return result;
}

/** Called only by trusted versioned domain writes with their pre-mutation
 * character. The credit and provenance share the same save/CAS and existing
 * source receipt. Retrying an identical committed write cannot add it again.
 * No run-store write/lock is taken from inside a player-save lock.
 */
export function recordHollowGateExternalCredits(
    previous: Character,
    next: Character,
    source: HollowGateCurrencySource = 'external',
): Character {
    const token = activeRunToken(next);
    if (!token) {
        if (!Object.hasOwn(next, 'hollowGateExternalCredits') && !Object.hasOwn(previous, 'hollowGateExternalCredits')) return next;
        // Null is an explicit clear through mergePreservingImages; omission
        // would preserve the previous run's field during a partial-save merge.
        return { ...next, hollowGateExternalCredits: null };
    }
    const sameRun = activeRunToken(previous) === token;
    const checkpointVersion = (sameRun ? hollowGateCreditBasis(previous)!.checkpointVersion : 0)
        + (source === 'checkpoint' ? 1 : 0);
    if (!Number.isSafeInteger(checkpointVersion)) throw new RangeError('Hollow Gate credit checkpoint overflow.');
    const currencies = sameRun && source !== 'checkpoint'
        ? hollowGateExternalCredits(previous, token) : {};
    let bankDeposits = sameRun && source !== 'checkpoint' ? outstandingBankDeposits(previous, token) : 0;
    if (sameRun && source === 'external') {
        const walletDelta = walletAmount(next.ryo) - walletAmount(previous.ryo);
        const bankDelta = walletAmount(next.bankRyo) - walletAmount(previous.bankRyo);
        bankDeposits += Math.min(Math.max(0, -walletDelta), Math.max(0, bankDelta));
        if (!Number.isSafeInteger(bankDeposits)) throw new RangeError('Hollow Gate bank-deposit provenance overflow.');
        // Depositing and withdrawing the same ryo is not new income. Consume
        // in-run deposits first; withdrawals from the pre-run bank remain
        // legitimate external credits to the wallet.
        const recycledRyo = Math.min(bankDeposits, Math.max(0, walletDelta), Math.max(0, -bankDelta));
        bankDeposits -= recycledRyo;
        for (const key of HG_CLAWBACK_KEYS) {
            const gained = Math.max(0, walletAmount(next[key]) - walletAmount(previous[key])) - (key === 'ryo' ? recycledRyo : 0);
            if (!gained) continue;
            const total = (currencies[key] ?? 0) + gained;
            if (!Number.isSafeInteger(total)) throw new RangeError('Hollow Gate external-credit ledger overflow.');
            currencies[key] = total;
        }
    }
    return { ...next, hollowGateExternalCredits: {
        runToken: token, currencies,
        ...(checkpointVersion ? { checkpointVersion } : {}),
        ...(bankDeposits ? { outstandingBankDepositsRyo: bankDeposits } : {}),
    } satisfies HollowGateExternalCredits };
}

export function hollowGateProtectedCurrencyBaseline(
    character: Character,
    runToken: string,
    key: HgCurrencyKey,
    entry: unknown,
): number {
    const total = walletAmount(entry) + (hollowGateExternalCredits(character, runToken)[key] ?? 0);
    if (!Number.isSafeInteger(total)) throw new RangeError('Hollow Gate protected baseline overflow.');
    return total;
}
