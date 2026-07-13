"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BANK_TRANSFER_MAX_AMOUNT = void 0;
exports.parseBankTransferAction = parseBankTransferAction;
exports.parseBankTransferAmount = parseBankTransferAmount;
exports.applyBankTransfer = applyBankTransfer;
exports.BANK_TRANSFER_MAX_AMOUNT = 10_000_000;
function parseBankTransferAction(raw) {
    return raw === 'deposit' || raw === 'withdraw' ? raw : null;
}
/** Require a bounded, whole-number move before entering the save lock. */
function parseBankTransferAmount(raw) {
    return typeof raw === 'number'
        && Number.isSafeInteger(raw)
        && raw > 0
        && raw <= exports.BANK_TRANSFER_MAX_AMOUNT
        ? raw
        : null;
}
function storedBalance(raw) {
    // Missing balances are valid only for legacy saves and mean zero. Any
    // present malformed value fails closed instead of being rounded/coerced.
    if (raw === undefined || raw === null)
        return 0;
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}
/** Apply one exact wallet-to-bank or bank-to-wallet move to stored state. */
function applyBankTransfer(character, action, amount) {
    const cleanAmount = parseBankTransferAmount(amount);
    if (cleanAmount === null) {
        return {
            ok: false,
            status: 400,
            error: `Amount must be a whole number from 1 to ${exports.BANK_TRANSFER_MAX_AMOUNT.toLocaleString()}.`,
        };
    }
    const ryo = storedBalance(character.ryo);
    const bankRyo = storedBalance(character.bankRyo);
    if (ryo === null || bankRyo === null) {
        return { ok: false, status: 409, error: 'Stored bank balances are invalid. Contact support.' };
    }
    if (action === 'deposit') {
        if (ryo < cleanAmount)
            return { ok: false, status: 400, error: 'Not enough ryo.' };
        const nextBankRyo = bankRyo + cleanAmount;
        if (!Number.isSafeInteger(nextBankRyo)) {
            return { ok: false, status: 409, error: 'Bank balance is too large to update safely.' };
        }
        return {
            ok: true,
            action,
            amount: cleanAmount,
            ryo: ryo - cleanAmount,
            bankRyo: nextBankRyo,
            character: { ...character, ryo: ryo - cleanAmount, bankRyo: nextBankRyo },
        };
    }
    if (bankRyo < cleanAmount)
        return { ok: false, status: 400, error: 'Not enough banked ryo.' };
    const nextRyo = ryo + cleanAmount;
    if (!Number.isSafeInteger(nextRyo)) {
        return { ok: false, status: 409, error: 'Wallet balance is too large to update safely.' };
    }
    return {
        ok: true,
        action,
        amount: cleanAmount,
        ryo: nextRyo,
        bankRyo: bankRyo - cleanAmount,
        character: { ...character, ryo: nextRyo, bankRyo: bankRyo - cleanAmount },
    };
}
