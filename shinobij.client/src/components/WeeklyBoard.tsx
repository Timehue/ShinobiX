/*
 * Weekly mission board panel (Mission Hall → Weekly tab). A global, weekly-
 * rotating set of cross-system goals. Reads/claims via api/missions/weekly-board;
 * the server is authoritative, so on claim we just reflect the returned reward
 * locally and mark the mission claimed.
 */
import { useEffect, useState } from "react";
import type { Character } from "../types/character";
import { fetchWeeklyBoard, claimWeeklyMission, rewardText, type WeeklyBoard as Board } from "../lib/weekly-board";

export function WeeklyBoard({ character, updateCharacter }: { character: Character; updateCharacter: (c: Character) => void }) {
    const [board, setBoard] = useState<Board | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        fetchWeeklyBoard(character.name).then((b) => { if (alive) { setBoard(b); setLoading(false); } });
        return () => { alive = false; };
    }, [character.name]);

    async function claim(missionId: string) {
        if (busy) return;
        setBusy(missionId);
        const res = await claimWeeklyMission(character.name, missionId);
        setBusy(null);
        if (!res.ok) { alert(res.error || "Could not claim."); return; }
        if (res.reward) {
            updateCharacter({
                ...character,
                ryo: character.ryo + (res.reward.ryo ?? 0),
                fateShards: (character.fateShards ?? 0) + (res.reward.fateShards ?? 0),
                boneCharms: (character.boneCharms ?? 0) + (res.reward.boneCharms ?? 0),
            });
            alert(`Reward claimed: ${rewardText(res.reward)}.`);
        }
        setBoard((b) => b ? { ...b, missions: b.missions.map((m) => m.id === missionId ? { ...m, claimed: true } : m) } : b);
    }

    // eslint-disable-next-line react-hooks/purity -- countdown is time-sensitive by design
    const msLeft = board ? Math.max(0, board.endsAt - Date.now()) : 0;
    const days = Math.floor(msLeft / 86_400_000);
    const hours = Math.floor((msLeft % 86_400_000) / 3_600_000);

    return (
        <section className="mh-section">
            <h3 className="mh-section-title">🗓️ Weekly Board</h3>
            <p className="hint">A rotating set of cross-system goals, the same for everyone. Resets every Monday{board ? ` · ${days}d ${hours}h left` : ""}. Progress counts from when you first open the board each week.</p>
            {loading
                ? <p className="hint">Loading weekly board…</p>
                : !board || board.missions.length === 0
                    ? <p className="hint">No weekly missions available right now.</p>
                    : (
                        <div className="mh-fetch-grid">
                            {board.missions.map((m) => {
                                const pct = Math.min(100, (m.progress / Math.max(1, m.target)) * 100);
                                return (
                                    <div key={m.id} className={`mh-fetch-card${m.complete ? " mh-fetch-complete" : ""}`}>
                                        <div className="mh-fetch-info">
                                            <strong>{m.name}</strong>
                                            <span className="mh-fetch-meta">{m.desc}</span>
                                        </div>
                                        <div className="mh-fetch-rewards">
                                            {m.reward.ryo ? <span>💰 {m.reward.ryo.toLocaleString()} ryo</span> : null}
                                            {m.reward.fateShards ? <span>🔮 {m.reward.fateShards} Fate Shards</span> : null}
                                            {m.reward.boneCharms ? <span>🦴 {m.reward.boneCharms} Bone Charms</span> : null}
                                        </div>
                                        <div className="mh-fetch-progress-wrap">
                                            <div className="mh-fetch-progress-label">
                                                <span>{Math.min(m.progress, m.target)}/{m.target}</span>
                                            </div>
                                            <div className="mission-progress"><span style={{ width: `${pct}%` }} /></div>
                                        </div>
                                        <div className="mh-fetch-actions">
                                            {m.claimed
                                                ? <button disabled>✅ Claimed</button>
                                                : m.complete
                                                    ? <button className="mh-claim-btn" disabled={busy === m.id} onClick={() => { void claim(m.id); }}>{busy === m.id ? "Claiming…" : "✅ Claim Reward"}</button>
                                                    : <button disabled>In Progress</button>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
        </section>
    );
}
