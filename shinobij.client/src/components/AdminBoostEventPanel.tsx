import { useCallback, useEffect, useState } from "react";
import { setSharedBoostEvent } from "../lib/world-state";
import { serverNow } from "../lib/server-clock";
import {
    BOOST_MAX_HOURS,
    BOOST_MIN_HOURS,
    BOOST_MULTIPLIER_OPTIONS,
    BOOST_TARGETS,
    BOOST_TARGET_INFO,
    defaultBoostTitle,
    formatBoostMultiplier,
    formatBoostTimeLeft,
    isBoostEventActive,
    sanitizeBoostEvent,
    type BoostEvent,
    type BoostTarget,
} from "../../../shared/boost-event";
import "./AdminBoostEventPanel.css";

const API = "/api/admin/boost-event";
const DURATION_PRESETS = [1, 3, 6, 12, 24, 48, 72];

async function call(credential: string, init?: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const response = await fetch(API, {
        ...init,
        headers: { "Content-Type": "application/json", "x-admin-password": credential, ...(init?.headers ?? {}) },
    });
    let data: Record<string, unknown> = {};
    try { data = await response.json(); } catch { /* status is enough */ }
    return { ok: response.ok, data };
}

/**
 * World Events → Boost Event. Start a timed multiplier (training gains, battle
 * and mission growth, jutsu lesson speed) for a set number of hours, or end
 * the running one early. The server announces the start to every village.
 */
export function AdminBoostEventPanel({ credential }: { credential: string }) {
    const [event, setEvent] = useState<BoostEvent | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    // Server-synced clock: an event's startsAt is the SERVER's time, so a local
    // clock that runs behind would call a just-started event "not yet running".
    const [now, setNow] = useState(() => serverNow());
    const [multiplier, setMultiplier] = useState<number>(2);
    const [hours, setHours] = useState(6);
    const [targets, setTargets] = useState<BoostTarget[]>(["training"]);
    const [title, setTitle] = useState("");
    const [confirmStop, setConfirmStop] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const { ok, data } = await call(credential);
            if (!ok) { setError(String(data.error ?? "Could not load the boost event.")); return; }
            const current = sanitizeBoostEvent(data.event);
            const at = serverNow();
            setNow(at);
            setEvent(current);
            setSharedBoostEvent(isBoostEventActive(current, at) ? current : null);
            setError("");
        } catch {
            setError("Network error while loading the boost event.");
        } finally {
            setLoaded(true);
        }
    }, [credential]);

    // Load once on mount (refresh only changes with the credential).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => {
        const id = window.setInterval(() => setNow(serverNow()), 30_000);
        return () => window.clearInterval(id);
    }, []);

    const active = isBoostEventActive(event, now) ? event : null;

    const toggleTarget = (target: BoostTarget) => setTargets((current) => (
        current.includes(target) ? current.filter((t) => t !== target) : [...current, target]
    ));

    async function start() {
        setBusy(true);
        try {
            const { ok, data } = await call(credential, {
                method: "POST",
                body: JSON.stringify({ action: "start", multiplier, targets, hours, title: title.trim() || undefined }),
            });
            if (!ok) { setError(String(data.error ?? "Could not start the event.")); return; }
            const started = sanitizeBoostEvent(data.event);
            // Re-read the clock now: the event began after the last tick, so the
            // stale reading would call it "not started yet" for up to 30s.
            setNow(Math.max(serverNow(), started?.startsAt ?? 0));
            setEvent(started);
            setSharedBoostEvent(started);
            setError("");
        } catch {
            setError("Network error while starting the event.");
        } finally {
            setBusy(false);
        }
    }

    async function stop() {
        setBusy(true);
        try {
            const { ok, data } = await call(credential, { method: "POST", body: JSON.stringify({ action: "stop" }) });
            if (!ok) { setError(String(data.error ?? "Could not end the event.")); return; }
            setEvent(null);
            setSharedBoostEvent(null);
            setConfirmStop(false);
            setError("");
        } catch {
            setError("Network error while ending the event.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="boost-admin" aria-label="Boost event administration">
            <header>
                <span>WORLD EVENT OPERATIONS</span>
                <h3>Boost Event</h3>
                <p>Turn on a timed multiplier for every player. It ends by itself when the time runs out.</p>
            </header>
            {error && <p role="alert" className="boost-admin__error">{error} <button type="button" onClick={() => { void refresh(); }}>Retry</button></p>}
            {!loaded ? <p>Loading…</p> : active ? (
                <div className="boost-admin__live">
                    <strong>{active.title.startsWith(formatBoostMultiplier(active.multiplier)) ? active.title : `${formatBoostMultiplier(active.multiplier)} · ${active.title}`}</strong>
                    <p>{active.targets.map((t) => BOOST_TARGET_INFO[t].label).join(" · ")}</p>
                    <p>Ends {new Date(active.endsAt).toLocaleString()} ({formatBoostTimeLeft(active.endsAt, now)})</p>
                    {confirmStop ? (
                        <div className="boost-admin__confirm">
                            <p>End it now? Training sessions and lessons already started keep their boost.</p>
                            <button type="button" className="danger-button" disabled={busy} onClick={() => { void stop(); }}>End event now</button>
                            <button type="button" onClick={() => setConfirmStop(false)}>Keep it running</button>
                        </div>
                    ) : (
                        <button type="button" className="danger-button" disabled={busy} onClick={() => setConfirmStop(true)}>End event early</button>
                    )}
                </div>
            ) : (
                <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
                    <fieldset>
                        <legend>What gets boosted</legend>
                        {BOOST_TARGETS.map((target) => (
                            <label key={target} className="boost-admin__target">
                                <input type="checkbox" checked={targets.includes(target)} onChange={() => toggleTarget(target)} />
                                <span><strong>{BOOST_TARGET_INFO[target].label}</strong><small>{BOOST_TARGET_INFO[target].detail}</small></span>
                            </label>
                        ))}
                    </fieldset>
                    <div className="boost-admin__fields">
                        <label>Multiplier
                            <select value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))}>
                                {BOOST_MULTIPLIER_OPTIONS.map((m) => <option key={m} value={m}>{formatBoostMultiplier(m)}</option>)}
                            </select>
                        </label>
                        <label>How long
                            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                                {DURATION_PRESETS.filter((h) => h >= BOOST_MIN_HOURS && h <= BOOST_MAX_HOURS).map((h) => (
                                    <option key={h} value={h}>{h} hour{h === 1 ? "" : "s"}</option>
                                ))}
                            </select>
                        </label>
                        <label>Title (optional)
                            <input maxLength={60} value={title} placeholder={targets.length ? defaultBoostTitle(multiplier, targets) : "Pick a target"} onChange={(e) => setTitle(e.target.value)} />
                        </label>
                    </div>
                    <p>Starting it posts an announcement to every village chat.</p>
                    <button type="submit" disabled={busy || targets.length === 0}>{busy ? "Starting…" : `Start ${formatBoostMultiplier(multiplier)} for ${hours}h`}</button>
                </form>
            )}
        </section>
    );
}
