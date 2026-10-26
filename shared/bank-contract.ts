import { acknowledged, boolean, choice, contract, ContractError, record, taxFields, text, whole, type ContractType } from './api-contract.js';
import { parseSettlementRequestId } from './settlement-request-id.js';

export const BANK_TRANSFER_MAX_AMOUNT = 10_000_000;
const actions = ['deposit', 'withdraw'] as const;

function storedBalance(value: unknown, message: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ContractError(message);
    return value;
}

export function parseBankTransferAction(raw: unknown) {
    return raw === 'deposit' || raw === 'withdraw' ? raw : null;
}
export type BankTransferAction = NonNullable<ReturnType<typeof parseBankTransferAction>>;

export function parseBankTransferAmount(raw: unknown): number | null {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 && raw <= BANK_TRANSFER_MAX_AMOUNT ? raw : null;
}

export const bankInterestRequestContract = contract((value: unknown) => {
    const body = record(value, 'Missing playerName.');
    return { playerName: text(body.playerName, 'Missing playerName.') };
});

export const bankTransferRequestContract = contract((value: unknown) => {
    const body = record(value, 'Missing playerName.');
    const { playerName } = bankInterestRequestContract.parse(body);
    // Legacy direction alias and action precedence are part of the contract.
    const action = choice(body.action ?? body.direction, actions, 'Action must be deposit or withdraw.');
    const amount = whole(body.amount, 'Amount must be a whole number from 1 to 10,000,000.', 1, BANK_TRANSFER_MAX_AMOUNT);
    const requestId = parseSettlementRequestId(body.requestId);
    if (body.requestId !== undefined && body.requestId !== null && !requestId) throw new ContractError('Invalid requestId.');
    return { playerName, action, amount, ...(requestId ? { requestId } : {}) };
});

export const bankTransferResponseContract = contract((value: unknown) => {
    const body = acknowledged(value);
    const character = record(body.character, 'Missing authoritative character.');
    // Bank validates the fields it consumes. The rest of the save is opaque and
    // retained verbatim; this is not a replacement for save normalization.
    const authoritative = {
        ...character,
        name: text(character.name, 'Missing character name.'),
        // Replays return the current save, which can retain legacy fractions.
        ryo: storedBalance(character.ryo, 'Invalid wallet balance.'),
        bankRyo: storedBalance(character.bankRyo, 'Invalid vault balance.'),
    };
    return {
        ...body,
        ok: true as const,
        action: choice(body.action, actions, 'Invalid transfer action.'),
        amount: whole(body.amount, 'Invalid transfer amount.', 1, BANK_TRANSFER_MAX_AMOUNT),
        ryo: whole(body.ryo, 'Invalid receipt wallet balance.'),
        bankRyo: whole(body.bankRyo, 'Invalid receipt vault balance.'),
        character: authoritative,
        _saveVersion: whole(body._saveVersion, 'Invalid save version.', body.replayed === true ? 0 : 1),
        ...(body.replayed === undefined ? {} : { replayed: boolean(body.replayed, 'Invalid replay flag.') }),
        ...taxFields(body),
    };
});

export const bankInterestResponseContract = contract((value: unknown) => {
    const body = acknowledged(value);
    const common = {
        ok: true as const,
        nextClaimAt: whole(body.nextClaimAt, 'Invalid next claim time.'),
        // A read-only refusal can come from a legacy save with no version yet.
        _saveVersion: whole(body._saveVersion, 'Invalid save version.', body.eligible === false ? 0 : 1),
        ...taxFields(body),
    };
    if (body.eligible === false) return {
        ...common,
        eligible: false as const,
        claimed: whole(body.claimed, 'Invalid uncredited claim.', 0, 0),
        reason: choice(body.reason, ['no-upgrade', 'empty', 'cooldown', 'too-small'], 'Invalid interest refusal reason.'),
    };
    if (body.eligible !== true) throw new ContractError('Invalid interest eligibility.');
    return {
        ...common,
        eligible: true as const,
        claimed: whole(body.claimed, 'Invalid credited interest.', 1),
        bankRyo: storedBalance(body.bankRyo, 'Invalid interest balance.'),
        lastBankInterestAt: whole(body.lastBankInterestAt, 'Invalid claim time.', 1),
    };
});

export type BankTransferRequest = ContractType<typeof bankTransferRequestContract>;
export type BankTransferResponse = ContractType<typeof bankTransferResponseContract>;
export type BankInterestRequest = ContractType<typeof bankInterestRequestContract>;
export type BankInterestResponse = ContractType<typeof bankInterestResponseContract>;
