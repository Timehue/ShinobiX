/*
 * Clan War quick-reference manual. Popped open from a "?" button on the
 * Clan Hall → Wars tab and the Shinobi Council Hall → Clan Battles tab.
 * Keeps the rules in one place so any future balance change only has to
 * update this manual.
 *
 * Pure static markup; the only prop is the dismiss callback.
 */

export function ClanWarManual({ onClose }: { onClose: () => void }) {
    return (
        <div style={{ background: "#0b1220", border: "1px solid #334155", borderRadius: 8, padding: "1rem", marginBottom: "1rem", fontSize: "0.9rem", lineHeight: 1.55 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ color: "#fde047", fontSize: "1rem" }}>📜 Clan War — Quick Guide</strong>
                <button type="button" onClick={onClose} style={{ padding: "0.15rem 0.5rem", background: "#7f1d1d", borderColor: "#ef4444", color: "#fca5a5", fontSize: "0.75rem" }}>✕ Close</button>
            </div>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>Goal:</strong> drop the enemy clan's HP to <strong>0</strong>. Both clans start at <strong>1,000 HP</strong>. All damage comes from completed challenges — no open-world fighting.
            </p>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>1. Declare war.</strong> Your clan's <em>Founder, Leader, or Officer</em> opens this tab, picks an enemy clan, and clicks <em>Declare</em>. One war per clan; 7-day cooldown between the same two clans.
            </p>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>2. Send a challenge.</strong> Pick a mode and click <em>Send</em>. The enemy clan sees the mode but not your name — challenges are anonymous until accepted. Each player can have up to <strong>2 challenges in flight</strong>. Cancel any time to free a slot.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 0, border: "1px solid #334155", borderRadius: 6, overflow: "hidden", margin: "0 0 0.6rem", fontSize: "0.82rem" }}>
                <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#fde047" }}>Mode</div>
                <div style={{ background: "#1e293b", padding: "0.35rem 0.6rem", fontWeight: 700, color: "#f87171", textAlign: "right" }}>Win damage</div>
                <div style={{ padding: "0.3rem 0.6rem" }}>⚔ 1v1 PvP</div>
                <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#f87171" }}>−30 HP</div>
                <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a" }}>⚔⚔ 2v2 PvP</div>
                <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#f87171" }}>−60 HP</div>
                <div style={{ padding: "0.3rem 0.6rem" }}>🐾 Pet 1v1</div>
                <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#f87171" }}>−20 HP</div>
                <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a" }}>🐾🐾 Pet 2v2</div>
                <div style={{ padding: "0.3rem 0.6rem", background: "#0f172a", textAlign: "right", color: "#f87171" }}>−40 HP</div>
                <div style={{ padding: "0.3rem 0.6rem" }}>🃏 Tile Cards</div>
                <div style={{ padding: "0.3rem 0.6rem", textAlign: "right", color: "#f87171" }}>−10 HP</div>
            </div>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>3. 2v2 needs 2 players per side.</strong> Both sending and accepting use a quick queue: one player opens the slot, a clanmate joins as partner, and the match goes live. Anyone can leave the queue before it fills.
            </p>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>4. Accept = play.</strong> When the defender accepts, <em>both clients are auto-pulled into the battle</em>. PvP / Pet / Tile-Card screens open on their own. Fight, and the server records the result — no buttons to click after the win.
            </p>
            <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem", background: "#0a1a2a", border: "1px solid #60a5fa", borderRadius: 6, padding: "0.5rem 0.7rem" }}>
                <strong style={{ color: "#60a5fa" }}>🃏 Tile-card duels:</strong> after accept you get <strong>30 seconds</strong> to pick 5 cards from your collection and hit <em>Lock in deck</em>. If both players ready up early the match starts immediately; otherwise the auto-picked top-5 deck is used. Then a <strong>coin flip</strong> decides who goes first. Place cards on a 3x3 board, capture by edge strength. Board full → winner gets credited.
            </p>
            <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem", color: "#fbbf24" }}>
                ⏳ <strong>Don't ghost.</strong> Pending challenges expire after <strong>1 hour</strong> if the defender does nothing — each expired challenge takes <strong>−5 HP</strong> off the defender's clan.
            </p>
            <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#60a5fa" }}>5. Winning.</strong> First clan to drive the enemy to 0 HP wins. Each side gets an MVP (most wins).
            </p>
            <p style={{ margin: 0 }}>
                <strong style={{ color: "#60a5fa" }}>Rewards (auto-claimed):</strong>
                <br />• <strong>Winning clan:</strong> 1× Legendary War Crate per member.
                <br />• <strong>MVP each side:</strong> +10,000 ryo, +50 Honor Seals (or 6 Bone Charms + 4 Fate Shards for non-Vanguards), +2 Fate Shards.
                <br />• <strong>Losing-side participants:</strong> consolation ryo + seals/charms if you contributed.
            </p>
        </div>
    );
}
