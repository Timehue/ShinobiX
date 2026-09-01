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

import { memo, useEffect, useRef, useState } from "react";
import { levelProgress } from "../lib/character-progress";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import { isProtectedAdminName } from "../constants/game";
import { PROFESSION_LABEL } from "../data/professions";
import { preloadScreen } from "../lib/screen-preload";
import { useOwnAvatar } from "../lib/own-avatar";
import { MailUnreadBadge, MailUnreadDot } from "./MailUnreadBadge";
import { MobileNotificationBar } from "./MobileNotificationBar";
import { MobileProfileSheet } from "./MobileProfileSheet";
import { PLAYER_MENU_GROUPS } from "./player-menu-groups";
// Compact local game glyphs keep the navigation consistent with the HUD emblems
// without loading a second icon library.
import {
    GiChatBubble, GiExitDoor, GiGears, GiHamburgerMenu,
    GiHealthNormal, GiKnapsack, GiNinjaHeroicStance, GiOpenBook, GiPagoda, GiShop, GiTreasureMap,
} from "./icons/LightweightGameIcons";

// Memo'd — the bottom nav depends on immutable character snapshots, the
// (stable) navigate/logout callbacks, and the active-training timers that feed
// the "You" sheet. Skips re-renders triggered by unrelated App state churn.
export const MobileNav = memo(function MobileNav({
    navigate,
    adminLoggedIn,
    logoutPlayer,
    character,
    updateCharacter,
    currentSector,
    activeTraining,
    activeJutsuTraining,
    screen,
}: {
    navigate: (screen: Screen) => void;
    adminLoggedIn: boolean;
    logoutPlayer: () => void;
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    currentSector: number;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
    screen: Screen;
}) {
    const [open, setOpen] = useState(false);
    const [menuQuery, setMenuQuery] = useState("");
    // The "You" sheet — the desktop left-rail profile card, surfaced on mobile.
    const [youOpen, setYouOpen] = useState(false);
    const navLockUntilRef = useRef(0);
    const menuTriggerRef = useRef<HTMLButtonElement>(null);
    const menuDialogRef = useRef<HTMLDivElement>(null);
    const menuSearchRef = useRef<HTMLInputElement>(null);
    const isAdminAccount = isProtectedAdminName(character.name);

    // Treat the slide-up menu as a modal dialog: lock the body scroll behind it
    // and close on Escape (mirrors the GameAlert pattern). Initial focus moves
    // to the close button via autoFocus below.
    useBodyScrollLock(open);
    useEffect(() => {
        if (!open) return;
        const menuTrigger = menuTriggerRef.current;
        const focusFrame = window.requestAnimationFrame(() => menuSearchRef.current?.focus({ preventScroll: true }));
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
            if (e.key !== "Tab") return;
            const controls = [...(menuDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])') ?? [])];
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener("keydown", onKey);
            menuTrigger?.focus();
        };
    }, [open]);

    // Level progress = earned stat points toward the next level threshold
    // (XP is retired — leveling-without-xp map). levelProgress also reports an
    // exam hold, so the bar doesn't just sit silently full at 20/39.
    const levelBar = levelProgress(character);
    // Name-keyed shared image as the fallback, so the menu card doesn't drop to
    // initials before character.avatarImage hydrates (lib/own-avatar.ts).
    const avatarSrc = useOwnAvatar(character);
    const normalizedMenuQuery = menuQuery.trim().toLocaleLowerCase();
    const visibleMenuGroups = PLAYER_MENU_GROUPS
        .map((group) => ({
            ...group,
            items: group.items.filter(([target, label]) => {
                const professionLabel = target === "professions" && character.profession
                    ? PROFESSION_LABEL[character.profession]
                    : "";
                return !normalizedMenuQuery
                    || `${target} ${label} ${professionLabel}`.toLocaleLowerCase().includes(normalizedMenuQuery);
            }),
        }))
        .filter((group) => group.items.length > 0);
    function go(screen: Screen) {
        const now = Date.now();
        if (now < navLockUntilRef.current) return;
        navLockUntilRef.current = now + 300;
        navigate(screen);
        setOpen(false);
    }

    return (
        <>
            {!open && (
                <MobileNotificationBar
                    navigate={go}
                    screen={screen}
                    clan={character.clan ?? ""}
                    village={character.village}
                />
            )}

            <nav className="mobile-bottom-nav" aria-label="Primary game navigation">
                <button className="mobile-nav-btn" aria-expanded={youOpen} onClick={() => setYouOpen(true)}>
                    <span className="mnb-icon"><GiHealthNormal size={24} /></span>
                    You
                </button>
                <button className="mobile-nav-btn" aria-current={screen === "worldMap" ? "page" : undefined} onClick={() => go("worldMap")} onPointerDown={() => preloadScreen("worldMap")}>
                    <span className="mnb-icon"><GiTreasureMap size={24} /></span>
                    Travel
                </button>
                <button className="mobile-nav-btn" aria-current={screen === "village" ? "page" : undefined} onClick={() => go("village")} onPointerDown={() => preloadScreen("village", character.storyVillage || character.village)}>
                    <span className="mnb-icon"><GiPagoda size={24} /></span>
                    Village
                </button>
                <button className="mobile-nav-btn" aria-current={screen === "inventory" ? "page" : undefined} onClick={() => go("inventory")} onPointerDown={() => preloadScreen("inventory")}>
                    <span className="mnb-icon"><GiKnapsack size={24} /></span>
                    Items
                </button>
                <button ref={menuTriggerRef} className="mobile-nav-btn menu-btn" aria-expanded={open} aria-controls="mobile-shinobi-menu" onClick={() => { setMenuQuery(""); setOpen(true); }}>
                    <span className="mnb-icon"><GiHamburgerMenu size={24} /></span>
                    Menu
                    <MailUnreadDot />
                </button>
            </nav>

            <MobileProfileSheet
                open={youOpen}
                onClose={() => setYouOpen(false)}
                character={character}
                updateCharacter={updateCharacter}
                currentSector={currentSector}
                setScreen={go}
                activeTraining={activeTraining}
                activeJutsuTraining={activeJutsuTraining}
            />

            {open && (
                <div id="mobile-shinobi-menu" ref={menuDialogRef} className="mobile-menu-overlay" role="dialog" aria-modal="true" aria-label="Shinobi menu">
                    <div className="mobile-menu-header">
                        <span className="mobile-menu-title"><GiNinjaHeroicStance size={22} aria-hidden="true" /> SHINOBI MENU</span>
                        <button className="mobile-menu-close" aria-label="Close menu" onClick={() => setOpen(false)}>✕</button>
                    </div>

                    <div className="mobile-char-card">
                        <div className="mobile-char-avatar">
                            {avatarSrc
                                ? <img src={avatarSrc} alt={character.name} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                : character.name.slice(0, 2).toUpperCase()
                            }
                        </div>
                        <div className="mobile-char-info">
                            <div className="mobile-char-name">{character.name}</div>
                            <div className="mobile-char-sub">Lv {character.level} · {character.rankTitle} · {character.village}</div>
                            <div
                                className="mobile-xp-bar-track"
                                title={levelBar.heldBy
                                    ? `Held for the ${levelBar.heldBy} — ${levelBar.label}`
                                    : `${levelBar.label} toward Level ${character.level + 1}`}
                            >
                                <div className="mobile-xp-bar-fill" style={{ width: `${levelBar.percent}%` }} />
                            </div>
                        </div>
                    </div>

                    <label className="mobile-menu-search">
                        <span>Find a destination</span>
                        <input
                            ref={menuSearchRef}
                            type="search"
                            value={menuQuery}
                            onChange={(event) => setMenuQuery(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Training, missions, inventory…"
                        />
                    </label>

                    {/* onPointerDown warms each destination's lazy chunk on press,
                        before onClick's go()/navigate fires — see lib/screen-preload.
                        onClick is unchanged; the preload is best-effort + side-effect-free. */}
                    <div className="mobile-menu-groups">
                        {visibleMenuGroups.map((group) => (
                            <section className="mobile-menu-section" aria-labelledby={`mobile-menu-${group.id}`} key={group.id}>
                                <h2 id={`mobile-menu-${group.id}`}>{group.label}</h2>
                                <div className="mobile-menu-grid">
                                    {group.items.map(([target, label, Icon]) => (
                                        <button className="mobile-menu-btn" key={target} aria-current={screen === target ? "page" : undefined} onClick={() => go(target)} onPointerDown={() => preloadScreen(target, character.storyVillage || character.village)}>
                                            <Icon size={20} />{target === "professions" && character.profession ? PROFESSION_LABEL[character.profession] : label}{target === "messages" ? <MailUnreadBadge /> : null}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ))}
                        {normalizedMenuQuery && visibleMenuGroups.length === 0 ? (
                            <div className="mobile-menu-empty" role="status">
                                <strong>No destination found</strong>
                                <span>Try a screen name such as Training, Missions, or Inventory.</span>
                            </div>
                        ) : null}
                        {!normalizedMenuQuery ? (
                            <>
                                <section className="mobile-menu-section" aria-labelledby="mobile-menu-support">
                                    <h2 id="mobile-menu-support">Support</h2>
                                    <div className="mobile-menu-grid">
                                        <button className="mobile-menu-btn" aria-current={screen === "guides" ? "page" : undefined} onClick={() => go("guides")} onPointerDown={() => preloadScreen("guides")}><GiOpenBook size={20} />Guides</button>
                                        <button className="mobile-menu-btn" onClick={() => { window.open("https://discord.gg/bCQGs8r6SK", "_blank", "noopener,noreferrer"); setOpen(false); }}><GiChatBubble size={20} />Discord</button>
                                        <button className="mobile-menu-btn" aria-current={screen === "shop" ? "page" : undefined} onClick={() => go("shop")} onPointerDown={() => preloadScreen("shop")}><GiShop size={20} />Shop</button>
                                    </div>
                                </section>
                                <section className="mobile-menu-section" aria-labelledby="mobile-menu-system">
                                    <h2 id="mobile-menu-system">System</h2>
                                    <div className="mobile-menu-grid">
                                        {isAdminAccount && <button className="mobile-menu-btn" onClick={() => go(adminLoggedIn ? "adminPanel" : "adminLogin")} onPointerDown={() => preloadScreen(adminLoggedIn ? "adminPanel" : "adminLogin")}><GiGears size={20} />Admin</button>}
                                        <button className="mobile-menu-btn danger" onClick={() => { logoutPlayer(); setOpen(false); }}><GiExitDoor size={20} />Logout</button>
                                    </div>
                                </section>
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </>
    );
});
