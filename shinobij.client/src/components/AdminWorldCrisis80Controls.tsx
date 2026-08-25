import { useCallback, useEffect, useState } from "react";
import type { WorldCrisis80Projection } from "../../../shared/world-crisis-80";
import { gameConfirm } from "./GameAlert";

type Action = "arm" | "stand-down" | "awaken-now" | "resolve" | "set-target";

export function AdminWorldCrisis80Controls({ adminPw }: { adminPw: string }) {
    const [crisis, setCrisis] = useState<WorldCrisis80Projection | null>(null);
    const [target, setTarget] = useState("180");
    const [creditPlayer, setCreditPlayer] = useState("");
    const [reason, setReason] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const response = await fetch("/api/world-crisis-80", { cache: "no-store" });
            const payload = await response.json() as { crisis?: WorldCrisis80Projection; error?: string };
            if (!response.ok || !payload.crisis) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCrisis(payload.crisis);
            setTarget(String(payload.crisis.targetPerVillage));
        } catch (error) {
            setStatus(`✗ ${error instanceof Error ? error.message : "Could not load reckoning state."}`);
        }
    }, []);
    useEffect(() => {
        const start = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(start);
    }, [refresh]);

    async function act(action: Action) {
        if ((action === "stand-down" || action === "resolve") && !reason.trim()) {
            setStatus("✗ A reason is required for lifecycle overrides.");
            return;
        }
        if (action === "awaken-now" || action === "resolve" || action === "stand-down") {
            const confirmed = await gameConfirm(
                action === "awaken-now"
                    ? "Awaken The Hollow Gate Reckoning globally now? This calls every village to both defense fronts."
                    : action === "resolve"
                        ? "Resolve all four witness-ledger fronts immediately? This completes both operation paths and sends the world result."
                        : "Stand down the armed level-80 trigger before it awakens?",
                { title: "Level 80 Reckoning Override", confirmLabel: "Apply Override", danger: true },
            );
            if (!confirmed) return;
        }
        setBusy(true);
        setStatus("");
        try {
            const response = await fetch("/api/world-crisis-80", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({ action, targetPerVillage: Number(target), creditPlayer: creditPlayer.trim() || undefined, reason: reason.trim() }),
            });
            const payload = await response.json() as { crisis?: WorldCrisis80Projection; error?: string };
            if (!response.ok || !payload.crisis) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCrisis(payload.crisis);
            setStatus(`✓ ${action} applied at revision ${payload.crisis.revision}.`);
        } catch (error) {
            setStatus(`✗ ${error instanceof Error ? error.message : "Level-80 reckoning action failed."}`);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="card" style={{ padding: 12, borderColor: "rgba(167,139,250,.55)", background: "linear-gradient(120deg,rgba(46,16,101,.28),rgba(8,47,73,.72))" }}>
            <h4 style={{ margin: "0 0 5px", color: "#ddd6fe" }}>◆ The Hollow Gate Reckoning <button style={{ marginLeft: 8 }} onClick={() => void refresh()}>Refresh</button></h4>
            <p style={{ margin: "0 0 9px", color: "#9aa3b2", fontSize: ".72rem" }}>Global level-80 awakening. Shinobi 1v3 and companion 3v3 wins share one sealed village ledger. Operator actions are audited.</p>
            {crisis ? (
                <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: ".76rem" }}>
                        <span><b>Status:</b> {crisis.status}</span><span><b>Phase:</b> {crisis.phase}</span><span><b>Progress:</b> {crisis.totalDefenses}/{crisis.totalTarget}</span><span><b>Shinobi:</b> {crisis.totalShinobiDefenses}</span><span><b>Companions:</b> {crisis.totalCompanionDefenses}</span><span><b>First witness:</b> {crisis.awakenedBy ?? "waiting"}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <input type="number" min={20} max={750} value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Level-80 defense target per village" style={{ width: 110 }} />
                        <button disabled={busy || (crisis.status !== "armed" && crisis.status !== "dormant")} onClick={() => void act("set-target")}>Set Target / Village</button>
                        <input value={creditPlayer} onChange={(event) => setCreditPlayer(event.target.value)} placeholder="first witness credit (optional)" style={{ minWidth: 200 }} />
                        {crisis.status === "dormant" && <button disabled={busy} onClick={() => void act("arm")}>Arm Level 80 Trigger</button>}
                        {crisis.status === "armed" && <button disabled={busy} onClick={() => void act("awaken-now")}>Awaken Now</button>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="override reason (required for stand-down / resolve)" style={{ flex: 1, minWidth: 260 }} />
                        {crisis.status === "armed" && <button className="danger-button" disabled={busy} onClick={() => void act("stand-down")}>Stand Down</button>}
                        {crisis.status === "active" && <button className="danger-button" disabled={busy} onClick={() => void act("resolve")}>Resolve All Fronts</button>}
                    </div>
                </div>
            ) : <p style={{ margin: 0, fontSize: ".76rem" }}>Loading reckoning state…</p>}
            {status && <p role="status" style={{ margin: "8px 0 0", color: status.startsWith("✗") ? "#f87171" : "#86efac", fontSize: ".74rem" }}>{status}</p>}
        </section>
    );
}
