/*
 * Admin Legacy dashboard (docs/legacy-system-plan.md §16) — the operator's
 * console for the Legacy system: player inspection + eligibility, Sage
 * controls, the audited emergency correction, runtime tuning overlay, the
 * Era dashboard, custom-title review/revoke, Hall corrections, and the
 * suspects queue. Full-admin only (the endpoint enforces it; the tab is
 * hidden from content admins like Moderation).
 */
import { useCallback, useEffect, useState } from "react";
import { gameConfirm } from "../components/GameAlert";
import { RARITY_COLORS, fetchLegacyDefinitions, type LegacyDefView, type LegacyRarity } from "../lib/legacy";

type AdminView = {
    player: string;
    stats: Record<string, unknown>;
    legacy: { legacyId: string; stage: number; titles: string[] } | null;
    sealed: { legacyId: string } | null;
    offer: { status: string; offers: Array<{ legacyId: string; rarity: string }>; sector: number } | null;
    trial: { legacyId: string; kind: string; objectives: Array<{ stat: string; delta: number }> } | null;
    events: Array<{ ts: number; type: string; key?: string }>;
    eligible: Array<{ legacyId: string; name: string; rarity: LegacyRarity; score: number }>;
    nearMisses: Array<{ legacyId: string; name: string; rarity: LegacyRarity; score: number; missing: string[] }>;
};

type EraView = {
    id: string; number: number; name: string; status: string;
    milestones: Array<{ metric: string; label: string; required: number; current: number; done: boolean }>;
    trigger: { label: string; fired: boolean; firedBy?: string } | null;
    unlockedBy: string | null; unlockedAt: number | null;
};

