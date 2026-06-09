/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
import { useState, useCallback, useEffect } from "react";
import { villages } from "../data/sectors";

// ─── Admin Moderation Panel ───────────────────────────────────────────────────
// Player search → IP history + linked accounts. Ban / silence (1d / 3d / 7d /
// permanent for ban). Audit log of recent mod actions. Force-kick + delete a
// specific village-chat message.
type ModBanRecord = { until: number; reason: string; by: string; at: number; permanent?: boolean };
type ModSilenceRecord = { until: number; reason: string; by: string; at: number };
type ModIpRecord = { lastIp: string; ips: string[]; lastSeenAt: number };
type ModFpRecord = { lastFp: string; fps: string[]; lastSeenAt: number };
type ModAuditEntry = { ts: number; actor: string; action: string; target: string; detail?: string };
type ModLookupResult = {
    target: string;
    ipRecord: ModIpRecord | null;
    fpRecord: ModFpRecord | null;
    linkedByIp: string[];
    linkedByFp: string[];
    linkedByBoth: string[];
    perIp: Array<{ ip: string; names: string[] }>;
    perFp: Array<{ fp: string; names: string[] }>;
};
type ModSnapshot = {
    target: string;
    exists: boolean;
    snapshot?: {
        level: number; village: string; clan: string; specialty: string; rank: string;
        ryo: number; xp: number; totalPvpKills: number; totalAiKills: number;
        hospitalized: boolean; createdAt: unknown; lastSeenAt: number; currentSector: number; online: boolean;
    };
    ban?: ModBanRecord | null;
    silence?: ModSilenceRecord | null;
};
type ModChatMessage = { author: string; text: string; ts: number; rank?: string; level?: number };

