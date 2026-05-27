/*
 * Mobile-only bottom nav + full-screen menu overlay. Shown below xl
 * viewport (CSS-gated). Five anchor buttons in the bottom bar, full
 * grid of game screens in the slide-up overlay.
 *
 * Pure leaf — props give it character + nav callbacks. Admin button
 * is gated to the protected admin name.
 *
 * Extracted from App.tsx.
 */

import { useState } from "react";
import { xpNeeded } from "../App";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { MAX_LEVEL, isProtectedAdminName } from "../constants/game";

export function MobileNav({
    navigate,
    adminLoggedIn,
    logoutPlayer,
    character,
    atHome,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    character: Character;
    currentSector: number;
    atHome: boolean;
}) {
    const [open, setOpen] = useState(false);
    const isAdminAccount = isProtectedAdminName(character.name);

    const xpPct = character.level >= MAX_LEVEL
        ? 100
        : Math.min(100, Math.round((character.xp / xpNeeded(character.level)) * 100));

    function go(screen: Screen) {
        navigate(screen);
        setOpen(false);
    }

    return (
        <>
            <nav className="mobile-bottom-nav">
                <button className="mobile-nav-btn" onClick={() => go("worldMap")}>
                    <span className="mnb-icon">🗺️</span>
                    Travel
                </button>
                <button className="mobile-nav-btn" onClick={() => go("village")} disabled={!atHome}>
                    <span className="mnb-icon">🏯</span>
                    Village
                </button>
                <button className="mobile-nav-btn" onClick={() => go("profile")}>
                    <span className="mnb-icon">👤</span>
                    Char
                </button>
                <button className="mobile-nav-btn" onClick={() => go("inventory")}>
                    <span className="mnb-icon">🎒</span>
                    Items
                </button>
                <button className="mobile-nav-btn menu-btn" onClick={() => setOpen(true)}>
                    <span className="mnb-icon">☰</span>
                    Menu
                </button>
            </nav>

            {open && (
                <div className="mobile-menu-overlay">
                    <div className="mobile-menu-header">
                        <span className="mobile-menu-title">🥷 SHINOBI MENU</span>
                        <button className="mobile-menu-close" onClick={() => setOpen(false)}>✕</button>
                    </div>

                    <div className="mobile-char-card">
                        <div className="mobile-char-avatar">
                            {character.avatarImage
                                ? <img src={character.avatarImage} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : character.name.slice(0, 2).toUpperCase()
                            }
                        </div>
                        <div className="mobile-char-info">
                            <div className="mobile-char-name">{character.name}</div>
                            <div className="mobile-char-sub">Lv {character.level} · {character.rankTitle} · {character.village}</div>
                            <div className="mobile-xp-bar-track">
                                <div className="mobile-xp-bar-fill" style={{ width: `${xpPct}%` }} />
                            </div>
                        </div>
                    </div>

                    <div className="mobile-menu-grid">
                        <button className="mobile-menu-btn" onClick={() => go("village")} disabled={!atHome}>🏯 Village</button>
                        <button className="mobile-menu-btn" onClick={() => go("worldMap")}>🗺️ Travel</button>
                        <button className="mobile-menu-btn" onClick={() => go("userHub")}>👥 Users</button>
                        <button className="mobile-menu-btn" onClick={() => go("profile")}>👤 Character</button>
                        <button className="mobile-menu-btn" onClick={() => go("logbook")}>📜 Logbook</button>
                        <button className="mobile-menu-btn" onClick={() => go("inventory")}>🎒 Inventory</button>
                        <button className="mobile-menu-btn" onClick={() => go("training")}>💪 Stats</button>
                        <button className="mobile-menu-btn" onClick={() => go("jutsuTraining")}>⚡ Jutsu</button>
                        <button className="mobile-menu-btn" onClick={() => go("missions")}>📋 Missions</button>
                        <button className="mobile-menu-btn" onClick={() => go("pets")}>🐾 Pets</button>
                        <button className="mobile-menu-btn" onClick={() => go("arena")}>⚔️ Arena</button>
                        <button className="mobile-menu-btn" onClick={() => go("bloodlineMaker")}>🧬 Bloodline</button>
                        {isAdminAccount && (
                            <button className="mobile-menu-btn" onClick={() => go(adminLoggedIn ? "adminPanel" : "adminLogin")}>🛠️ Admin</button>
                        )}
                        <button className="mobile-menu-btn" onClick={() => { logoutPlayer(); setOpen(false); }}>💾 Logout + Save</button>
                    </div>
                </div>
            )}
        </>
    );
}
