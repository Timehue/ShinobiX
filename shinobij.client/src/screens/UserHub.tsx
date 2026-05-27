/*
 * UserHub — the "all users" directory screen.
 *
 * Merges the local PlayerRoster with the live ServerPlayerSummary list
 * from the server, dedupes by lowercased name, and renders one row per
 * known player. Online players appear first, then by most-recently-seen.
 * Clicking a row routes the caller (App.tsx) to UserView for that name.
 *
 * Pure leaf component — only React state, only the supplied props. Zero
 * App.tsx helper dependencies. Extracted from App.tsx to shrink the
 * monolith and re-enable React Fast Refresh on this screen.
 */

import { useState } from "react";
import type { PlayerRecord, ServerPlayerSummary } from "../types/character";

export function UserHub({
    currentName,
    allServerPlayers,
    playerRoster,
    sharedImages,
    onSelect,
    onBack,
}: {
    currentName: string;
    allServerPlayers: ServerPlayerSummary[];
    playerRoster: PlayerRecord[];
    sharedImages: Record<string, string>;
    onSelect: (name: string) => void;
    onBack: () => void;
}) {
    const [search, setSearch] = useState("");

    // Merge roster + server list so we have avatars for as many players as possible.
    const merged = (() => {
        const byName = new Map<string, { name: string; level: number; village: string; online: boolean; lastSeenAt: number; avatar?: string; rank?: string; title?: string }>();
        for (const p of playerRoster) {
            byName.set(p.name.toLowerCase(), {
                name: p.name,
                level: p.level ?? p.character.level,
                village: p.village || p.character.village,
                online: false,
                lastSeenAt: p.lastSeenAt ?? 0,
                avatar: p.character.avatarImage,
                rank: p.character.rankTitle,
                title: p.character.customTitle,
            });
        }
        for (const s of allServerPlayers) {
            const key = s.name.toLowerCase();
            const prior = byName.get(key);
            byName.set(key, {
                name: s.name,
                level: s.level ?? prior?.level ?? 1,
                village: s.village || prior?.village || "",
                online: s.online,
                lastSeenAt: s.lastSeenAt ?? prior?.lastSeenAt ?? 0,
                avatar: s.character?.avatarImage ?? prior?.avatar,
                rank: s.character?.rankTitle ?? prior?.rank,
                title: s.character?.customTitle ?? prior?.title,
            });
        }
        return [...byName.values()].filter(p => p.name.toLowerCase() !== currentName.toLowerCase());
    })();

    // Online first, then by most-recently-seen.
    merged.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0);
    });

    const q = search.trim().toLowerCase();
    const filtered = q ? merged.filter(p => p.name.toLowerCase().includes(q)) : merged;

    function timeAgo(ts: number) {
        if (!ts) return "unknown";
        const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        if (diffSec < 60)     return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60)     return `${diffMin}m ago`;
        const diffHr  = Math.floor(diffMin / 60);
        if (diffHr  < 24)     return `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        return `${diffDay}d ago`;
    }

    return (
        <div className="card user-hub-screen">
            <div className="user-hub-header">
                <button className="back-btn" onClick={onBack}>Back</button>
                <div>
                    <h2>Users</h2>
                    <p className="hint">All shinobi in the world. Online players appear first; click any name to view their profile.</p>
                </div>
            </div>

            <input
                type="text"
                className="user-hub-search"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

            {filtered.length === 0 ? (
                <p className="hint">No users found.</p>
            ) : (
                <div className="user-hub-list">
                    {filtered.map(p => {
                        const sharedAvatar = sharedImages['avatar:' + p.name.toLowerCase()];
                        const avatar = sharedAvatar || p.avatar || "";
                        return (
                            <button
                                key={p.name}
                                type="button"
                                className={`user-hub-row${p.online ? " online" : ""}`}
                                onClick={() => onSelect(p.name)}
                            >
                                <div className="user-hub-avatar">
                                    {avatar
                                        ? <img src={avatar} alt={p.name} />
                                        : <span>{p.name.slice(0, 2).toUpperCase()}</span>}
                                </div>
                                <div className="user-hub-meta">
                                    <div className="user-hub-name">
                                        <strong>{p.name}</strong>
                                        {p.title && <span className="user-hub-title">{p.title}</span>}
                                    </div>
                                    <div className="user-hub-sub">
                                        Lv {p.level} · {p.rank || "Shinobi"} · {p.village || "Unknown Village"}
                                    </div>
                                </div>
                                <div className="user-hub-status">
                                    <span className={`user-hub-dot ${p.online ? "online" : "offline"}`} />
                                    <small>{p.online ? "Online" : timeAgo(p.lastSeenAt)}</small>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
