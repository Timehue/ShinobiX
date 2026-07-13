"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferBankRyo = transferBankRyo;
const balance = (value) => Math.max(0, Math.floor(Number(value) || 0));
function transferBankRyo(character, direction, rawAmount) {
    const amount = balance(rawAmount);
    if (amount <= 0)
        return { ok: false, error: 'Enter a positive whole-number amount.' };
    const walletRyo = balance(character.ryo);
    const bankRyo = balance(character.bankRyo);
    if (direction === 'deposit' && walletRyo < amount)
        return { ok: false, error: 'Not enough wallet ryo.' };
    if (direction === 'withdraw' && bankRyo < amount)
        return { ok: false, error: 'Not enough banked ryo.' };
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
