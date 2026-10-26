import { apiErrorContract, type Contract, type ContractType } from '../../../shared/api-contract';
import {
    bankTransferRequestContract, bankTransferResponseContract,
    bankInterestRequestContract, bankInterestResponseContract, type BankTransferAction,
    bankSnapshotCharacterContract, type BankInterestResponse,
} from '../../../shared/bank-contract';
import { readPlayerSaveSnapshot } from './save-api';

type ApiError = ContractType<typeof apiErrorContract>;
export type BankReply<T> = { status: number; data: T | null; error: ApiError | null };

async function post<T>(url: string, body: unknown, response: Contract<T>): Promise<BankReply<T>> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (res.ok) {
        const parsed = response.safeParse(raw);
        return { status: res.status, data: parsed.success ? parsed.data : null, error: null };
    }
    const parsed = apiErrorContract.safeParse(raw);
    return { status: res.status, data: null, error: parsed.success ? parsed.data : null };
}

export async function transferBankRyo(playerName: string, action: BankTransferAction, amount: number, requestId: string) {
    const body = bankTransferRequestContract.parse({ playerName, action, amount, requestId });
    const reply = await post('/api/bank/transfer', { ...body, direction: action }, bankTransferResponseContract);
    // A valid reply for a different operation is not an acknowledgement of this
    // intent. Receipt balances may differ from the current character on replay.
    if (reply.data && (reply.data.action !== action || reply.data.amount !== amount
        || accountKey(reply.data.character.name) !== accountKey(playerName))) return { ...reply, data: null };
    return reply;
}

export async function claimBankInterest(playerName: string) {
    const reply = await post('/api/bank/claim-interest', bankInterestRequestContract.parse({ playerName }), bankInterestResponseContract);
    if (reply.data?.character && accountKey(reply.data.character.name) !== accountKey(playerName)) return { ...reply, data: null };
    return reply;
}

/** Older interest servers and tax-only refusals need a whole authoritative read,
 * never a partial balance patch paired with a newly advanced save version. */
export async function readBankAuthority(playerName: string, receipt?: BankInterestResponse) {
    if (receipt?.character) {
        if (accountKey(receipt.character.name) !== accountKey(playerName)) throw new Error('The bank receipt belongs to another account.');
        return { character: receipt.character, _saveVersion: receipt._saveVersion };
    }
    return readBankSave(playerName, receipt?._saveVersion);
}

export async function readBankSave(playerName: string, minimumVersion = 0) {
    const response = await fetch(`/api/save/${encodeURIComponent(playerName.toLowerCase())}`, {
        cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('Could not refresh the authoritative bank balance.');
    const snapshot = await readPlayerSaveSnapshot(await response.json(), playerName);
    const version = snapshot._saveVersion ?? 0;
    if (version < minimumVersion) throw new Error('Bank recovery returned an older save.');
    return { character: bankSnapshotCharacterContract.parse(snapshot.character), _saveVersion: version };
}

function accountKey(name: string) { return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32); }

/** Only a validated, definitive refusal can retire a transfer identity. */
export function bankTransferRefused(reply: BankReply<unknown>) {
    return reply.error !== null && [400, 409, 422].includes(reply.status);
}
