import { useEffect, useRef, useState } from "react";
import { gameConfirm } from "../../components/GameAlert";
import type { CoastLand } from "../world-map/coast-service";

const labels = {
    "force-settle": "Settle contest now", "cancel-contest": "Cancel contest",
    "release-claim": "Release claim", "grant-claim": "Grant claim", "set-immunity": "Set protection",
    "restore-landing": "Restore fallen Landing", pause: "Pause contests", resume: "Resume contests",
};
type Action = keyof typeof labels;
type Overview = { paused: { at: number; reason: string } | null; sectors: CoastLand[];
    landings: { clan: string; sector: number; status: string; tierName: string; works: string[]; stores: Record<string, number>;
        dormantWeeks: number; destroyedAt?: number; destroyedReason?: string }[] };
const stockName = (id: string) => id.replace(/^(gather|quest)-/, "").replaceAll("-", " ");
const when = (at: number) => new Date(at).toLocaleString();
async function coastAdmin<T>(password: string, action: string, fields: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const response = await fetch("/api/coast/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ action, ...fields }), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || "The coast request failed.");
    return result;
}

export default function AdminCoastPanel({ adminPw }: { adminPw: string }) {
    const [view, setView] = useState<Overview | null>(null);
    const [action, selectAction] = useState<Action>("grant-claim"), [sector, selectSector] = useState(0);
    const [clan, setClan] = useState(""), [hours, setHours] = useState("24"), [reason, setReason] = useState("");
    const [revision, refresh] = useState(0), [readAt, setReadAt] = useState(-1), [busy, setBusy] = useState(false);
    const [error, setError] = useState(""), [notice, setNotice] = useState("");
    const pending = readAt !== revision;
    const lock = useRef(false), lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => controller.abort();
    }, [adminPw]);
    useEffect(() => {
        const controller = new AbortController();
        coastAdmin<Overview>(adminPw, "overview", {}, controller.signal)
            .then(data => { if (!controller.signal.aborted) { setView(data); setError(""); } })
            .catch(e => { if (!controller.signal.aborted) { setView(null); setError(e.message); } })
            .finally(() => { if (!controller.signal.aborted) setReadAt(revision); });
        return () => controller.abort();
    }, [adminPw, revision]);
    const land = view?.sectors.find(row => row.sector === sector) ?? view?.sectors[0];
    const bySector = !["pause", "resume", "restore-landing"].includes(action);
    const byClan = action === "grant-claim" || action === "restore-landing";
    const valid = !!view && (!bySector || !!land) && (!byClan || !!clan.trim()) && (action !== "pause" || !!reason.trim())
        && (action !== "set-immunity" || (hours.trim() !== "" && Number.isFinite(Number(hours)) && Number(hours) >= 0 && Number(hours) <= 8760));
    async function submit() {
        const signal = lifetime.current?.signal;
        if (lock.current || pending || !valid || !signal) return;
        lock.current = true; setBusy(true);
        const fields = { ...(bySector ? { sector: land!.sector } : {}), ...(byClan ? { clan: clan.trim() } : {}),
            ...(action === "pause" ? { reason: reason.trim() } : {}), ...(action === "set-immunity" ? { hours: Number(hours) } : {}) };
        const details = [bySector && land?.name, byClan && clan.trim(), action === "set-immunity" && hours + " hours", action === "pause" && reason.trim()].filter(Boolean);
        const summary = labels[action] + (details.length ? " — " + details.join(" · ") : "");
        try {
            if (!await gameConfirm(summary + "?", { title: "Change coast records", confirmLabel: labels[action], danger: true, signal })) return;
            setError(""); setNotice("");
            await coastAdmin(adminPw, action, fields, signal);
            if (!signal.aborted) { setNotice(summary + " completed."); refresh(value => value + 1); }
        } catch (e) {
            if (!signal.aborted) setError(e instanceof Error ? e.message : "The coast request failed.");
        } finally {
            lock.current = false;
            if (!signal.aborted) setBusy(false);
        }
    }
    return <section className="summary-box" aria-label="Coast administration">
        <h2>Unmapped Coast</h2>
        <button type="button" disabled={pending || busy} onClick={() => refresh(value => value + 1)}>Refresh overview</button>
        {pending && <p role="status">Reading coast records…</p>}
        {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        {view && <>
            <p>{view.paused ? "Contests paused · " + view.paused.reason + " · " + when(view.paused.at) : "Land contests are running."}</p>
            <h3>Contest grounds</h3>
            {view.sectors.map(row => <details key={row.sector}><summary>{row.name} · {row.holder?.clan ?? "Unmoored"}{row.contest ? " · " + row.contest.phase : ""}</summary>
                {row.holder && <p>Held since {when(row.holder.since)} · protected until {when(row.holder.immuneUntil)}.</p>}
                {row.contest && <><p>{row.contest.clan} · {row.contest.score}/{row.contest.target} points · {row.contest.roster} on roster.</p>
                    <p>Opens {when(row.contest.opensAt)} · closes {when(row.contest.closesAt)}.</p>
                    {row.contest.defender && <p>{row.contest.defender.clan} defending · {row.contest.defender.score} points · {row.contest.defender.roster} on roster.</p>}</>}
            </details>)}
            <h3>Landings</h3>{!view.landings.length && <p>No clan has staked a Landing.</p>}
            {view.landings.map(row => <details key={row.clan}><summary>{row.clan} · sector {row.sector} · {row.tierName} · {row.status}</summary>
                <p>Dormant weeks · {row.dormantWeeks}</p><p>Works · {row.works.map(stockName).join(", ") || "None"}</p>
                <p>Stores · {Object.entries(row.stores).map(([id, n]) => n + " " + stockName(id)).join(", ") || "Empty"}</p>
                {row.destroyedAt && <p>Fell {when(row.destroyedAt)} · {row.destroyedReason}</p>}
            </details>)}
            <h3>Coast actions</h3>
            <form className="menu" onSubmit={event => { event.preventDefault(); void submit(); }}>
                <label>Action <select value={action} disabled={busy} onChange={e => selectAction(e.target.value as Action)}>
                    {(Object.keys(labels) as Action[]).map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
                {bySector && <label>Sector <select value={land?.sector ?? ""} disabled={busy} onChange={e => selectSector(Number(e.target.value))}>
                    {view.sectors.map(row => <option key={row.sector} value={row.sector}>{row.sector} · {row.name}</option>)}</select></label>}
                {byClan && <label>Clan name <input required maxLength={80} disabled={busy} value={clan} onChange={e => setClan(e.target.value)} /></label>}
                {action === "set-immunity" && <label>Protection in hours <input required type="number" min="0" max="8760" step="any" disabled={busy} value={hours} onChange={e => setHours(e.target.value)} /></label>}
                {action === "pause" && <label>Reason <input required maxLength={200} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} /></label>}
                <button type="submit" disabled={!valid || busy || pending}>Review change</button>
            </form>
        </>}
    </section>;
}
