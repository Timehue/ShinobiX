import { useState } from "react";
import { type Character, getBankInterestPercent } from "../App";

export function Bank({ character, updateCharacter }: { character: Character; updateCharacter: (character: Character) => void }) {
    const [amount, setAmount] = useState(0);
    const interestPercent = getBankInterestPercent(character);
    const lastClaim = character.lastBankInterestAt ?? 0;
    const nextClaimAt = lastClaim + 24 * 60 * 60 * 1000;
    // eslint-disable-next-line react-hooks/purity -- claim-eligibility is time-sensitive; re-evaluated on every re-render is intentional
    const canClaimInterest = character.bankRyo > 0 && interestPercent > 0 && Date.now() >= nextClaimAt;
    const projectedInterest = Math.max(0, Math.floor(character.bankRyo * (interestPercent / 100)));

    function deposit() {
        const value = Math.max(0, Math.floor(amount));
        if (value > character.ryo) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - value, bankRyo: character.bankRyo + value });
    }

    function withdraw() {
        const value = Math.max(0, Math.floor(amount));
        if (value > character.bankRyo) return alert("Not enough banked ryo.");
        updateCharacter({ ...character, ryo: character.ryo + value, bankRyo: character.bankRyo - value });
    }

    function claimInterest() {
        if (interestPercent <= 0) return alert("Upgrade the Bank in Town Hall to earn interest.");
        if (character.bankRyo <= 0) return alert("Deposit ryo first.");
        if (Date.now() < nextClaimAt) return alert(`Interest can be claimed again at ${new Date(nextClaimAt).toLocaleString()}.`);
        if (projectedInterest <= 0) return alert("Your deposit is too small to earn interest yet.");
        updateCharacter({ ...character, bankRyo: character.bankRyo + projectedInterest, lastBankInterestAt: Date.now() });
        alert(`Bank interest claimed: +${projectedInterest.toLocaleString()} ryo.`);
    }

    return (
        <div className="card">
            <h2>Bank</h2>
            <div className="summary-box profile-summary">
                <p>Wallet: <strong>{character.ryo.toLocaleString()}</strong> ryo</p>
                <p>Bank: <strong>{character.bankRyo.toLocaleString()}</strong> ryo</p>
                <p>Interest Rate: <strong>{interestPercent.toFixed(2)}%</strong></p>
                <p>Projected Claim: <strong>{projectedInterest.toLocaleString()}</strong> ryo</p>
            </div>
            <label>Amount</label>
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            <div className="menu">
                <button onClick={deposit}>Deposit</button>
                <button onClick={withdraw}>Withdraw</button>
                <button onClick={claimInterest} disabled={!canClaimInterest}>Collect Interest</button>
            </div>
            <p className="hint">Town Hall Bank upgrade gives +0.25% interest per level. Interest can be collected once every 24 hours.</p>
        </div>
    );
}
