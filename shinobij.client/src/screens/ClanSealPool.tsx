import { useEffect, useState } from "react";
import type { Character } from "../App";

type LogEntry = {
    kind: "donate" | "distribute";
    by: string;
    to?: string;
    amount: number;
    at: number;
};

type PoolResponse = {
    clanName: string;
    balance: number;
    log: LogEntry[];
};

export function ClanSealPool({
    character,
    updateCharacter,
}: {
    character: Character;
    updateCharacter: (c: Character) => void;
}) {
    const [pool, setPool] = useState<PoolResponse | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [donateAmount, setDonateAmount] = useState(10);
    const [distributeAmount, setDistributeAmount] = useState(10);
    const [recipient, setRecipient] = useState("");

    const isVanguard = character.profession === "vanguard";
    const isLeader = !!character.clanFounder;
    const maxDonate = Math.floor((character.honorSeals ?? 0) * 0.5);

    async function fetchPool() {
        if (!character.clan) return;
        try {
            const res = await fetch(`/api/clan/seal-pool/get?clanName=${encodeURIComponent(character.clan)}`);
            if (res.ok) setPool(await res.json());
        } catch { /* ignore */ }
    }

    useEffect(() => {
        void fetchPool();
        const id = setInterval(fetchPool, 30_000);
        return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.clan]);

    async function donate() {
        if (busy || !isVanguard) return;
        setBusy(true); setMsg(null);
        try {
            const res = await fetch('/api/clan/seal-pool/donate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: character.name, amount: donateAmount }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(`❌ ${data.error ?? 'Failed'}`);
            } else {
                updateCharacter({ ...character, honorSeals: Number(data.honorSealsRemaining) });
                setMsg(`✅ Donated ${data.donated} Seals`);
                void fetchPool();
            }
        } catch { setMsg('❌ Network error'); }
        setBusy(false);
    }

    async function distribute() {
        if (busy || !isLeader || !recipient.trim()) return;
        setBusy(true); setMsg(null);
        try {
            const res = await fetch('/api/clan/seal-pool/distribute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leaderName: character.name,
                    recipientName: recipient.trim(),
                    amount: distributeAmount,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(`❌ ${data.error ?? 'Failed'}`);
            } else {
                setMsg(`✅ Gave ${data.distributed} Seals to ${data.recipient}`);
                setRecipient("");
                void fetchPool();
            }
        } catch { setMsg('❌ Network error'); }
        setBusy(false);
    }

    if (!character.clan) return null;

    return (
        <div className="summary-box" style={{ background: "linear-gradient(180deg, rgba(250,204,21,0.10), rgba(8,10,22,0.4))", border: "1px solid rgba(250,204,21,0.45)", marginTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <strong style={{ color: "#facc15" }}>🏅 Clan Honor Seal Pool</strong>
                <span style={{ color: "#facc15", fontWeight: 600 }}>
                    {pool?.balance.toLocaleString() ?? "—"} Seals
                </span>
            </div>
            <p className="hint" style={{ margin: "6px 0 8px", fontSize: "0.78rem" }}>
                Vanguards donate up to 50% of their balance per call. The clan founder distributes the pool to clan-mates,
                who can spend Seals on jutsu Seal training and timer speedups.
            </p>

            {isVanguard && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <span className="hint">Donate</span>
                    <input
                        type="number"
                        min={1}
                        max={maxDonate}
                        value={donateAmount}
                        onChange={(e) => setDonateAmount(Math.max(1, Number(e.target.value)))}
                        style={{ width: 80 }}
                    />
                    <button
                        onClick={() => void donate()}
                        disabled={busy || donateAmount > maxDonate || donateAmount < 1}
                        style={{ background: "linear-gradient(#854d0e,#422006)", borderColor: "#facc15" }}
                    >
                        {busy ? "…" : `Donate ${donateAmount} Seals`}
                    </button>
                    <span className="hint" style={{ fontSize: "0.75rem" }}>
                        Cap: {maxDonate} (50% of {character.honorSeals ?? 0})
                    </span>
                </div>
            )}
            {!isVanguard && (
                <p className="hint" style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#94a3b8" }}>
                    Only Vanguards can donate to the pool.
                </p>
            )}

            {isLeader && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <span className="hint">Distribute</span>
                    <input
                        type="number"
                        min={1}
                        value={distributeAmount}
                        onChange={(e) => setDistributeAmount(Math.max(1, Number(e.target.value)))}
                        style={{ width: 80 }}
                    />
                    <span className="hint">to</span>
                    <input
                        type="text"
                        placeholder="Clan-mate name"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        style={{ width: 160 }}
                    />
                    <button
                        onClick={() => void distribute()}
                        disabled={busy || !recipient.trim() || distributeAmount < 1 || (pool?.balance ?? 0) < distributeAmount}
                        style={{ background: "linear-gradient(#854d0e,#422006)", borderColor: "#facc15" }}
                    >
                        {busy ? "…" : "Give"}
                    </button>
                </div>
            )}

            {msg && <p className="hint" style={{ margin: "0 0 6px", color: msg.startsWith("✅") ? "#facc15" : "#f87171" }}>{msg}</p>}

            {pool && pool.log.length > 0 && (
                <details>
                    <summary className="hint" style={{ cursor: "pointer", fontSize: "0.78rem" }}>Recent activity ({pool.log.length})</summary>
                    <div style={{ marginTop: 6, fontSize: "0.75rem", maxHeight: 180, overflowY: "auto" }}>
                        {pool.log.map((e, i) => (
                            <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                                {e.kind === "donate"
                                    ? <>📥 {e.by} donated <strong>{e.amount}</strong> Seals</>
                                    : <>📤 {e.by} gave <strong>{e.amount}</strong> Seals to {e.to}</>}
                                <span className="hint" style={{ marginLeft: 6, fontSize: "0.72rem" }}>
                                    {new Date(e.at).toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
