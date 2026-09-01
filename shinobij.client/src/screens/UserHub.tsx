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

// Relative-time display reads Date.now() in render by design; verbatim-moved from App.tsx (rule disabled file-wide there).
/* eslint-disable react-hooks/purity */
import { useState, useEffect, type FormEvent } from "react";
import "../styles/profile-skin.css";
import type { PlayerRecord, ServerPlayerSummary } from "../types/character";
import { addFriend, follow, removeFriend, subscribeFollowing, subscribeFriends, unfollow } from "../lib/friends";

type UserHubTab = 'all' | 'following' | 'friends' | 'blocked';
type HubPlayer = {
    name: string;
    level: number;
    village: string;
    online: boolean;
    lastSeenAt: number;
    avatar?: string;
    rank?: string;
    title?: string;
    detailsKnown?: boolean;
};

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
    const [tab, setTab] = useState<UserHubTab>('all');
    const [following, setFollowing] = useState<string[]>([]);
    const [friends, setFriends] = useState<string[]>([]);
    const [blocked, setBlocked] = useState<string[]>([]);
    const [friendName, setFriendName] = useState("");
    const [blockName, setBlockName] = useState("");
    const [listBusy, setListBusy] = useState(false);
    const [listNotice, setListNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => subscribeFollowing(currentName, setFollowing), [currentName]);
    useEffect(() => subscribeFriends(currentName, setFriends), [currentName]);
    useEffect(() => {
        let current = true;
        void (async () => {
            try {
                const r = await fetch('/api/player/blocks');
                if (!r.ok) return;
                const data = await r.json() as { blocked?: unknown };
                if (current) setBlocked(Array.isArray(data.blocked) ? data.blocked.map(String) : []);
            } catch { /* offline — leave the list empty */ }
        })();
        return () => { current = false; };
    }, [currentName]);

    const isFollowed = (name: string) => following.some(f => f.toLowerCase() === name.toLowerCase());
    const isOnList = (list: string[], name: string) => list.some(entry => entry.toLowerCase() === name.toLowerCase());

    function toggleFollow(name: string) {
        if (isFollowed(name)) void unfollow(currentName, name);
        else void follow(currentName, name);
    }

    function selectTab(next: UserHubTab) {
        setTab(next);
        setListNotice(null);
    }

    async function setPlayerBlocked(target: string, value: boolean): Promise<void> {
        const cleanTarget = target.trim();
        if (!cleanTarget || listBusy) return;
        setListBusy(true);
        setListNotice(null);
        try {
            const r = await fetch('/api/player/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: cleanTarget, blocked: value }),
            });
            const data = await r.json().catch(() => ({})) as { error?: string; blocked?: unknown };
            if (!r.ok) throw new Error(data.error || 'Could not update your blocked list.');
            setBlocked(Array.isArray(data.blocked) ? data.blocked.map(String) : []);
            if (value) setBlockName("");
            setListNotice({ tone: 'success', text: value ? `${cleanTarget} is now blocked.` : `${cleanTarget} was unblocked.` });
        } catch (cause) {
            setListNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not update your blocked list.' });
        } finally {
            setListBusy(false);
        }
    }

    async function submitListEntry(event: FormEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        if (listBusy) return;
        const target = (tab === 'friends' ? friendName : blockName).trim();
        if (!target) return;

        if (tab === 'blocked') {
            await setPlayerBlocked(target, true);
            return;
        }
        if (tab !== 'friends') return;

        setListBusy(true);
        setListNotice(null);
        try {
            await addFriend(currentName, target);
            setFriendName("");
            setListNotice({ tone: 'success', text: `${target} was added to Friends.` });
        } catch (cause) {
            setListNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not update your friends list.' });
        } finally {
            setListBusy(false);
        }
    }

    async function deleteFriend(target: string): Promise<void> {
        if (listBusy) return;
        setListBusy(true);
        setListNotice(null);
        try {
            await removeFriend(currentName, target);
            setListNotice({ tone: 'success', text: `${target} was removed from Friends.` });
        } catch (cause) {
            setListNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Could not update your friends list.' });
        } finally {
            setListBusy(false);
        }
    }

    // Merge roster + server list so we have avatars for as many players as possible.
    const merged = (() => {
        const byName = new Map<string, HubPlayer>();
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
                detailsKnown: true,
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
                detailsKnown: true,
            });
        }
        return [...byName.values()]
            .filter(p => p.name.toLowerCase() !== currentName.toLowerCase())
            // Hide admin accounts — they aren't player-facing characters.
            .filter(p => (p.rank ?? "").toLowerCase() !== "admin")
            // Hide entries whose name is a clan slug (e.g. "Clan-Meow") —
            // these get registered as accounts but shouldn't appear in
            // the player directory.
            .filter(p => !/^clan[-\s]/i.test(p.name.trim()));
    })();

    // Sort offline group by most-recently-seen; online ones grouped first via render below.
    merged.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));

    const selectedList = tab === 'following' ? following : tab === 'friends' ? friends : tab === 'blocked' ? blocked : null;
    const candidates = [...merged];
    // A saved social relationship should remain manageable when that player is
    // offline long enough to fall out of the polled/public directory.
    if (selectedList) {
        for (const name of selectedList) {
            if (!candidates.some(player => player.name.toLowerCase() === name.toLowerCase())) {
                candidates.push({ name, level: 1, village: '', online: false, lastSeenAt: 0, detailsKnown: false });
            }
        }
    }

    const q = search.trim().toLowerCase();
    const searched = q ? candidates.filter(p => p.name.toLowerCase().includes(q)) : candidates;
    const filtered = selectedList ? searched.filter(p => isOnList(selectedList, p.name)) : searched;

    // Split into online + offline so we can render section headers.
    // Cleaner than a flat list — players know at a glance who's actually around.
    const online = filtered.filter(p => p.online);
    const offline = filtered.filter(p => !p.online);

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

            <div className="user-hub-tabs">
                <button className={`user-hub-tab${tab === 'all' ? ' active' : ''}`} onClick={() => selectTab('all')}>All</button>
                <button className={`user-hub-tab${tab === 'following' ? ' active' : ''}`} onClick={() => selectTab('following')}>
                    ★ Following{following.length ? ` (${following.length})` : ''}
                </button>
                <button className={`user-hub-tab${tab === 'friends' ? ' active' : ''}`} onClick={() => selectTab('friends')}>
                    ♥ Friends{friends.length ? ` (${friends.length})` : ''}
                </button>
                <button className={`user-hub-tab${tab === 'blocked' ? ' active blocked' : ''}`} onClick={() => selectTab('blocked')}>
                    ⊘ Blocked{blocked.length ? ` (${blocked.length})` : ''}
                </button>
            </div>

            {(tab === 'friends' || tab === 'blocked') && (
                <form className={`user-hub-list-manager ${tab}`} onSubmit={(event) => void submitListEntry(event)}>
                    <label htmlFor={`user-hub-${tab}-name`}>
                        {tab === 'friends' ? 'Add a friend by player name' : 'Block a player by name'}
                    </label>
                    <div className="user-hub-list-manager-row">
                        <input
                            id={`user-hub-${tab}-name`}
                            type="text"
                            value={tab === 'friends' ? friendName : blockName}
                            onChange={(event) => tab === 'friends' ? setFriendName(event.target.value) : setBlockName(event.target.value)}
                            placeholder="Enter exact player name…"
                            autoComplete="off"
                            maxLength={40}
                        />
                        <button type="submit" disabled={listBusy || !(tab === 'friends' ? friendName : blockName).trim()}>
                            {listBusy ? 'Saving…' : tab === 'friends' ? 'Add Friend' : 'Block Player'}
                        </button>
                    </div>
                    {listNotice && <p className={`user-hub-list-notice ${listNotice.tone}`} role="status">{listNotice.text}</p>}
                </form>
            )}

            {filtered.length === 0 ? (
                <p className="hint">{
                    search.trim() ? 'No matching players found.'
                        : tab === 'following' ? "You're not following anyone yet. Open a profile to follow them."
                            : tab === 'friends' ? 'Your Friends list is empty. Add someone by player name above.'
                                : tab === 'blocked' ? 'You have not blocked anyone.'
                                    : 'No users found.'
                }</p>
            ) : (
                <>
                    {online.length > 0 && (
                        <>
                            <div className="user-hub-section-header user-hub-section-online">
                                <span className="user-hub-section-label">Online Now</span>
                                <span className="user-hub-section-count">{online.length}</span>
                            </div>
                            <div className="user-hub-list">
                                {online.map(p => renderRow(p, sharedImages, timeAgo, onSelect, tab, isFollowed(p.name), toggleFollow, listBusy, deleteFriend, setPlayerBlocked))}
                            </div>
                        </>
                    )}

                    {offline.length > 0 && (
                        <>
                            <div className="user-hub-section-header user-hub-section-offline">
                                <span className="user-hub-section-label">Offline</span>
                                <span className="user-hub-section-count">{offline.length}</span>
                            </div>
                            <div className="user-hub-list">
                                {offline.map(p => renderRow(p, sharedImages, timeAgo, onSelect, tab, isFollowed(p.name), toggleFollow, listBusy, deleteFriend, setPlayerBlocked))}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

// Row renderer extracted so the online/offline sections share the same
// markup without duplication.
function renderRow(
    p: HubPlayer,
    sharedImages: Record<string, string>,
    timeAgo: (ts: number) => string,
    onSelect: (name: string) => void,
    tab: UserHubTab,
    isFollowed: boolean,
    onToggleFollow: (name: string) => void,
    listBusy: boolean,
    onRemoveFriend: (name: string) => Promise<void>,
    onUnblock: (name: string, value: boolean) => Promise<void>,
) {
    const sharedAvatar = sharedImages['avatar:' + p.name.toLowerCase()];
    const avatar = sharedAvatar || p.avatar || "";
    return (
        <div
            key={p.name}
            role="button"
            tabIndex={0}
            className={`user-hub-row${p.online ? " online" : ""}`}
            onClick={() => onSelect(p.name)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.name); } }}
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
                    {p.detailsKnown === false
                        ? 'Saved player · profile details unavailable'
                        : `Lv ${p.level} · ${p.rank || "Shinobi"} · ${p.village || "Unknown Village"}`}
                </div>
            </div>
            <div className="user-hub-status">
                <span className={`user-hub-dot ${p.online ? "online" : "offline"}`} />
                <small>{p.online ? "Online" : timeAgo(p.lastSeenAt)}</small>
            </div>
            {tab === 'friends' ? (
                <button
                    type="button"
                    className="user-hub-list-action remove"
                    disabled={listBusy}
                    onClick={(event) => { event.stopPropagation(); void onRemoveFriend(p.name); }}
                >Remove</button>
            ) : tab === 'blocked' ? (
                <button
                    type="button"
                    className="user-hub-list-action unblock"
                    disabled={listBusy}
                    onClick={(event) => { event.stopPropagation(); void onUnblock(p.name, false); }}
                >Unblock</button>
            ) : (
                <button
                    type="button"
                    className={`user-hub-follow-star${isFollowed ? " following" : ""}`}
                    aria-label={isFollowed ? "Unfollow" : "Follow"}
                    title={isFollowed ? "Unfollow" : "Follow"}
                    onClick={(e) => { e.stopPropagation(); onToggleFollow(p.name); }}
                >{isFollowed ? "★" : "☆"}</button>
            )}
        </div>
    );
}
