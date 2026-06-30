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

import { memo, useEffect, useState } from "react";
import { xpNeeded } from "../App";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { MAX_LEVEL, isProtectedAdminName } from "../constants/game";
import { PROFESSION_LABEL } from "../data/professions";
import { MailUnreadBadge, MailUnreadDot } from "./MailUnreadBadge";
import { MobileNotificationBar } from "./MobileNotificationBar";
import {
    Backpack, BookOpen, ClipboardList, Compass, Droplet, Dumbbell, Heart, LogOut,
    Mail, Map, Menu as MenuIcon, MessageCircle, PawPrint, ScrollText, User, Users,
    Wine, Wrench, Zap,
} from "lucide-react";

// Memo'd — the bottom nav only depends on character.xp/level (immutable
// snapshots from App), the navigate callback (stable), and a boolean.
// Skips re-renders triggered by unrelated App state churn.
export const MobileNav = memo(function MobileNav({
    navigate,
    adminLoggedIn,
    logoutPlayer,
    character,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    character: Character;
    currentSector: number;
    screen: Screen;
}) {
    const [open, setOpen] = useState(false);
    const isAdminAccount = isProtectedAdminName(character.name);

    // Treat the slide-up menu as a modal dialog: lock the body scroll behind it
    // and close on Escape (mirrors the GameAlert pattern). Initial focus moves
    // to the close button via autoFocus below.
    useBodyScrollLock(open);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    const xpPct = character.level >= MAX_LEVEL
        ? 100
        : Math.min(100, Math.round((character.xp / xpNeeded(character.level)) * 100));

    function go(screen: Screen) {
        navigate(screen);
        setOpen(false);
    }

    return (
        <>
            {!open && (
                <MobileNotificationBar
                    navigate={navigate}
                    screen={screen}
                    clan={character.clan ?? ""}
                    village={character.village}
                />
            )}

            <nav className="mobile-bottom-nav">
                <button className="mobile-nav-btn" onClick={() => go("worldMap")}>
                    <span className="mnb-icon"><Map size={24} /></span>
                    Travel
                </button>
                <button className="mobile-nav-btn" onClick={() => go("tavern")}>
                    <span className="mnb-icon"><Wine size={24} /></span>
                    Tavern
                </button>
                <button className="mobile-nav-btn" onClick={() => go("profile")}>
                    <span className="mnb-icon"><User size={24} /></span>
                    Char
                </button>
                <button className="mobile-nav-btn" onClick={() => go("inventory")}>
                    <span className="mnb-icon"><Backpack size={24} /></span>
                    Items
                </button>
                <button className="mobile-nav-btn menu-btn" onClick={() => setOpen(true)}>
                    <span className="mnb-icon"><MenuIcon size={24} /></span>
                    Menu
                    <MailUnreadDot />
                </button>
            </nav>

            {open && (
                <div className="mobile-menu-overlay" role="dialog" aria-modal="true" aria-label="Shinobi menu">
                    <div className="mobile-menu-header">
                        <span className="mobile-menu-title">🥷 SHINOBI MENU</span>
                        <button className="mobile-menu-close" aria-label="Close menu" autoFocus onClick={() => setOpen(false)}>✕</button>
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
                        <button className="mobile-menu-btn" onClick={() => go("tavern")}><Wine size={18} />Tavern</button>
                        <button className="mobile-menu-btn" onClick={() => go("worldMap")}><Map size={18} />Travel</button>
                        <button className="mobile-menu-btn" onClick={() => go("userHub")}><Users size={18} />Users</button>
                        <button className="mobile-menu-btn" onClick={() => go("messages")}><Mail size={18} />Mail<MailUnreadBadge /></button>
                        <button className="mobile-menu-btn" onClick={() => go("missions")}><ClipboardList size={18} />Missions</button>
                        <button className="mobile-menu-btn" onClick={() => go("training")}><Dumbbell size={18} />Training</button>
                        <button className="mobile-menu-btn" onClick={() => go("profile")}><User size={18} />Character</button>
                        <button className="mobile-menu-btn" onClick={() => go("inventory")}><Backpack size={18} />Inventory</button>
                        <button className="mobile-menu-btn" onClick={() => go("jutsuTraining")}><Zap size={18} />Jutsu</button>
                        <button className="mobile-menu-btn" onClick={() => go("pets")}><PawPrint size={18} />Pets</button>
                        <button className="mobile-menu-btn" onClick={() => go("bloodlineMaker")}><Droplet size={18} />Bloodline</button>
                        <button className="mobile-menu-btn" onClick={() => go("professions")}>
                            <ScrollText size={18} />{character.profession ? PROFESSION_LABEL[character.profession] : "Professions"}
                        </button>
                        <button className="mobile-menu-btn" onClick={() => go("logbook")}><BookOpen size={18} />Logbook</button>
                        <button className="mobile-menu-btn" onClick={() => go("guides")}><Compass size={18} />Guides</button>
                        <button className="mobile-menu-btn" onClick={() => { window.open("https://discord.gg/bCQGs8r6SK", "_blank", "noopener,noreferrer"); setOpen(false); }}><MessageCircle size={18} />Discord</button>
                        <button className="mobile-menu-btn" onClick={() => { window.open("https://www.patreon.com/c/shinobijourney", "_blank", "noopener,noreferrer"); setOpen(false); }}><Heart size={18} />Patreon</button>
                        {isAdminAccount && (
                            <button className="mobile-menu-btn" onClick={() => go(adminLoggedIn ? "adminPanel" : "adminLogin")}><Wrench size={18} />Admin</button>
                        )}
                        <button className="mobile-menu-btn" onClick={() => { logoutPlayer(); setOpen(false); }}><LogOut size={18} />Logout + Save</button>
                    </div>
                </div>
            )}
        </>
    );
});
