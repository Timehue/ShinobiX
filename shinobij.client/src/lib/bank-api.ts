import { apiErrorContract, type Contract, type ContractType } from '../../../shared/api-contract';
import {
    bankTransferRequestContract, bankTransferResponseContract,
    bankInterestRequestContract, bankInterestResponseContract, type BankTransferAction,
} from '../../../shared/bank-contract';

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

export function claimBankInterest(playerName: string) {
    return post('/api/bank/claim-interest', bankInterestRequestContract.parse({ playerName }), bankInterestResponseContract);
}

function accountKey(name: string) { return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32); }

/** Only a validated, definitive refusal can retire a transfer identity. */
export function bankTransferRefused(reply: BankReply<unknown>) {
    return reply.error !== null && [400, 409, 422].includes(reply.status);
}
