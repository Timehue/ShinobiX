import { useRef, useState } from "react";
import { type Character, getBankInterestPercent } from "../App";
import { sendCurrency, previewCredit, TRADE_CURRENCIES, TRADE_CURRENCY_LABELS, TRADE_MINS, TRADE_CAPS, TRADE_TAX_PCT, type TradeCurrency } from "../lib/player-trade";
import { gameConfirm } from "../components/GameAlert";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { AMBIGUOUS_ACTION_MESSAGE } from "../lib/ambiguous-action";
import { gameToast } from "../components/GameToast";
import type { VersionedCharacterCommit } from "../types/character";
import { FacilityHero } from "../components/FacilityHero";
import { GameIcon, ShinobiCurrencyIcon } from "../components/icons/GameIcon";

// MIRROR of api/_bank-interest.ts BANK_INTEREST_PRINCIPAL_CAP (gameplay-loop
// audit M-2): interest is paid on at most this much banked ryo, so the projected
// figure shown here matches the server's authoritative payout. Keep in lockstep.
const BANK_INTEREST_PRINCIPAL_CAP = 10_000_000;

export function Bank({ character, updateCharacter, onVersionedCharacter, onBack }: { character: Character; updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>; onVersionedCharacter: VersionedCharacterCommit; onBack: () => void }) {
    const [amount, setAmount] = useState(0);
    const [bankBusy, setBankBusy] = useState(false);
    const bankBusyRef = useRef(false);
    // ── Direct transfer (player-to-player send) state ──
    const [sendTo, setSendTo] = useState("");
    const [sendCurr, setSendCurr] = useState<TradeCurrency>("ryo");
    const [sendAmount, setSendAmount] = useState(0);
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const sendBalance = Math.max(0, Math.floor(Number((character as unknown as Record<string, unknown>)[sendCurr] ?? 0)));

    async function submitTransfer() {
        if (sendingRef.current) return;
        const to = sendTo.trim();
        const value = Math.max(0, Math.floor(Number.isFinite(sendAmount) ? sendAmount : 0));
        if (!to) return alert("Enter the name of the player to send to.");
        if (to.toLowerCase() === character.name.toLowerCase()) return alert("You can't send to yourself.");
        if (value < TRADE_MINS[sendCurr]) return alert(`Minimum transfer is ${TRADE_MINS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        if (value > TRADE_CAPS[sendCurr]) return alert(`Maximum per transfer is ${TRADE_CAPS[sendCurr].toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        if (value > sendBalance) return alert(`You don't have ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]}.`);
        sendingRef.current = true;
        setSending(true);
        try {
            if (!(await gameConfirm(`Send ${value.toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${to}? They receive ${previewCredit(value).toLocaleString()} after a ${Math.round(TRADE_TAX_PCT * 100)}% transfer tax.`))) return;
            const res = await sendCurrency(character.name, to, sendCurr, value);
            if (!res.ok) return alert(res.error || "Could not send.");
            if (res.duplicate) return alert("That transfer was already sent.");
            // Server is authoritative — reflect the debit locally so autosave converges.
            updateCharacter((prev) => prev ? ({
                ...prev,
                [sendCurr]: res.senderBalance ?? Math.max(0, Math.floor(Number((prev as unknown as Record<string, unknown>)[sendCurr]) || 0)),
            }) : prev);
            setSendAmount(0);
            setSendTo("");
            gameToast(`Sent ${(res.debit ?? value).toLocaleString()} ${TRADE_CURRENCY_LABELS[sendCurr]} to ${res.toPlayer ?? to}. They received ${(res.credit ?? 0).toLocaleString()} (${(res.burned ?? 0).toLocaleString()} burned as tax).`);
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }
    const interestPercent = getBankInterestPercent(character);
    const lastClaim = character.lastBankInterestAt ?? 0;
    const nextClaimAt = lastClaim + 24 * 60 * 60 * 1000;
    // eslint-disable-next-line react-hooks/purity -- claim-eligibility is time-sensitive; re-evaluated on every re-render is intentional
    const canClaimInterest = character.bankRyo > 0 && interestPercent > 0 && Date.now() >= nextClaimAt;
    const projectedInterest = Math.max(0, Math.floor(Math.min(character.bankRyo, BANK_INTEREST_PRINCIPAL_CAP) * (interestPercent / 100)));
    const interestStatus = canClaimInterest
        ? "Ready now"
        : interestPercent <= 0
            ? "Upgrade required"
            : character.bankRyo <= 0
                ? "Deposit required"
                : new Date(nextClaimAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

    async function moveRyo(direction: "deposit" | "withdraw") {
        if (direction === "deposit" && !requireServerSettlement("bankDeposit")) return;
        // Number.isFinite guard: a non-numeric input yields NaN, and `NaN > ryo`
        // is false — without this the transfer would proceed and write `ryo - NaN
        // = NaN`, corrupting the save.
        const value = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
        if (value <= 0) return alert("Enter a positive amount.");
        if (direction === "deposit" && value > character.ryo) return alert("Not enough ryo.");
        if (direction === "withdraw" && value > character.bankRyo) return alert("Not enough banked ryo.");
        if (bankBusyRef.current) return;
        bankBusyRef.current = true;
        setBankBusy(true);
        try {
            const response = await fetch("/api/bank/transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name, direction, amount: value }),
            });
            const data = await response.json().catch(() => null) as { error?: string; character?: Character; _saveVersion?: number } | null;
            if (!response.ok || !data?.character) throw new Error(data?.error || "Bank transfer failed.");
            if (!onVersionedCharacter(data.character, data._saveVersion)) return;
            setAmount(0);
        } catch (error) {
            alert(error instanceof Error ? error.message : "Bank transfer failed.");
        } finally {
            bankBusyRef.current = false;
            setBankBusy(false);
        }
    }

    async function claimInterest() {
        if (bankBusyRef.current) return;
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
        bankBusyRef.current = true;
        setBankBusy(true);
        let data: { ok?: boolean; eligible?: boolean; claimed?: number; bankRyo?: number; error?: string; lastBankInterestAt?: number; reason?: string };
        try {
            const res = await fetch("/api/bank/claim-interest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName: character.name }),
            });
            data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) return alert(data.error || AMBIGUOUS_ACTION_MESSAGE);
        } catch {
            return alert(AMBIGUOUS_ACTION_MESSAGE);
        } finally {
            bankBusyRef.current = false;
            setBankBusy(false);
        }
        if (!data.eligible || !data.claimed || data.claimed <= 0) {
            return alert("Bank interest isn't available yet — try again later.");
        }
        const claimedAt = data.lastBankInterestAt ?? Date.now();
        updateCharacter((prev) => prev ? ({ ...prev, bankRyo: data.bankRyo ?? prev.bankRyo, lastBankInterestAt: claimedAt }) : prev);
        alert(`Bank interest claimed: +${data.claimed.toLocaleString()} ryo.`);
    }

    return (
        <div className="card civic-facility-screen bank-screen">
            <FacilityHero
                facility="bank"
                eyebrow={`${character.village} · Treasury District`}
                title="Bank"
                description="Secure your ryo, collect village-backed interest, and send funds across the shinobi network."
                onBack={onBack}
                metrics={[
                    { label: "On hand", value: `${character.ryo.toLocaleString()} ryo` },
                    { label: "In the vault", value: `${character.bankRyo.toLocaleString()} ryo` },
                    { label: "Daily rate", value: `${interestPercent.toFixed(2)}%`, tone: interestPercent > 0 ? "good" : "warning" },
                ]}
            />

            <div className="facility-content-grid bank-workspace">
                <section className="facility-panel bank-vault-panel">
                    <div className="facility-panel-heading">
                        <span className="facility-panel-icon"><GameIcon name="ryo" size={24} /></span>
                        <div>
                            <p className="facility-eyebrow">Personal vault</p>
                            <h3>Move ryo</h3>
                        </div>
                    </div>

                    <div className="bank-balance-rail">
                        <div>
                            <span>Wallet</span>
                            <strong>{character.ryo.toLocaleString()}</strong>
                        </div>
                        <span className="bank-balance-arrow" aria-hidden="true">⇄</span>
                        <div>
                            <span>Banked</span>
                            <strong>{character.bankRyo.toLocaleString()}</strong>
                        </div>
                    </div>

                    <label className="facility-field" htmlFor="bank-transfer-amount">
                        <span>Transfer amount</span>
                        <div className="facility-currency-input">
                            <ShinobiCurrencyIcon name="ryo" size={24} />
                            <input
                                id="bank-transfer-amount"
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={amount}
                                onChange={(e) => setAmount(Number(e.target.value))}
                            />
                            <span>ryo</span>
                        </div>
                    </label>
                    <div className="facility-amount-chips" aria-label="Quick amount choices">
                        <button type="button" onClick={() => setAmount(Math.floor(character.ryo / 2))}>Half wallet</button>
                        <button type="button" onClick={() => setAmount(character.ryo)}>Max wallet</button>
                        <button type="button" onClick={() => setAmount(character.bankRyo)}>Max vault</button>
                    </div>
                    <div className="bank-transfer-actions">
                        <button className="facility-primary-action" onClick={() => void moveRyo("deposit")} disabled={bankBusy}>
                            {bankBusy ? "Working…" : "Deposit to vault"}
                        </button>
                        <button className="facility-secondary-action" onClick={() => void moveRyo("withdraw")} disabled={bankBusy}>
                            Withdraw to wallet
                        </button>
                    </div>

                    <div className="bank-interest-callout" data-ready={canClaimInterest}>
                        <div className="bank-interest-copy">
                            <GameIcon name="clock" size={22} />
                            <div>
                                <span>Next interest claim</span>
                                <strong>{interestStatus}</strong>
                                <small>Projected payout · {projectedInterest.toLocaleString()} ryo</small>
                            </div>
                        </div>
                        <button onClick={claimInterest} disabled={bankBusy || !canClaimInterest}>Collect interest</button>
                    </div>
                    <p className="facility-fine-print">Town Hall upgrades add +0.01% interest per level, up to 0.5% daily. Claims refresh every 24 hours.</p>
                </section>

                <section className="facility-panel bank-wire-panel">
                    <div className="facility-panel-heading">
                        <span className="facility-panel-icon"><GameIcon name="scroll" size={24} /></span>
                        <div>
                            <p className="facility-eyebrow">Shinobi wire</p>
                            <h3>Send to a player</h3>
                        </div>
                    </div>
                    <p className="facility-panel-intro">Transfer ryo or rare currency directly. The recipient receives the final amount after a {Math.round(TRADE_TAX_PCT * 100)}% burn tax.</p>

                    <div className="bank-wire-preview">
                        <span>Available {TRADE_CURRENCY_LABELS[sendCurr]}</span>
                        <strong>{sendBalance.toLocaleString()}</strong>
                        {sendAmount > 0 && (
                            <div>
                                <span>Recipient gets <b>{previewCredit(sendAmount).toLocaleString()}</b></span>
                                <span>Tax burned <b>{Math.max(0, Math.floor(sendAmount) - previewCredit(sendAmount)).toLocaleString()}</b></span>
                            </div>
                        )}
                    </div>

                    <label className="facility-field" htmlFor="bank-recipient">
                        <span>Recipient</span>
                        <input id="bank-recipient" type="text" value={sendTo} placeholder="Player name" autoComplete="off" onChange={(e) => setSendTo(e.target.value)} />
                    </label>
                    <div className="facility-field-row">
                        <label className="facility-field" htmlFor="bank-currency">
                            <span>Currency</span>
                            <select id="bank-currency" value={sendCurr} onChange={(e) => setSendCurr(e.target.value as TradeCurrency)}>
                                {TRADE_CURRENCIES.map((c) => (
                                    <option key={c} value={c}>{TRADE_CURRENCY_LABELS[c]}</option>
                                ))}
                            </select>
                        </label>
                        <label className="facility-field" htmlFor="bank-send-amount">
                            <span>Amount</span>
                            <input id="bank-send-amount" type="number" min={0} inputMode="numeric" value={sendAmount} onChange={(e) => setSendAmount(Number(e.target.value))} />
                        </label>
                    </div>
                    <button className="facility-primary-action bank-send-action" onClick={submitTransfer} disabled={sending || !sendTo.trim() || sendAmount <= 0}>
                        {sending ? "Sending…" : "Review & send"}
                    </button>
                    <p className="facility-fine-print">Transfers are permanent. Confirm the recipient name and final amount before sending.</p>
                </section>
            </div>
        </div>
    );
}
