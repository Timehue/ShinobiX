import { useState } from "react";
import { type Character, getBankInterestPercent } from "../App";
import { sendCurrency, previewCredit, TRADE_CURRENCIES, TRADE_CURRENCY_LABELS, TRADE_MINS, TRADE_CAPS, TRADE_TAX_PCT, type TradeCurrency } from "../lib/player-trade";
import { BackToVillageButton } from "../components/BackToVillageButton";
import { gameConfirm } from "../components/GameAlert";
import { requireServerSettlement } from "../lib/server-settlement-gate";

// MIRROR of api/_bank-interest.ts BANK_INTEREST_PRINCIPAL_CAP (gameplay-loop
// audit M-2): interest is paid on at most this much banked ryo, so the projected
// figure shown here matches the server's authoritative payout. Keep in lockstep.
const BANK_INTEREST_PRINCIPAL_CAP = 10_000_000;

export function Bank({ character, updateCharacter, onBack }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; onBack: () => void }) {
    const [amount, setAmount] = useState(0);
    const [movingRyo, setMovingRyo] = useState(false);
    // ── Direct transfer (player-to-player send) state ──
    const [sendTo, setSendTo] = useState("");
    const [sendCurr, setSendCurr] = useState<TradeCurrency>("ryo");
    const [sendAmount, setSendAmount] = useState(0);
    const [sending, setSending] = useState(false);
    const sendBalance = Math.max(0, Math.floor(Number((character as unknown as Record<string, unknown>)[sendCurr] ?? 0)));

    async function submitTransfer() {
        const to = sendTo.trim();
        const value = Math.max(0, Math.floor(Number.isFinite(sendAmount) ? sendAmount : 0));
        if (!to) return alert("Enter the name of the player to send to.");
        if (to.toLowerCase() === character.name.toLowerCase()) return alert("You can't send to yourself.");
        if (value < TRADE_MINS[sendCurr]) return alert(`Minimum transfer is ${TRADE_MINS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        if (value > TRADE_CAPS[sendCurr]) return alert(`Maximum per transfer is ${TRADE_CAPS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        if (value > sendBalance) return alert(`You don't have ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        if (!(await gameConfirm(`Send ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${to}? They receive ${previewCredit(value).toLocaleString()} after a ${Math.round(TRADE_TAX_PCT * 100)}% transfer tax.`))) return;
        setSending(true);
        const res = await sendCurrency(character.name, to, sendCurr, value);
        setSending(false);
        if (!res.ok) return alert(res.error || "Could not send.");
        if (res.duplicate) return alert("That transfer was already sent.");
        // Server is authoritative — reflect the debit locally so autosave converges.
        // Functional updater: deduct off the LATEST character, not the stale render
        // capture, so a concurrent currency change isn't clobbered.
        const debit = res.debit ?? value;
        updateCharacter((prev) => prev ? ({ ...prev, [sendCurr]: Math.max(0, Math.floor(Number((prev as unknown as Record<string, unknown>)[sendCurr] ?? 0)) - debit) }) : prev);
        setSendAmount(0);
        setSendTo("");
        alert(`Sent ${(res.debit ?? value).toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${res.toPlayer ?? to}. They received ${(res.credit ?? 0).toLocaleString()} (${(res.burned ?? 0).toLocaleString()} burned as tax).`);
    }
    const interestPercent = getBankInterestPercent(character);
    const lastClaim = character.lastBankInterestAt ?? 0;
    const nextClaimAt = lastClaim + 24 * 60 * 60 * 1000;
    // eslint-disable-next-line react-hooks/purity -- claim-eligibility is time-sensitive; re-evaluated on every re-render is intentional
    const canClaimInterest = character.bankRyo > 0 && interestPercent > 0 && Date.now() >= nextClaimAt;
    const projectedInterest = Math.max(0, Math.floor(Math.min(character.bankRyo, BANK_INTEREST_PRINCIPAL_CAP) * (interestPercent / 100)));

    async function moveRyo(action: "deposit" | "withdraw") {
        if (action === "deposit" && !requireServerSettlement("bankDeposit")) return;
        // Client validation is only immediate feedback; the server independently
        // validates the same integer bounds against the locked stored balances.
        const value = amount;
        if (!Number.isSafeInteger(value) || value <= 0) return alert("Enter a whole-number amount greater than zero.");
        if (value > 10_000_000) return alert("A single bank transfer cannot exceed 10,000,000 ryo.");
        setMovingRyo(true);
        try {
            const res = await fetch("/api/bank/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, action, amount: value }),
            });
            const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; character?: Character };
            if (!res.ok || !data.ok || !data.character) {
                return alert(data.error || "Could not update your bank account. Please try again.");
            }
            // Replace the local snapshot with the exact version produced under
            // the server save lock. Never reproduce or fall back to the move
            // locally; a stale client balance must not become an economy writer.
            updateCharacter(data.character);
            setAmount(0);
        } catch {
            alert("Could not update your bank account. Please try again.");
        } finally {
            setMovingRyo(false);
        }
    }

    async function claimInterest() {
        if (interestPercent <= 0) return alert("Upgrade the Bank in Town Hall to earn interest.");
        if (character.bankRyo <= 0) return alert("Deposit ryo first.");
        if (Date.now() < nextClaimAt) return alert(`Interest can be claimed again at ${new Date(nextClaimAt).toLocaleString()}.`);
        if (projectedInterest <= 0) return alert("Your deposit is too small to earn interest yet.");
        // Server-authoritative (audit #7 / Stage 3 Phase 4f): the server recomputes
        // the interest from the SAVED bankRyo + bank-upgrade rate under the save
        // lock and stamps lastBankInterestAt against its own clock, so the client
        // can no longer inflate the amount or replay via a rolled-back clock. We add
        // the returned `claimed` delta to our OWN bankRyo (preserving concurrent
        // deposits/withdrawals) and re-assert via autosave — the two converge.
        let data: { ok?: boolean; eligible?: boolean; claimed?: number; error?: string; lastBankInterestAt?: number; reason?: string };
        try {
            const res = await fetch("/api/bank/claim-interest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || "Could not claim bank interest. Please try again.");
        } catch {
            return alert("Could not claim bank interest. Please try again.");
        }
        if (!data.eligible || !data.claimed || data.claimed <= 0) {
            return alert("Bank interest isn't available yet — try again later.");
        }
        const claimed = data.claimed;
        const claimedAt = data.lastBankInterestAt ?? Date.now();
        updateCharacter((prev) => prev ? ({ ...prev, bankRyo: prev.bankRyo + claimed, lastBankInterestAt: claimedAt }) : prev);
        alert(`Bank interest claimed: +${data.claimed.toLocaleString()} ryo.`);
    }

    return (
        <div className="card">
            <BackToVillageButton onClick={onBack} />
            <h2>Bank</h2>
            <div className="summary-box profile-summary">
                <p>Wallet: <strong>{character.ryo.toLocaleString()}</strong> ryo</p>
                <p>Bank: <strong>{character.bankRyo.toLocaleString()}</strong> ryo</p>
                <p>Interest Rate: <strong>{interestPercent.toFixed(2)}%</strong></p>
                <p>Projected Claim: <strong>{projectedInterest.toLocaleString()}</strong> ryo</p>
            </div>
            <label>Amount</label>
            <input type="number" min={1} max={10_000_000} step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <div className="menu">
                <button onClick={() => void moveRyo("deposit")} disabled={movingRyo}>{movingRyo ? "Updating..." : "Deposit"}</button>
                <button onClick={() => void moveRyo("withdraw")} disabled={movingRyo}>{movingRyo ? "Updating..." : "Withdraw"}</button>
                <button onClick={claimInterest} disabled={!canClaimInterest}>Collect Interest</button>
            </div>
            <p className="hint">Town Hall Bank upgrade gives +0.01% interest per level (max 0.5%/day at level 50). Interest can be collected once every 24 hours.</p>

            <h3 style={{ marginTop: "1.5rem" }}>Send to Player</h3>
            <p className="hint" style={{ marginTop: 0 }}>Wire ryo or rare currency to another shinobi. A {Math.round(TRADE_TAX_PCT * 100)}% transfer tax is burned on every send.</p>
            <div className="summary-box profile-summary">
                <p>Your {TRADE_CURRENCY_LABELS[sendCurr]}: <strong>{sendBalance.toLocaleString()}</strong></p>
                {sendAmount > 0 && (
                    <p>Recipient gets: <strong>{previewCredit(sendAmount).toLocaleString()}</strong> · Burned: <strong>{Math.max(0, Math.floor(sendAmount) - previewCredit(sendAmount)).toLocaleString()}</strong></p>
                )}
            </div>
            <label>Recipient</label>
            <input type="text" value={sendTo} placeholder="Player name" onChange={(e) => setSendTo(e.target.value)} />
            <label>Currency</label>
            <select value={sendCurr} onChange={(e) => setSendCurr(e.target.value as TradeCurrency)}>
                {TRADE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{TRADE_CURRENCY_LABELS[c]}</option>
                ))}
            </select>
            <label>Amount</label>
            <input type="number" value={sendAmount} onChange={(e) => setSendAmount(Number(e.target.value))} />
            <div className="menu">
                <button onClick={submitTransfer} disabled={sending}>{sending ? "Sending…" : "Send"}</button>
            </div>
        </div>
    );
}
