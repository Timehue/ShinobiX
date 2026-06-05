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
        // Number.isFinite guard: a non-numeric input yields NaN, and `NaN > ryo`
        // is false — without this the transfer would proceed and write `ryo - NaN
        // = NaN`, corrupting the save.
        const value = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
        if (value > character.ryo) return alert("Not enough ryo.");
        updateCharacter({ ...character, ryo: character.ryo - value, bankRyo: character.bankRyo + value });
    }

    function withdraw() {
        const value = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
        if (value > character.bankRyo) return alert("Not enough banked ryo.");
        updateCharacter({ ...character, ryo: character.ryo + value, bankRyo: character.bankRyo - value });
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
        updateCharacter({ ...character, bankRyo: character.bankRyo + data.claimed, lastBankInterestAt: data.lastBankInterestAt ?? Date.now() });
        alert(`Bank interest claimed: +${data.claimed.toLocaleString()} ryo.`);
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