export function AdminLegacyPanel({ adminPw }: { adminPw: string }) {
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);

    const post = useCallback(async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
        try {
            const res = await fetch('/api/admin/legacy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setStatus(`✗ ${String((data as { error?: string })?.error ?? `HTTP ${res.status}`)}`);
                return null;
            }
            return data as Record<string, unknown>;
        } catch (e) {
            setStatus(`✗ ${e instanceof Error ? e.message : 'network error'}`);
            return null;
        }
    }, [adminPw]);

    // ── Player inspector ─────────────────────────────────────────────────
    const [inspectName, setInspectName] = useState("");
    const [view, setView] = useState<AdminView | null>(null);
    const [defs, setDefs] = useState<LegacyDefView[]>([]);
    const [changeLegacyId, setChangeLegacyId] = useState("");
    const [changeReason, setChangeReason] = useState("");
    useEffect(() => {
        void fetchLegacyDefinitions().then((d) => { if (d) setDefs(d.legacies); });
    }, []);

    async function inspect() {
        if (!inspectName.trim()) return;
        setBusy(true);
        const data = await post({ action: 'view', player: inspectName.trim() });
        setBusy(false);
        if (data) { setView(data as unknown as AdminView); setStatus(`Inspected ${inspectName.trim()}.`); }
    }

    async function forceSpawnSage() {
        if (!view) return;
        setBusy(true);
        // force=true is honored only with admin auth (api/legacy/sage.ts); it
        // bypasses odds/pity/daily caps but NOT eligibility — the Sage still
        // refuses players with nothing to offer.
        const forced = await fetch('/api/legacy/sage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
            body: JSON.stringify({ action: 'roll', playerName: view.player, force: true }),
        }).then((x) => x.json()).catch(() => null);
        setBusy(false);
        setStatus(forced?.spawn ? `✓ Sage forced for ${view.player} (sector ${forced.offer?.sector}).` : `✗ Sage did not spawn: ${forced?.reason ?? 'unknown'}`);
        void inspect();
    }

    async function emergencyChange(clear: boolean) {
        if (!view) return;
        if (!changeReason.trim()) { setStatus('✗ Emergency corrections require a reason.'); return; }
        const label = clear ? 'CLEAR this player’s legacy entirely' : `set this player’s legacy to "${changeLegacyId}"`;
        const sure = await gameConfirm(
            `Emergency correction: ${label}. This bypasses the one-legacy-forever rule and is for BUG RECOVERY only. It will be audited.`,
            { title: 'Emergency Legacy Correction', confirmLabel: 'Apply Correction', danger: true },
        );
        if (!sure) return;
        setBusy(true);
        const data = await post({ action: 'emergency-change', player: view.player, legacyId: clear ? null : changeLegacyId, reason: changeReason.trim() });
        setBusy(false);
        if (data) { setStatus(`✓ Legacy correction applied to ${view.player}.`); void inspect(); }
    }

    // ── Suspects queue ───────────────────────────────────────────────────
    const [suspects, setSuspects] = useState<Array<{ player: string; ts: number; flags: number }>>([]);
    const [suspectReason, setSuspectReason] = useState("");
    async function loadSuspects() {
        const data = await post({ action: 'suspects' });
        if (data) { setSuspects((data.suspects as typeof suspects) ?? []); setStatus('Suspects refreshed.'); }
    }
    async function clearSuspicion(player: string) {
        if (!suspectReason.trim()) { setStatus('✗ Clearing suspicion requires a reason.'); return; }
        const sure = await gameConfirm(`Clear ${player}'s suspicion flags? Use for honest false positives (shared network / small-server trios) — this does NOT wipe their progression.`, { title: 'Clear Suspicion', confirmLabel: 'Clear Flags' });
        if (!sure) return;
        const data = await post({ action: 'clear-suspicion', player, reason: suspectReason.trim() });
        if (data) { setStatus(`✓ Suspicion cleared for ${player}.`); void loadSuspects(); }
    }

    // ── Custom-title review ──────────────────────────────────────────────
    const [titleLog, setTitleLog] = useState<Array<{ ts: number; player: string; title: string }>>([]);
    const [revokeReason, setRevokeReason] = useState("");
    async function loadTitleLog() {
        const data = await post({ action: 'titles-log' });
        if (data) { setTitleLog((data.log as typeof titleLog) ?? []); setStatus('Title log refreshed.'); }
    }
    async function revokeTitle(player: string) {
        if (!revokeReason.trim()) { setStatus('✗ Title revocations require a reason.'); return; }
        const sure = await gameConfirm(`Revoke ${player}'s custom title and refund their 10 Fate Shards?`, { title: 'Revoke Custom Title', confirmLabel: 'Revoke + Refund', danger: true });
        if (!sure) return;
        const data = await post({ action: 'title-revoke', player, reason: revokeReason.trim() });
        if (data) { setStatus(`✓ Title revoked for ${player}.`); void loadTitleLog(); }
    }

    // ── Era dashboard ────────────────────────────────────────────────────
    const [eras, setEras] = useState<EraView[]>([]);
    const [eraReason, setEraReason] = useState("");
    async function loadEras() {
        const data = await post({ action: 'era-view' });
        if (data) { setEras((data.eras as EraView[]) ?? []); setStatus('Eras refreshed.'); }
    }
    async function setEraStatus(eraId: string, statusValue: string) {
        const sure = await gameConfirm(`Set ${eraId} status to "${statusValue}"? Cycling an unlocked era back to milestone_active can retrigger its unlock — use with care.`, { title: 'Change Era Status', confirmLabel: 'Set Status', danger: statusValue !== 'unlocked' });
        if (!sure) { void loadEras(); return; } // revert the select to server truth
        const data = await post({ action: 'era-set-status', eraId, status: statusValue });
        if (data) { setStatus(`✓ ${eraId} → ${statusValue}`); }
        void loadEras();
    }
    async function setEraMilestone(eraId: string, metric: string, required: number) {
        // Guard against an emptied / NaN / negative box silently waiving the
        // milestone (verification finding). Only 0 explicitly waives.
        if (!Number.isFinite(required) || required < 0) { setStatus('✗ Milestone must be 0 (waive) or a positive number.'); void loadEras(); return; }
        const data = await post({ action: 'era-set-milestone', eraId, metric, required });
        if (data) { setStatus(`✓ ${eraId}.${metric} → ${required.toLocaleString()}`); void loadEras(); }
    }
    async function forceUnlockEra(eraId: string) {
        if (!eraReason.trim()) { setStatus('✗ Era force-unlocks require a reason.'); return; }
        const credit = inspectName.trim();
        const sure = await gameConfirm(
            `Force-unlock ${eraId}? This announces server-wide and writes PERMANENT Hall history` +
            (credit ? `, credited to "${credit}" (the Player Inspector name).` : ', with NO credited player.') +
            ' Launch eras (I–IV) are already unlocked and will no-op.',
            { title: 'Force Era Unlock', confirmLabel: credit ? `Unlock, credit ${credit}` : 'Unlock (no credit)', danger: true },
        );
        if (!sure) return;
        const data = await post({ action: 'era-force-unlock', eraId, reason: eraReason.trim(), player: credit || undefined });
        if (data) { setStatus(`✓ ${eraId} unlock ${data.applied ? 'APPLIED' : 'was already done / launch era'}.`); void loadEras(); }
    }

    // ── Tuning overlay ───────────────────────────────────────────────────
    const [overlayText, setOverlayText] = useState("");
    async function loadOverlay() {
        const data = await post({ action: 'get-overlay' });
        if (data) { setOverlayText(JSON.stringify(data.overlay ?? {}, null, 2)); setStatus('Overlay loaded.'); }
    }
    async function saveOverlay() {
        let parsed: unknown;
        try { parsed = JSON.parse(overlayText || '{}'); } catch { setStatus('✗ Overlay is not valid JSON.'); return; }
        const sure = await gameConfirm('Write the tuning overlay? Eligibility thresholds and Sage odds change immediately for everyone.', { title: 'Save Tuning Overlay', confirmLabel: 'Write Overlay', danger: true });
        if (!sure) return;
        const data = await post({ action: 'set-overlay', overlay: parsed });
        if (data) setStatus('✓ Overlay saved.');
    }

    // ── Hall corrections ─────────────────────────────────────────────────
    const [hallEntries, setHallEntries] = useState<Array<{ id: number; title: string; status: string; player?: string; ts: number }>>([]);
    const [hallReason, setHallReason] = useState("");
    async function loadHall() {
        try {
            const res = await fetch('/api/hall-of-legends', { headers: { 'x-admin-password': adminPw } });
            const data = await res.json();
            setHallEntries((data.entries as typeof hallEntries) ?? []);
            setStatus('Hall entries refreshed (hidden included).');
        } catch { setStatus('✗ Could not load hall entries.'); }
    }
    async function correctHall(entryId: number, statusValue: string) {
        if (!hallReason.trim()) { setStatus('✗ Hall corrections require a reason.'); return; }
        const data = await post({ action: 'hall-correct', entryId, status: statusValue, correctionNote: hallReason.trim(), reason: hallReason.trim() });
        if (data) { setStatus(`✓ Hall entry #${entryId} → ${statusValue}.`); void loadHall(); }
    }

    const nonZeroStats = view ? Object.entries(view.stats).filter(([k, v]) => typeof v === 'number' && v > 0 && k !== 'updatedAt' && k !== 'bootstrappedAt' && k !== 'ringFlagAt') : [];

    return (
        <div className="card" style={{ display: 'grid', gap: 14 }}>
            <h3 style={{ margin: 0 }}>🌠 Legacy Operations</h3>
            {status && <p style={{ margin: 0, fontSize: '.78rem', color: status.startsWith('✗') ? '#f87171' : '#86efac' }}>{status}</p>}

            {/* Player inspector */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Player Inspector</h4>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input placeholder="player name" value={inspectName} onChange={(e) => setInspectName(e.target.value)} />
                    <button disabled={busy} onClick={() => void inspect()}>Inspect</button>
                    {view && <button disabled={busy} onClick={() => void forceSpawnSage()}>Force-Spawn Sage</button>}
                </div>
                {view && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 8, fontSize: '.78rem' }}>
                        <p style={{ margin: 0 }}>
                            <b>Sealed legacy:</b> {view.sealed?.legacyId ?? '— none —'}
                            {view.legacy && <> · stage {view.legacy.stage} · titles: {view.legacy.titles.join(', ') || '—'}</>}
                            {view.offer && <> · <b>offer:</b> {view.offer.status} ({view.offer.offers.map((o) => o.legacyId).join(', ')})</>}
                            {view.trial && <> · <b>trial:</b> {view.trial.kind} for {view.trial.legacyId}</>}
                        </p>
                        <details>
                            <summary>Server counters ({nonZeroStats.length})</summary>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 3, marginTop: 6 }}>
                                {nonZeroStats.map(([k, v]) => <span key={k}>{k}: <b>{Number(v).toLocaleString()}</b></span>)}
                            </div>
                        </details>
                        <details>
                            <summary>Eligible ({view.eligible.length}) + near misses ({view.nearMisses.length})</summary>
                            {view.eligible.map((e) => (
                                <p key={e.legacyId} style={{ margin: '2px 0', color: RARITY_COLORS[e.rarity] }}>✓ {e.name} (score {e.score})</p>
                            ))}
                            {view.nearMisses.map((e) => (
                                <p key={e.legacyId} style={{ margin: '2px 0', color: '#9aa3b2' }}>✗ {e.name} — missing: {e.missing.slice(0, 2).join('; ')}</p>
                            ))}
                        </details>
                        <details>
                            <summary>Recent events ({view.events.length})</summary>
                            {view.events.slice(0, 20).map((ev, i) => (
                                <p key={i} style={{ margin: '2px 0' }}>{new Date(ev.ts).toLocaleString()} — {ev.type}{ev.key ? ` (${ev.key})` : ''}</p>
                            ))}
                        </details>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <select value={changeLegacyId} onChange={(e) => setChangeLegacyId(e.target.value)}>
                                <option value="">— emergency legacy —</option>
                                {defs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.rarity})</option>)}
                            </select>
                            <input placeholder="reason (required, audited)" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} style={{ minWidth: 220 }} />
                            <button className="danger-button" disabled={busy || !changeLegacyId} onClick={() => void emergencyChange(false)}>Emergency Set</button>
                            <button className="danger-button" disabled={busy} onClick={() => void emergencyChange(true)}>Emergency Clear</button>
                        </div>
                    </div>
                )}
            </section>

            {/* Suspects */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Suspicion Queue <button style={{ marginLeft: 8 }} onClick={() => void loadSuspects()}>Refresh</button></h4>
                <input placeholder="clear-suspicion reason (required, audited)" value={suspectReason} onChange={(e) => setSuspectReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                {suspects.length === 0 ? <p style={{ margin: 0, fontSize: '.78rem', color: '#9aa3b2' }}>No flagged players.</p>
                    : suspects.map((s) => (
                        <p key={s.player} style={{ margin: '2px 0', fontSize: '.78rem' }}>
                            ⚠ <b>{s.player}</b> — {s.flags} flag{s.flags === 1 ? '' : 's'} · {new Date(s.ts).toLocaleString()}
                            <button style={{ marginLeft: 8 }} onClick={() => { setInspectName(s.player); void inspect(); }}>Inspect</button>
                            <button style={{ marginLeft: 4 }} onClick={() => void clearSuspicion(s.player)}>Clear Flags</button>
                        </p>
                    ))}
            </section>

            {/* Custom titles */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Custom Titles <button style={{ marginLeft: 8 }} onClick={() => void loadTitleLog()}>Refresh</button></h4>
                <input placeholder="revocation reason (required, audited)" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                {titleLog.length === 0 ? <p style={{ margin: 0, fontSize: '.78rem', color: '#9aa3b2' }}>No recent custom titles.</p>
                    : titleLog.slice(0, 30).map((t, i) => (
                        <p key={i} style={{ margin: '2px 0', fontSize: '.78rem' }}>
                            <b>{t.player}</b>: “{t.title}” · {new Date(t.ts).toLocaleDateString()}
                            <button className="danger-button" style={{ marginLeft: 8 }} onClick={() => void revokeTitle(t.player)}>Revoke + Refund</button>
                        </p>
                    ))}
            </section>

            {/* Eras */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>World Eras <button style={{ marginLeft: 8 }} onClick={() => void loadEras()}>Refresh</button></h4>
                <input placeholder="era action reason (required for force-unlock)" value={eraReason} onChange={(e) => setEraReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                {eras.map((e) => (
                    <div key={e.id} style={{ borderTop: '1px solid rgba(148,163,184,.15)', padding: '8px 0', fontSize: '.78rem' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <b>{e.name}</b>
                            <select value={e.status} onChange={(ev) => void setEraStatus(e.id, ev.target.value)}>
                                {['locked', 'admin_available', 'milestone_active', 'unlocked'].map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            {e.status !== 'unlocked' && <button className="danger-button" onClick={() => void forceUnlockEra(e.id)}>Force Unlock</button>}
                            {e.unlockedBy && <span style={{ color: '#c084fc' }}>unlocked by {e.unlockedBy}</span>}
                        </div>
                        {e.trigger && <p style={{ margin: '4px 0 0', color: e.trigger.fired ? '#86efac' : '#9aa3b2' }}>Trigger: {e.trigger.label} — {e.trigger.fired ? `FIRED by ${e.trigger.firedBy}` : 'waiting'}</p>}
                        {e.milestones.map((m) => (
                            <p key={m.metric} style={{ margin: '2px 0', color: m.done ? '#86efac' : '#cbd5e1' }}>
                                {m.label}: {m.current.toLocaleString()} / {' '}
                                <input
                                    key={`${e.id}:${m.metric}:${m.required}`}
                                    type="number" defaultValue={m.required} min={0}
                                    style={{ width: 90 }}
                                    onBlur={(ev) => {
                                        const raw = ev.target.value.trim();
                                        if (raw === '') { ev.target.value = String(m.required); return; } // empty ≠ waive
                                        const v = Math.floor(Number(raw));
                                        if (Number.isFinite(v) && v >= 0 && v !== m.required) void setEraMilestone(e.id, m.metric, v);
                                    }}
                                />
                            </p>
                        ))}
                    </div>
                ))}
            </section>

            {/* Overlay */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>
                    Tuning Overlay (shared:legacy-defs)
                    <button style={{ marginLeft: 8 }} onClick={() => void loadOverlay()}>Load</button>
                    <button style={{ marginLeft: 4 }} onClick={() => void saveOverlay()}>Save</button>
                </h4>
                <p style={{ margin: '0 0 6px', fontSize: '.72rem', color: '#9aa3b2' }}>
                    thresholds[legacyId][stat] retunes a requirement floor (0 waives it); disabled[] hides legacies; sage{'{}'} tunes spawn odds/pity/caps.
                </p>
                <textarea rows={8} value={overlayText} onChange={(e) => setOverlayText(e.target.value)} style={{ width: '100%', fontFamily: 'monospace', fontSize: '.72rem' }} />
            </section>

            {/* Hall corrections */}
            <section className="card" style={{ padding: 12 }}>
                <h4 style={{ margin: '0 0 8px' }}>Hall of Legends Corrections <button style={{ marginLeft: 8 }} onClick={() => void loadHall()}>Refresh</button></h4>
                <input placeholder="correction note / reason (required, shown publicly on revoked entries)" value={hallReason} onChange={(e) => setHallReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
                {hallEntries.length === 0 ? <p style={{ margin: 0, fontSize: '.78rem', color: '#9aa3b2' }}>No hall entries yet.</p>
                    : hallEntries.slice(0, 30).map((h) => (
                        <p key={h.id} style={{ margin: '2px 0', fontSize: '.78rem' }}>
                            #{h.id} <b>{h.title}</b>{h.player ? ` — ${h.player}` : ''} · {h.status} · {new Date(h.ts).toLocaleDateString()}
                            {['revoked', 'hidden', 'active'].filter((s) => s !== h.status).map((s) => (
                                <button key={s} style={{ marginLeft: 6 }} className={s === 'active' ? '' : 'danger-button'} onClick={() => void correctHall(h.id, s)}>{s}</button>
                            ))}
                        </p>
                    ))}
            </section>
        </div>
    );
}