export function ModerationPanel({ adminPw }: { adminPw: string }) {
    const [bans, setBans] = useState<Array<{ name: string; record: ModBanRecord }>>([]);
    const [silences, setSilences] = useState<Array<{ name: string; record: ModSilenceRecord }>>([]);
    const [audit, setAudit] = useState<ModAuditEntry[]>([]);
    const [searchName, setSearchName] = useState("");
    const [searchSignal, setSearchSignal] = useState("");
    const [signalKind, setSignalKind] = useState<"ip" | "fp">("ip");
    const [signalResult, setSignalResult] = useState<{ kind: "ip" | "fp"; value: string; names: string[] } | null>(null);
    const [lookup, setLookup] = useState<ModLookupResult | null>(null);
    const [snapshot, setSnapshot] = useState<ModSnapshot | null>(null);
    const [reason, setReason] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    // Village chat viewer
    const [chatVillage, setChatVillage] = useState("");
    const [chatMessages, setChatMessages] = useState<ModChatMessage[]>([]);

    const refresh = useCallback(async () => {
        if (!adminPw) return;
        try {
            const r = await fetch("/api/admin/moderation", {
                method: "GET",
                headers: { "x-admin-password": adminPw },
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            setBans(Array.isArray(data.bans) ? data.bans : []);
            setSilences(Array.isArray(data.silences) ? data.silences : []);
            setAudit(Array.isArray(data.audit) ? data.audit : []);
        } catch (e) {
            setStatus(`❌ ${(e as Error).message}`);
        }
    }, [adminPw]);

    useEffect(() => { void refresh(); }, [refresh]);

    async function modAction(kind: string, body: Record<string, unknown>) {
        if (!adminPw) { setStatus("❌ Admin password missing."); return; }
        setLoading(true);
        setStatus("");
        try {
            const r = await fetch("/api/admin/moderation", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-admin-password": adminPw },
                body: JSON.stringify({ kind, password: adminPw, actor: "admin", ...body }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
            setStatus(`✅ ${kind} ok`);
            return data;
        } catch (e) {
            setStatus(`❌ ${(e as Error).message}`);
            return null;
        } finally {
            setLoading(false);
            await refresh();
        }
    }

    // Pivot the whole lookup card to a different player. Used by Search button
    // and by every linked-account / ban-list / audit-log button below.
    async function pivotTo(name: string) {
        const target = name.trim();
        if (!target) return;
        setSearchName(target);
        const [lookupData, snapData] = await Promise.all([
            modAction("lookup", { target }),
            modAction("snapshot", { target }),
        ]);
        if (lookupData) setLookup(lookupData as ModLookupResult);
        if (snapData) setSnapshot(snapData as ModSnapshot);
    }

    async function doLookup() {
        await pivotTo(searchName.trim());
    }

    async function doSignalSearch() {
        const v = searchSignal.trim();
        if (!v) return;
        const kind = signalKind === "ip" ? "reverse-ip" : "reverse-fp";
        const body = signalKind === "ip" ? { ip: v } : { fp: v.toLowerCase() };
        const data = await modAction(kind, body);
        if (data) {
            setSignalResult({ kind: signalKind, value: v, names: (data.names as string[]) ?? [] });
        }
    }

    async function loadVillageChat(village: string) {
        const v = village.trim();
        if (!v) return;
        const data = await modAction("fetch-village-chat", { village: v });
        if (data) setChatMessages((data.messages as ModChatMessage[]) ?? []);
    }

    async function deleteChatMessage(village: string, author: string, ts: number) {
        await modAction("delete-chat-message", { village, author, ts });
        await loadVillageChat(village);
    }

    async function ban(target: string, days: number | "permanent") {
        await modAction("ban", { target, days, reason: reason.slice(0, 500) });
    }
    async function unban(target: string) {
        await modAction("unban", { target });
    }
    async function silence(target: string, days: number) {
        await modAction("silence", { target, days, reason: reason.slice(0, 500) });
    }
    async function unsilence(target: string) {
        await modAction("unsilence", { target });
    }
    async function kick(target: string) {
        await modAction("kick", { target, reason: reason.slice(0, 200) });
    }

    function fmtUntil(rec: { until: number; permanent?: boolean }) {
        if (rec.permanent) return "permanent";
        const ms = rec.until - Date.now();
        if (ms <= 0) return "expired";
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    }

    return (
        <div style={{ display: "grid", gap: "1rem" }}>
            <section className="summary-box">
                <h3>🛡 Player Lookup</h3>
                <p className="hint">Search by name to inspect a single account, or paste an IP / fingerprint hash to find every account using it.</p>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <input
                        value={searchName}
                        onChange={(e) => setSearchName(e.target.value)}
                        placeholder="Player name (e.g. Alice)"
                        style={{ flex: 1, minWidth: 200, padding: "0.4rem" }}
                        onKeyDown={(e) => { if (e.key === "Enter") void doLookup(); }}
                    />
                    <button onClick={doLookup} disabled={loading || !searchName.trim()}>Search Name</button>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                    <select value={signalKind} onChange={(e) => setSignalKind(e.target.value as "ip" | "fp")} style={{ padding: "0.4rem" }}>
                        <option value="ip">IP</option>
                        <option value="fp">Fingerprint</option>
                    </select>
                    <input
                        value={searchSignal}
                        onChange={(e) => setSearchSignal(e.target.value)}
                        placeholder={signalKind === "ip" ? "Paste an IP (e.g. 203.0.113.42)" : "Paste a fingerprint hash"}
                        style={{ flex: 1, minWidth: 200, padding: "0.4rem", fontFamily: "monospace" }}
                        onKeyDown={(e) => { if (e.key === "Enter") void doSignalSearch(); }}
                    />
                    <button onClick={doSignalSearch} disabled={loading || !searchSignal.trim()}>Find accounts</button>
                </div>
                {signalResult && (
                    <div style={{ background: "#0a0a1a", borderRadius: 6, padding: "0.5rem", marginTop: "0.5rem" }}>
                        <strong>{signalResult.names.length}</strong> account{signalResult.names.length === 1 ? "" : "s"} on <code style={{ color: signalResult.kind === "ip" ? "#facc15" : "#a78bfa" }}>{signalResult.value}</code>:
                        <div style={{ marginTop: 4 }}>
                            {signalResult.names.length === 0
                                ? <em style={{ color: "#64748b" }}>None recorded.</em>
                                : signalResult.names.map(n => (
                                    <button key={n} onClick={() => pivotTo(n)} style={{ margin: 2, padding: "0.2rem 0.6rem", fontSize: "0.85rem" }}>{n}</button>
                                ))
                            }
                        </div>
                    </div>
                )}
                <label style={{ display: "block", marginTop: "0.6rem" }}>Mod-action reason (saved to audit log)</label>
                <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. spamming chat, slur in name…"
                    style={{ width: "100%", padding: "0.4rem" }}
                    maxLength={500}
                />
                {status && <p className="hint" style={{ marginTop: "0.4rem" }}>{status}</p>}
            </section>

            {snapshot && snapshot.exists && snapshot.snapshot && (
                <section className="summary-box">
                    <h3>👤 {snapshot.target} — Account Snapshot</h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.5rem", marginTop: "0.4rem" }}>
                        <div><strong>Level:</strong> {snapshot.snapshot.level}</div>
                        <div><strong>Village:</strong> {snapshot.snapshot.village || <em style={{ color: "#64748b" }}>none</em>}</div>
                        <div><strong>Clan:</strong> {snapshot.snapshot.clan || <em style={{ color: "#64748b" }}>none</em>}</div>
                        <div><strong>Rank:</strong> {snapshot.snapshot.rank || <em style={{ color: "#64748b" }}>unknown</em>}</div>
                        <div><strong>Specialty:</strong> {snapshot.snapshot.specialty || <em style={{ color: "#64748b" }}>n/a</em>}</div>
                        <div><strong>Ryo:</strong> {snapshot.snapshot.ryo.toLocaleString()}</div>
                        <div><strong>PvP kills:</strong> {snapshot.snapshot.totalPvpKills}</div>
                        <div><strong>AI kills:</strong> {snapshot.snapshot.totalAiKills}</div>
                        <div>
                            <strong>Status:</strong>{" "}
                            {snapshot.snapshot.online
                                ? <span style={{ color: "#4ade80" }}>● online (sector {snapshot.snapshot.currentSector})</span>
                                : <span style={{ color: "#64748b" }}>○ offline</span>}
                        </div>
                        {snapshot.snapshot.lastSeenAt > 0 && (
                            <div><strong>Last seen:</strong> {new Date(snapshot.snapshot.lastSeenAt).toLocaleString()}</div>
                        )}
                        {snapshot.snapshot.hospitalized && (
                            <div style={{ color: "#f87171" }}>🏥 Hospitalized</div>
                        )}
                    </div>
                    {(snapshot.ban || snapshot.silence) && (
                        <div style={{ marginTop: "0.6rem", padding: "0.5rem", background: "#1c0606", borderRadius: 6 }}>
                            {snapshot.ban && (
                                <div style={{ color: "#f87171" }}>
                                    🚫 <strong>BANNED</strong> {snapshot.ban.permanent ? "permanently" : `until ${new Date(snapshot.ban.until).toLocaleString()}`} — {snapshot.ban.reason || <em>no reason</em>} <small>(by {snapshot.ban.by})</small>
                                </div>
                            )}
                            {snapshot.silence && (
                                <div style={{ color: "#fbbf24", marginTop: snapshot.ban ? 4 : 0 }}>
                                    🔇 <strong>SILENCED</strong> until {new Date(snapshot.silence.until).toLocaleString()} — {snapshot.silence.reason || <em>no reason</em>} <small>(by {snapshot.silence.by})</small>
                                </div>
                            )}
                        </div>
                    )}
                </section>
            )}
            {snapshot && !snapshot.exists && (
                <section className="summary-box">
                    <p className="hint">No save found for <strong>{snapshot.target}</strong>. The IP / fingerprint data below may still be useful.</p>
                </section>
            )}

            {lookup && (
                <section className="summary-box">
                    <h3>📍 {lookup.target}</h3>
                    {(lookup.ipRecord || lookup.fpRecord) ? (
                        <>
                            {lookup.ipRecord && (
                                <p><strong>Last IP:</strong> <code>{lookup.ipRecord.lastIp}</code> · <strong>Last seen:</strong> {new Date(lookup.ipRecord.lastSeenAt).toLocaleString()}</p>
                            )}
                            {lookup.fpRecord && (
                                <p><strong>Last fingerprint:</strong> <code>{lookup.fpRecord.lastFp.slice(0, 16)}…</code> · <strong>Fingerprints ever used:</strong> {lookup.fpRecord.fps.length}</p>
                            )}

                            {lookup.linkedByBoth.length > 0 && (
                                <div style={{ background: "#1c0606", border: "1px solid #f87171", borderRadius: 6, padding: "0.6rem", margin: "0.6rem 0" }}>
                                    <strong style={{ color: "#f87171" }}>⚠ Linked by IP AND Fingerprint — almost certainly the same person:</strong>
                                    <div style={{ marginTop: 4 }}>
                                        {lookup.linkedByBoth.map(n => (
                                            <button
                                                key={n}
                                                onClick={() => pivotTo(n)}
                                                style={{ margin: "2px", padding: "0.2rem 0.6rem", fontSize: "0.85rem", background: "#7f1d1d", borderColor: "#f87171" }}
                                            >{n}</button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <h4 style={{ marginTop: "0.8rem", marginBottom: "0.3rem" }}>🌐 Linked by IP ({lookup.linkedByIp.length})</h4>
                            <p className="hint" style={{ marginTop: 0, fontSize: "0.8rem" }}>Same network. Weaker signal — shared cafe / home / corporate IPs trigger this.</p>
                            <div style={{ background: "#0a0a1a", borderRadius: 6, padding: "0.5rem" }}>
                                {lookup.perIp.length === 0
                                    ? <em style={{ color: "#64748b" }}>No IPs recorded yet.</em>
                                    : lookup.perIp.map(({ ip, names }) => (
                                        <div key={ip} style={{ marginBottom: "0.4rem" }}>
                                            <code style={{ color: "#facc15" }}>{ip}</code>
                                            {names.length > 0 ? (
                                                <div style={{ paddingLeft: "1rem", fontSize: "0.9rem" }}>
                                                    also used by: {names.map(n => (
                                                        <button
                                                            key={n}
                                                            onClick={() => pivotTo(n)}
                                                            style={{ marginLeft: 4, padding: "0 6px", fontSize: "0.85rem", background: lookup.linkedByBoth.includes(n) ? "#7f1d1d" : undefined, borderColor: lookup.linkedByBoth.includes(n) ? "#f87171" : undefined }}
                                                        >{n}{lookup.linkedByFp.includes(n) ? " ★" : ""}</button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span style={{ paddingLeft: "1rem", color: "#64748b" }}> — unique to {lookup.target}</span>
                                            )}
                                        </div>
                                    ))
                                }
                            </div>

                            <h4 style={{ marginTop: "0.8rem", marginBottom: "0.3rem" }}>🖥 Linked by Fingerprint ({lookup.linkedByFp.length})</h4>
                            <p className="hint" style={{ marginTop: 0, fontSize: "0.8rem" }}>Same browser + machine. Survives VPNs / cookie clears / incognito. Strong signal.</p>
                            <div style={{ background: "#0a0a1a", borderRadius: 6, padding: "0.5rem" }}>
                                {lookup.perFp.length === 0
                                    ? <em style={{ color: "#64748b" }}>No fingerprints recorded yet.</em>
                                    : lookup.perFp.map(({ fp, names }) => (
                                        <div key={fp} style={{ marginBottom: "0.4rem" }}>
                                            <code style={{ color: "#a78bfa" }}>{fp.slice(0, 16)}…</code>
                                            {names.length > 0 ? (
                                                <div style={{ paddingLeft: "1rem", fontSize: "0.9rem" }}>
                                                    also used by: {names.map(n => (
                                                        <button
                                                            key={n}
                                                            onClick={() => pivotTo(n)}
                                                            style={{ marginLeft: 4, padding: "0 6px", fontSize: "0.85rem", background: lookup.linkedByBoth.includes(n) ? "#7f1d1d" : undefined, borderColor: lookup.linkedByBoth.includes(n) ? "#f87171" : undefined }}
                                                        >{n}{lookup.linkedByIp.includes(n) ? " ★" : ""}</button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span style={{ paddingLeft: "1rem", color: "#64748b" }}> — unique to {lookup.target}</span>
                                            )}
                                        </div>
                                    ))
                                }
                            </div>
                            <p className="hint" style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>★ = also linked by the other signal.</p>
                        </>
                    ) : (
                        <p className="hint">No records yet — player must heartbeat / login at least once.</p>
                    )}
                    <h4 style={{ marginTop: "1rem" }}>Actions on {lookup.target}</h4>
                    <div style={{ display: "grid", gap: "0.3rem", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                        <button onClick={() => ban(lookup.target, 1)} disabled={loading}>🚫 Ban 1d</button>
                        <button onClick={() => ban(lookup.target, 3)} disabled={loading}>🚫 Ban 3d</button>
                        <button onClick={() => ban(lookup.target, 7)} disabled={loading}>🚫 Ban 7d</button>
                        <button onClick={() => ban(lookup.target, "permanent")} disabled={loading} className="danger-button">⛔ Ban Forever</button>
                        <button onClick={() => silence(lookup.target, 1)} disabled={loading}>🔇 Silence 1d</button>
                        <button onClick={() => silence(lookup.target, 3)} disabled={loading}>🔇 Silence 3d</button>
                        <button onClick={() => silence(lookup.target, 7)} disabled={loading}>🔇 Silence 7d</button>
                        <button onClick={() => kick(lookup.target)} disabled={loading}>👢 Force Kick</button>
                        <button onClick={() => unban(lookup.target)} disabled={loading} style={{ background: "#1e3a1e" }}>✅ Unban</button>
                        <button onClick={() => unsilence(lookup.target)} disabled={loading} style={{ background: "#1e3a1e" }}>🔊 Unsilence</button>
                    </div>
                </section>
            )}

            <section className="summary-box">
                <h3>💬 Village Chat Viewer</h3>
                <p className="hint">Pick a village to see its current chat backlog. Click 🗑 to delete a message or 🔇 to silence the author for a day.</p>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <select value={chatVillage} onChange={(e) => { setChatVillage(e.target.value); if (e.target.value) void loadVillageChat(e.target.value); }} style={{ padding: "0.4rem", flex: 1 }}>
                        <option value="">— Choose a village —</option>
                        {villages.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <button onClick={() => loadVillageChat(chatVillage)} disabled={!chatVillage || loading}>Refresh</button>
                </div>
                {chatVillage && (
                    <div style={{ maxHeight: 320, overflowY: "auto", background: "#0a0a1a", borderRadius: 6, padding: "0.5rem", marginTop: "0.5rem" }}>
                        {chatMessages.length === 0
                            ? <em style={{ color: "#64748b" }}>No recent messages in {chatVillage}.</em>
                            : chatMessages.slice().reverse().map(m => (
                                <div key={`${m.author}:${m.ts}`} style={{ padding: "0.3rem 0", borderBottom: "1px solid #1f2937", display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
                                    <div style={{ flex: 1, fontFamily: "monospace", fontSize: "0.85rem" }}>
                                        <span style={{ color: "#94a3b8" }}>{new Date(m.ts).toLocaleTimeString()}</span> ·{" "}
                                        <button onClick={() => pivotTo(m.author)} style={{ background: "transparent", border: 0, color: "#facc15", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline dotted" }}>{m.author}</button>
                                        {m.level != null && <span style={{ color: "#94a3b8" }}> (lvl {m.level})</span>}: <span>{m.text}</span>
                                    </div>
                                    <button onClick={() => silence(m.author, 1)} disabled={loading} title="Silence author 1d" style={{ padding: "0.1rem 0.4rem", fontSize: "0.75rem", background: "#1a2a3a" }}>🔇</button>
                                    <button onClick={() => deleteChatMessage(chatVillage, m.author, m.ts)} disabled={loading} title="Delete this message" style={{ padding: "0.1rem 0.4rem", fontSize: "0.75rem", background: "#3a1a1a" }}>🗑</button>
                                </div>
                            ))
                        }
                    </div>
                )}
            </section>

            <section className="summary-box">
                <h3>🚫 Active Bans ({bans.length})</h3>
                {bans.length === 0
                    ? <p className="hint">None.</p>
                    : (
                        <div style={{ display: "grid", gap: 4 }}>
                            {bans.map(({ name, record }) => (
                                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: "#1c0606", borderRadius: 4 }}>
                                    <span>
                                        <button onClick={() => pivotTo(name)} style={{ background: "transparent", border: 0, color: "#fca5a5", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline dotted" }}>{name}</button>
                                        {" — "}{record.reason || <em>no reason</em>} <small style={{ color: "#94a3b8" }}>(by {record.by}, {fmtUntil(record)} left)</small>
                                    </span>
                                    <button onClick={() => unban(name)} disabled={loading} style={{ background: "#1e3a1e", fontSize: "0.85rem", padding: "0.2rem 0.6rem" }}>Unban</button>
                                </div>
                            ))}
                        </div>
                    )
                }
            </section>

            <section className="summary-box">
                <h3>🔇 Active Silences ({silences.length})</h3>
                {silences.length === 0
                    ? <p className="hint">None.</p>
                    : (
                        <div style={{ display: "grid", gap: 4 }}>
                            {silences.map(({ name, record }) => (
                                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: "#0a1a2a", borderRadius: 4 }}>
                                    <span>
                                        <button onClick={() => pivotTo(name)} style={{ background: "transparent", border: 0, color: "#fde68a", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline dotted" }}>{name}</button>
                                        {" — "}{record.reason || <em>no reason</em>} <small style={{ color: "#94a3b8" }}>(by {record.by}, {fmtUntil(record)} left)</small>
                                    </span>
                                    <button onClick={() => unsilence(name)} disabled={loading} style={{ background: "#1e3a1e", fontSize: "0.85rem", padding: "0.2rem 0.6rem" }}>Unsilence</button>
                                </div>
                            ))}
                        </div>
                    )
                }
            </section>

            <section className="summary-box">
                <h3>📜 Audit Log (last {audit.length})</h3>
                {audit.length === 0
                    ? <p className="hint">No mod actions recorded yet.</p>
                    : (
                        <div style={{ maxHeight: 280, overflowY: "auto", fontFamily: "monospace", fontSize: "0.85rem" }}>
                            {audit.slice(0, 50).map((entry, i) => (
                                <div key={i} style={{ padding: "0.2rem 0", borderBottom: "1px solid #1f2937" }}>
                                    <span style={{ color: "#94a3b8" }}>{new Date(entry.ts).toLocaleString()}</span> · <strong style={{ color: "#facc15" }}>{entry.action}</strong> ·{" "}
                                    <button onClick={() => pivotTo(entry.target)} style={{ background: "transparent", border: 0, color: "#e2e8f0", cursor: "pointer", padding: 0, fontWeight: 700, textDecoration: "underline dotted", fontFamily: "monospace" }}>{entry.target}</button>
                                    {" · "}<em style={{ color: "#94a3b8" }}>by {entry.actor}</em>
                                    {entry.detail && <div style={{ paddingLeft: "1rem", color: "#cbd5e1" }}>{entry.detail}</div>}
                                </div>
                            ))}
                        </div>
                    )
                }
            </section>
        </div>
    );
}
