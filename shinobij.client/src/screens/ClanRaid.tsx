/* eslint-disable react-hooks/set-state-in-effect -- idiomatic fetch-on-mount;
   same file-level disable as ClanWarsPanel / ClanBattlesTab. */
/*
 * Clan Raid tab — the weekly async co-op boss. Members strike a shared-HP boss
 * on their own schedule; when it dies, everyone who contributed shares the
 * reward by their damage. All authority is server-side (see api/clan/raid/*);
 * this view just renders state, fires strike/claim, and reflects the credited
 * reward locally so the autosave converges. Gated behind clanRaid.v1.
 */
import { useCallback, useEffect, useState } from "react";
import type { Character } from "../types/character";
import { clanRaidAttack, clanRaidClaim, fetchClanRaid, type RaidView } from "../lib/clan-raid-api";

function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function ClanRaid({ character, updateCharacter }: {
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
}) {
    const [raid, setRaid] = useState<RaidView | null>(null);
    const [status, setStatus] = useState<"loading" | "ok" | "noClan" | "noRaid">("loading");
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState("");

    const load = useCallback(async () => {
        const res = await fetchClanRaid(character.name);
        if (!res || !res.ok) { setStatus("noRaid"); return; }
        if (!res.inClan) { setStatus("noClan"); return; }
        if (!res.raid) { setStatus("noRaid"); return; }
        setRaid(res.raid);
        setStatus("ok");
    }, [character.name]);

    useEffect(() => { void load(); }, [load]);

    async function doAttack() {
        if (busy) return;
        setBusy(true);
        try {
            const r = await clanRaidAttack(character.name);
            if (!r.ok) { setFlash(r.error ?? "Strike failed."); return; }
            if (r.alreadyDefeated) setFlash("The boss is already defeated — claim your reward below.");
            else setFlash(`${r.crit ? "💥 CRITICAL! " : ""}You struck for ${(r.damage ?? 0).toLocaleString()} damage.${r.killed ? " The boss falls! 🎉" : ""}`);
            await load();
        } finally { setBusy(false); }
    }

    async function doClaim() {
        if (busy) return;
        setBusy(true);
        try {
            const r = await clanRaidClaim(character.name);
            if (!r.ok) { setFlash(r.error ?? "Claim failed."); return; }
            const ryo = r.ryo ?? 0;
            const contrib = r.contrib ?? 0;
            // Reflect the server-credited reward on the latest character (functional
            // updater — a concurrent heartbeat/regen setState must not clobber it).
            updateCharacter(prev => prev ? ({ ...prev, ryo: prev.ryo + ryo, clanEventContrib: (prev.clanEventContrib ?? 0) + contrib }) : prev);
            setFlash(`Raid reward claimed: +${ryo.toLocaleString()} ryo${r.clanXp ? ` · +${r.clanXp} clan XP to the clan` : ""}.`);
            await load();
        } finally { setBusy(false); }
    }

    if (status === "loading") return <div className="summary-box"><p className="hint">Scouting the raid boss…</p></div>;
    if (status === "noClan") return <div className="summary-box"><h3>Clan Raid</h3><p className="hint">Join a clan to take on weekly raid bosses together.</p></div>;
    if (status === "noRaid" || !raid) return <div className="summary-box"><h3>Clan Raid</h3><p className="hint">No raid is available right now. A fresh boss appears at the start of each week.</p></div>;

    const hpPct = Math.max(0, Math.min(100, (raid.hp / raid.hpMax) * 100));
    const dead = !!raid.killedAt;
    const mySlug = slugify(character.name);

    return (
        <div className="summary-box clan-raid">
            <div className="clan-raid-boss">
                <span className="clan-raid-boss-icon">{raid.boss.icon}</span>
                <div>
                    <h3 style={{ margin: 0 }}>{raid.boss.name}</h3>
                    <p className="hint" style={{ margin: "3px 0 0" }}>{raid.boss.flavor}</p>
                </div>
            </div>

            <div className="clan-raid-hp">
                <div className="bar enemy-bar" style={{ background: "#0b1220" }}>
                    <span style={{ width: `${hpPct}%`, background: dead ? "#64748b" : "#ef4444" }} />
                </div>
                <div className="clan-raid-hp-label">
                    <span>{dead ? "☠ Defeated" : "Boss HP"}</span>
                    <span>{raid.hp.toLocaleString()} / {raid.hpMax.toLocaleString()}</span>
                </div>
            </div>

            {flash && <p className="clan-raid-flash">{flash}</p>}

            <div className="menu" style={{ marginTop: 8 }}>
                {!dead && (
                    <button onClick={() => void doAttack()} disabled={busy || raid.me.attemptsLeft <= 0}>
                        {busy ? "Striking…" : raid.me.attemptsLeft > 0 ? `⚔ Strike the boss (${raid.me.attemptsLeft} left)` : "No strikes left this week"}
                    </button>
                )}
                {dead && raid.me.canClaim && <button onClick={() => void doClaim()} disabled={busy}>{busy ? "Claiming…" : "🎁 Claim your reward"}</button>}
                {dead && raid.me.claimed && <span className="hint" style={{ color: "#4ade80", fontWeight: 600 }}>✓ Reward claimed</span>}
                {dead && !raid.me.canClaim && !raid.me.claimed && <span className="hint">You didn't land a hit on this boss.</span>}
            </div>

            <p className="hint" style={{ marginTop: 8, fontSize: "0.78rem" }}>
                You've dealt <strong>{raid.me.damage.toLocaleString()}</strong> damage this week. Every member who lands a hit shares the reward when the boss dies — the bigger your share of the damage, the bigger your cut, and the whole clan gets a bonus for the kill.
            </p>

            <h4 style={{ margin: "14px 0 6px" }}>Clan Contribution</h4>
            {raid.leaderboard.length === 0 ? (
                <p className="hint">No strikes yet — be the first to attack!</p>
            ) : (
                <div className="clan-raid-board">
                    {raid.leaderboard.map((e, i) => {
                        const isMe = e.slug === mySlug;
                        return (
                            <div key={e.slug} className={`clan-member-row-v2${isMe ? " clan-member-me" : ""}`} style={{ padding: "6px 10px" }}>
                                <span className="clan-member-pos">#{i + 1}</span>
                                <div className="clan-member-info"><span className="clan-member-name">{e.name}{isMe ? " ⭐" : ""}</span></div>
                                <span className="clan-contrib-total">{e.damage.toLocaleString()} dmg</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
