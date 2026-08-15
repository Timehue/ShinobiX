/**
 * Explicit retired-state surface for live Pet Ranked matchmaking.
 *
 * The former queue launched the ordinary no-reward realtime duel and therefore
 * could not settle ranked rating. Keep the panel non-actionable until the owner
 * selects one authoritative ranked combat lifecycle; asynchronous ladder modes
 * remain available elsewhere on the Pet Ladder screen.
 */
export function PetLadderQueuePanel() {
    return (
        <div className="summary-box" data-testid="pet-ladder-queue-retired" style={{ padding: "0.9rem", marginBottom: "0.9rem" }}>
            <h3 className="pl-h" style={{ marginTop: 0 }}>Ranked live queue unavailable</h3>
            <p className="hint" style={{ margin: 0 }}>
                Live ranked matchmaking is paused until its combat result and rating settlement share one server-owned match proof.
                Asynchronous Pet Ladder battles remain available below.
            </p>
        </div>
    );
}
