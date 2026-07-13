export type BankTransferDirection = 'deposit' | 'withdraw';

export type BankTransferResult =
    | { ok: true; character: Record<string, unknown>; walletRyo: number; bankRyo: number; amount: number }
    | { ok: false; error: string };

const balance = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

export function transferBankRyo(
    character: Record<string, unknown>,
    direction: BankTransferDirection,
    rawAmount: unknown,
): BankTransferResult {
    const amount = balance(rawAmount);
    if (amount <= 0) return { ok: false, error: 'Enter a positive whole-number amount.' };
    const walletRyo = balance(character.ryo);
    const bankRyo = balance(character.bankRyo);
    if (direction === 'deposit' && walletRyo < amount) return { ok: false, error: 'Not enough wallet ryo.' };
    if (direction === 'withdraw' && bankRyo < amount) return { ok: false, error: 'Not enough banked ryo.' };
    const nextWallet = direction === 'deposit' ? walletRyo - amount : walletRyo + amount;
    const nextBank = direction === 'deposit' ? bankRyo + amount : bankRyo - amount;
    return {
        ok: true,
        character: { ...character, ryo: nextWallet, bankRyo: nextBank },
        walletRyo: nextWallet,
        bankRyo: nextBank,
        amount,
    };
}
