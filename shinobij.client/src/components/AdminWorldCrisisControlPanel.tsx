import { useCallback, useEffect, useState } from "react";
import { gameConfirm } from "./GameAlert";

type Action = "arm" | "stand-down" | "awaken-now" | "resolve" | "set-target";
type CrisisProjection = {
    status: "dormant" | "armed" | "active" | "resolved";
    phase: string;
    revision: number;
    targetPerVillage: number;
    totalDefenses: number;
    totalTarget: number;
    awakenedBy: string | null;
    totalShinobiDefenses?: number;
    totalCompanionDefenses?: number;
};

export type AdminWorldCrisisConfig = {
    endpoint: string;
    defaultTarget: number;
    targetRange: [number, number];
    title: string;
    description: string;
    loadingLabel: string;
    loadError: string;
    actionError: string;
    armLabel: string;
    creditPlaceholder: string;
    awakenedLabel: string;
    panelColors: [string, string, string];
    confirm: Record<"awaken-now" | "resolve" | "stand-down", string>;
    showOperationSplit?: boolean;
};

export function AdminWorldCrisisControlPanel({ adminPw, config }: { adminPw: string; config: AdminWorldCrisisConfig }) {
    const [crisis, setCrisis] = useState<CrisisProjection | null>(null);
    const [target, setTarget] = useState(String(config.defaultTarget));
    const [creditPlayer, setCreditPlayer] = useState("");
    const [reason, setReason] = useState("");
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const response = await fetch(config.endpoint, { cache: "no-store" });
            const payload = await response.json() as { crisis?: CrisisProjection; error?: string };
            if (!response.ok || !payload.crisis) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCrisis(payload.crisis);
            setTarget(String(payload.crisis.targetPerVillage));
        } catch (error) {
            setStatus(`✗ ${error instanceof Error ? error.message : config.loadError}`);
        }
    }, [config]);
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
            const confirmed = await gameConfirm(config.confirm[action], { title: `${config.title} Override`, confirmLabel: "Apply Override", danger: true });
            if (!confirmed) return;
        }
        setBusy(true);
        setStatus("");
        try {
            const response = await fetch(config.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({ action, targetPerVillage: Number(target), creditPlayer: creditPlayer.trim() || undefined, reason: reason.trim() }),
            });
            const payload = await response.json() as { crisis?: CrisisProjection; error?: string };
            if (!response.ok || !payload.crisis) throw new Error(payload.error ?? `HTTP ${response.status}`);
            setCrisis(payload.crisis);
            setStatus(`✓ ${action} applied at revision ${payload.crisis.revision}.`);
        } catch (error) {
            setStatus(`✗ ${error instanceof Error ? error.message : config.actionError}`);
        } finally {
            setBusy(false);
        }
    }

    const [borderColor, background, headingColor] = config.panelColors;
    return (
        <section className="card" style={{ padding: 12, borderColor, background }}>
            <h4 style={{ margin: "0 0 5px", color: headingColor }}>{config.title} <button style={{ marginLeft: 8 }} onClick={() => void refresh()}>Refresh</button></h4>
            <p style={{ margin: "0 0 9px", color: "#9aa3b2", fontSize: ".72rem" }}>{config.description}</p>
            {crisis ? <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: ".76rem" }}>
                    <span><b>Status:</b> {crisis.status}</span><span><b>Phase:</b> {crisis.phase}</span><span><b>Progress:</b> {crisis.totalDefenses}/{crisis.totalTarget}</span>
                    {config.showOperationSplit && <><span><b>Shinobi:</b> {crisis.totalShinobiDefenses}</span><span><b>Companions:</b> {crisis.totalCompanionDefenses}</span></>}
                    <span><b>{config.awakenedLabel}:</b> {crisis.awakenedBy ?? "waiting"}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <input type="number" min={config.targetRange[0]} max={config.targetRange[1]} value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Defense target per village" style={{ width: 110 }} />
                    <button disabled={busy || (crisis.status !== "armed" && crisis.status !== "dormant")} onClick={() => void act("set-target")}>Set Target / Village</button>
                    <input value={creditPlayer} onChange={(event) => setCreditPlayer(event.target.value)} placeholder={config.creditPlaceholder} style={{ minWidth: 200 }} />
                    {crisis.status === "dormant" && <button disabled={busy} onClick={() => void act("arm")}>{config.armLabel}</button>}
                    {crisis.status === "armed" && <button disabled={busy} onClick={() => void act("awaken-now")}>Awaken Now</button>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="override reason (required for stand-down / resolve)" style={{ flex: 1, minWidth: 260 }} />
                    {crisis.status === "armed" && <button className="danger-button" disabled={busy} onClick={() => void act("stand-down")}>Stand Down</button>}
                    {crisis.status === "active" && <button className="danger-button" disabled={busy} onClick={() => void act("resolve")}>Resolve All Fronts</button>}
                </div>
            </div> : <p style={{ margin: 0, fontSize: ".76rem" }}>{config.loadingLabel}</p>}
            {status && <p role="status" style={{ margin: "8px 0 0", color: status.startsWith("✗") ? "#f87171" : "#86efac", fontSize: ".74rem" }}>{status}</p>}
        </section>
    );
}
