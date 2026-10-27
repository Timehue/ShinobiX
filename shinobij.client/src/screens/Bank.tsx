import { BANK_INTEREST_PRINCIPAL_CAP } from "../../../shared/bank-interest";
import { previewCredit, TRADE_CURRENCIES, TRADE_CURRENCY_LABELS, TRADE_TAX_PCT, type TradeCurrency } from "../lib/player-trade";
import { FacilityHero } from "../components/FacilityHero";
import { GameIcon, ShinobiCurrencyIcon } from "../components/icons/GameIcon";
import { useBankController, type BankControllerProps } from "../lib/use-bank-controller";

export function Bank({ onBack, ...props }: BankControllerProps & { onBack: () => void }) {
    const { character } = props;
    const { amount, setAmount, amountError, setAmountError, amountInput, bankBusy, moveRyo,
        recipientError, setRecipientError, sendAmountError, setSendAmountError, recipientInput, sendAmountInput,
        sendTo, setSendTo, sendCurr, setSendCurr, sendAmount, setSendAmount, sending, sendBalance, submitTransfer,
        interestPercent, projectedInterest, interestStatus, canClaimInterest, interestError, claimInterest } = useBankController(props);
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
                                ref={amountInput}
                                readOnly={bankBusy}
                                aria-invalid={!!amountError || undefined}
                                aria-describedby={amountError ? "bank-transfer-error" : undefined}
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={amount}
                                onChange={(e) => { setAmount(Number(e.target.value)); setAmountError(null); }}
                            />
                            <span>ryo</span>
                        </div>
                    </label>
                    {amountError && <p id="bank-transfer-error" className="facility-inline-warning" role="alert">{amountError}</p>}
                    <div className="facility-amount-chips" aria-label="Quick amount choices">
                        <button type="button" disabled={bankBusy} onClick={() => { setAmount(Math.floor(character.ryo / 2)); setAmountError(null); }}>Half wallet</button>
                        <button type="button" disabled={bankBusy} onClick={() => { setAmount(character.ryo); setAmountError(null); }}>Max wallet</button>
                        <button type="button" disabled={bankBusy} onClick={() => { setAmount(character.bankRyo); setAmountError(null); }}>Max vault</button>
                    </div>
                    <div className="bank-transfer-actions" aria-busy={bankBusy}>
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
                        <button onClick={claimInterest} aria-describedby={interestError ? "bank-interest-error" : undefined} disabled={bankBusy || !canClaimInterest || projectedInterest <= 0}>Collect interest</button>
                    </div>
                    {interestError && <p id="bank-interest-error" className="facility-inline-warning" role="alert">{interestError}</p>}
                    <p className="facility-fine-print">Town Hall upgrades add +0.01% interest per level, up to 0.5% daily, paid on up to {BANK_INTEREST_PRINCIPAL_CAP.toLocaleString()} banked ryo. Claims refresh every 24 hours.</p>
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
                        <input
                            id="bank-recipient"
                            ref={recipientInput}
                            readOnly={sending}
                            aria-invalid={!!recipientError || undefined}
                            aria-describedby={recipientError ? "bank-recipient-error" : undefined}
                            type="text"
                            value={sendTo}
                            placeholder="Player name"
                            autoComplete="off"
                            onChange={(e) => { setSendTo(e.target.value); setRecipientError(null); }}
                        />
                    </label>
                    {recipientError && <p id="bank-recipient-error" className="facility-inline-warning" role="alert">{recipientError}</p>}
                    <div className="facility-field-row">
                        <label className="facility-field" htmlFor="bank-currency">
                            <span>Currency</span>
                            <select id="bank-currency" disabled={sending} value={sendCurr} onChange={(e) => { setSendCurr(e.target.value as TradeCurrency); setSendAmountError(null); }}>
                                {TRADE_CURRENCIES.map((c) => (
                                    <option key={c} value={c}>{TRADE_CURRENCY_LABELS[c]}</option>
                                ))}
                            </select>
                        </label>
                        <label className="facility-field" htmlFor="bank-send-amount">
                            <span>Amount</span>
                            <input
                                id="bank-send-amount"
                                ref={sendAmountInput}
                                readOnly={sending}
                                aria-invalid={!!sendAmountError || undefined}
                                aria-describedby={sendAmountError ? "bank-send-amount-error" : undefined}
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={sendAmount}
                                onChange={(e) => { setSendAmount(Number(e.target.value)); setSendAmountError(null); }}
                            />
                        </label>
                    </div>
                    {sendAmountError && <p id="bank-send-amount-error" className="facility-inline-warning" role="alert">{sendAmountError}</p>}
                    <button className="facility-primary-action bank-send-action" onClick={submitTransfer} aria-busy={sending} disabled={sending}>
                        {sending ? "Sending…" : "Review & send"}
                    </button>
                    <p className="facility-fine-print">Transfers are permanent. Confirm the recipient name and final amount before sending.</p>
                </section>
            </div>
        </div>
    );
}
