import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { fetchBountyBoard, placeBounty, type BountyEntry } from "../lib/pvp-bounty";
import { bountyBackerLabel, formatBountyAge, formatReputationNumber, sortBountiesByAmount } from "../lib/reputation-profile";

/**
 * Self-contained PvP bounty board — view active contracts + stake ryo on a
 * player's head. Extracted so the Battle Arena hub can host it (the Hall of
 * Legends "Bounties" tab keeps its own richly-styled copy). Styled with the
 * generic arena-lobby classes (`summary-box` / `hint` / `menu` / `jutsu-list`)
 * so it looks at home wherever it's dropped, no screen-specific CSS required.
 *
 * The server is authoritative for the ryo escrow (see api/pvp/bounty.ts); this
 * only reflects the debit locally so the autosave converges.
 */
export function BountyBoardPanel({
    character,
    updateCharacter,
    playerRoster,
}: {
    character: Character;
    updateCharacter: (character: Character) => void;
    playerRoster: { name: string }[];
}) {
    const [bounties, setBounties] = useState<BountyEntry[] | null>(null);
    const [bountyTarget, setBountyTarget] = useState("");
    const [bountyAmount, setBountyAmount] = useState(5000);

    useEffect(() => {
        let alive = true;
        void fetchBountyBoard().then((list) => { if (alive) setBounties(list); });
        return () => { alive = false; };
    }, []);

    async function submitBounty() {
        const target = bountyTarget.trim();
        if (!target) return alert("Choose a player to put a bounty on.");
        if (target.toLowerCase() === character.name.toLowerCase()) return alert("You can't bounty yourself.");
        if (bountyAmount < 1000) return alert("Minimum bounty is 1,000 ryo.");
        if ((character.ryo ?? 0) < bountyAmount) return alert("You don't have enough ryo.");
        const res = await placeBounty(character.name, target, bountyAmount);
        if (!res.ok) return alert(res.error || "Could not place the bounty.");
        updateCharacter({ ...character, ryo: (character.ryo ?? 0) - bountyAmount });
        if (res.bounties) setBounties(res.bounties);
        setBountyTarget("");
        alert(`Bounty placed: ${bountyAmount.toLocaleString()} ryo on ${target}'s head.`);
    }

    const me = character.name.toLowerCase();

    return (
        <section className="summary-box">
            <h3>💰 Bounty Board</h3>
            <p className="hint">
                Stake ryo on a player's head; whoever beats them in a duel claims the pool.
                Your ryo: {(character.ryo ?? 0).toLocaleString()}.
            </p>

            <label>Target Player</label>
            <input
                list="arena-bounty-target-options"
                value={bountyTarget}
                onChange={(e) => setBountyTarget(e.target.value)}
                placeholder="Player name"
            />
            <datalist id="arena-bounty-target-options">
                {playerRoster
                    .filter((p) => p.name.toLowerCase() !== me)
                    .map((p) => <option key={p.name} value={p.name} />)}
            </datalist>

            <label>Bounty (ryo)</label>
            <input
                type="number"
                min={1000}
                step={1000}
                value={bountyAmount}
                onChange={(e) => setBountyAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            <div className="menu"><button onClick={() => void submitBounty()}>Place Bounty</button></div>

            <p className="hint" style={{ marginTop: 10 }}>
                Active bounties — defeat the target in a duel to claim the pool.
            </p>
            {bounties === null ? (
                <p className="hint">Checking the bounty ledger...</p>
            ) : bounties.length === 0 ? (
                <p className="hint">No active bounties are posted.</p>
            ) : (
                <div className="jutsu-list">
                    {sortBountiesByAmount(bounties).map((b, i) => {
                        const isMe = b.target.toLowerCase() === me;
                        return (
                            <div
                                className="summary-box"
                                key={b.target}
                                style={isMe ? { borderColor: "rgba(248,113,113,0.6)" } : undefined}
                            >
                                <strong>#{i + 1} {b.target}{isMe ? " (you)" : ""}</strong>
                                <p className="hint">{bountyBackerLabel(b)} · updated {formatBountyAge(b.updatedAt)}</p>
                                <span>{formatReputationNumber(b.amount)} ryo</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
