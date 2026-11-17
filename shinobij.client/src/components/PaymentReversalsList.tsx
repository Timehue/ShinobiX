// Tebex refunds, chargebacks and open disputes, as /api/admin/moderation
// returns them (api/tebex/_reversal.ts TebexReversalRecord). A row with a
// shortfall is a player who spent Shards they then charged back: what to do
// about it (a freeze, a ban) is the owner's call, so this only lists them.
export type PaymentReversal = {
    transactionId: string;
    playerName: string;
    state: "dispute-open" | "dispute-won" | "reversed";
    kind: string;
    shardsGranted: number;
    shardsDebited: number;
    shortfall: number;
    supporter?: { reference: string; outcome: string; cancel?: string };
    note?: string;
    updatedAt: number;
};

function describe(row: PaymentReversal): string {
    if (row.state === "dispute-open") return "dispute open: nothing taken yet";
    if (row.state === "dispute-won") return "dispute won: nothing taken";
    const parts = [`${row.kind}: took back ${row.shardsDebited} of ${row.shardsGranted} Shards`];
    if (row.supporter) parts.push(`Supporter ${row.supporter.outcome}${row.supporter.cancel ? `, ${row.supporter.cancel}` : ""}`);
    if (row.note) parts.push(row.note);
    return parts.join(" · ");
}

export function PaymentReversalsList({ rows, onPivot }: { rows: PaymentReversal[]; onPivot: (name: string) => void }) {
    const debts = rows.filter((row) => row.shortfall > 0);
    return (
        <section className="summary-box">
            <h3>💳 Payment reversals ({rows.length}{debts.length > 0 ? `, ${debts.length} with spent Shards` : ""})</h3>
            {rows.length === 0
                ? <p className="hint">No refunds or chargebacks.</p>
                : (
                    <div style={{ display: "grid", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                        {rows.map((row) => (
                            <div key={row.transactionId} style={{ padding: "0.3rem 0.5rem", background: row.shortfall > 0 ? "#2a0a0a" : "#111827", borderRadius: 4 }}>
                                {row.playerName
                                    ? <button onClick={() => onPivot(row.playerName)} style={{ background: "transparent", border: 0, color: "#fca5a5", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline dotted" }}>{row.playerName}</button>
                                    : <em>unknown player</em>}
                                {" — "}{describe(row)}
                                {row.shortfall > 0 && <strong style={{ color: "#f87171" }}>{` · ${row.shortfall} Shards already spent (owner decision)`}</strong>}
                                <div><small style={{ color: "#94a3b8", overflowWrap: "anywhere" }}>{row.transactionId} · {new Date(row.updatedAt).toLocaleString()}</small></div>
                            </div>
                        ))}
                    </div>
                )
            }
        </section>
    );
}
