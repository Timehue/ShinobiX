import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { type Character, type LbTab } from "../App";
import { villages } from "../data/sectors";
// Fantasy chrome glyphs (game-icons.net, CC BY 3.0 — attributed in the About guide).
import { GiRank3, GiDaggers, GiUpgrade, GiBlackFlag, GiPawPrint, GiVortex, GiCrossedSwords, GiTrophy, GiVillage } from "react-icons/gi";
const SS_ICON = { verticalAlign: "-0.12em", marginRight: "0.3rem" } as const;
import {
    CharacterCreator,
    IconUser,
    IconLock,
    IconEyeOpen,
    IconEyeOff,
} from "./CharacterCreator";
import { lazyWithRetry } from "../lib/lazyWithRetry";

// Feature-showcase art — real in-game scenes, so the landing sells the actual
// game rather than stock art. Bundled from src/assets (Vite-hashed); the two
// full-bleed cinematics (hero + clash band) live in public/ and are referenced
// by URL from landing-skin.css.
import worldMapImg from "../assets/Maps/world_map.webp";
import villageImg from "../assets/sectors/stormveil-village.webp";
import coliseumImg from "../assets/coliseum/coliseum-bg.webp";

const GuidesLibrary = lazyWithRetry(() => import("../components/GuidesLibrary").then(m => ({ default: m.GuidesLibrary })));

// The real community invite, matching RightMenu / MobileNav. The old
// "discord.gg/shinobi-journey" vanity link did not resolve.
const DISCORD_URL = "https://discord.gg/bCQGs8r6SK";

type StartView = "main" | "create" | "login" | "leaderboard" | "guides";

type RosterEntry = {
    name: string;
    level: number;
    village: string;
    specialty: string;
    online: boolean;
    character?: Partial<Character>;
};

type PublicTournament = {
    id?: string;
    name?: string;
    createdBy?: string;
    startsAt?: number;
    endsAt?: number;
    participants?: string[];
    advancedPlayers?: string[];
} | null;

// ── Landing feature showcase ─────────────────────────────────────────────
type LiveStats = { online: number };

// public/ scenes referenced by URL (Vite copies public/ to the site root).
const PVP_IMG = "/deathsgate-arena.webp";
const PET_IMG = "/landing-petclash.webp";
const CLAN_IMG = "/landing-clanwar.webp";
const LEGACY_IMG = "/landing-legacy.webp";

type Feature = { tag: string; title: string; blurb: string; img: string };

const FEATURES: Feature[] = [
    {
        tag: "World", title: "Enter the Hidden Villages",
        blurb: "Begin in one of four rival villages, then push beyond the gates into sectors, encounters, and story paths drawn from the live game world.",
        img: worldMapImg,
    },
    {
        tag: "Combat", title: "Fight With Jutsu and Tactics",
        blurb: "Build a shinobi around stats, elements, bloodlines, gear, and jutsu choices, then test that style in battles across the game.",
        img: PVP_IMG,
    },
    {
        tag: "Progression", title: "Train Your Power",
        blurb: "Train stats, improve jutsu, take missions, and grow from a new recruit into a stronger shinobi over time.",
        img: villageImg,
    },
    {
        tag: "Companions", title: "Raise Companions",
        blurb: "Pets, expeditions, and pet battles are part of the wider journey for players who want a companion-focused path.",
        img: PET_IMG,
    },
    {
        tag: "Clans", title: "Build With Others",
        blurb: "Join or form a clan, contribute to shared goals, and take part in clan systems that reward coordination.",
        img: CLAN_IMG,
    },
    {
        tag: "Legacy", title: "Leave Your Mark",
        blurb: "Leaderboards, guides, story paths, and late-game goals give long-term players places to keep growing.",
        img: coliseumImg,
    },
];

const CLAN_POINTS = [
    "Contribute resources and progress toward shared clan goals.",
    "Coordinate with members through clan systems and challenges.",
    "Choose how you help: combat, pets, cards, missions, and support all have room to matter.",
];

const LEGACY_POINTS = [
    "Chase records in the Hall of Legends.",
    "Follow story and progression paths at your own pace.",
    "Shape a character identity that reflects how you play.",
];

const GUIDE_SPOTLIGHTS = [
    {
        title: "First Steps",
        blurb: "Learn how villages, bloodlines, training, and missions fit together before you name your shinobi.",
    },
    {
        title: "Battle Basics",
        blurb: "Read up on jutsu choices, stats, and PvP flow so your first fights make more sense.",
    },
    {
        title: "Clans and Companions",
        blurb: "See how clan goals, pets, cards, and long-term systems connect as your account grows.",
    },
];

const PATH_HIGHLIGHTS: { label: string; icon: ReactNode }[] = [
    { label: `${villages.length} rival villages`, icon: <GiVillage /> },
    { label: "jutsu combat", icon: <GiCrossedSwords /> },
    { label: "long-term progression", icon: <GiVortex /> },
    { label: "public leaderboards", icon: <GiTrophy /> },
];

type BrandLockupVariant = "nav" | "hero" | "footer";

function BrandLockup({ variant = "nav" }: { variant?: BrandLockupVariant }) {
    const src = variant === "hero" ? "/shinobi-journey-title-art.webp" : "/shinobi-journey-logo-wide.webp";
    return (
        <span className={`landing-logo landing-logo--${variant}`}>
            <span className="landing-logo-readable">Shinobi Journey</span>
            <img className="landing-logo-art" src={src} alt="" aria-hidden="true" draggable={false} />
        </span>
    );
}

// StartScreen is now a thin router: the cinematic landing is the default view,
// with the Hall of Legends and Guides library reachable from the top nav /
// footer (each renders full-screen with its own Back button).
export function StartScreen({ onCreate, onLogin, onAdmin, initialName = "", notice = "" }: {
    onCreate: (character: Character, password: string) => void | Promise<void>;
    onLogin: (name: string, password: string) => void | Promise<void>;
    onAdmin: (prefilledPassword?: string) => void;
    // Pre-filled login name + notice, set by App when a session restore failed
    // on refresh (expired token / unreachable server) so the player lands on a
    // pre-filled login with an explanation instead of a blank, silent form.
    initialName?: string;
    notice?: string;
}) {
    const [view, setView] = useState<StartView>(initialName || notice ? "login" : "main");

    if (view === "leaderboard") {
        return (
            <div className="start-screen landing-subscreen">
                <PublicLeaderboard onBack={() => setView("main")} />
            </div>
        );
    }

    if (view === "guides") {
        return (
            <div className="start-screen landing-subscreen">
                <Suspense fallback={<div className="guides-root"><p className="guides-intro">Loading guides...</p></div>}>
                    <GuidesLibrary onExit={() => setView("main")} />
                </Suspense>
            </div>
        );
    }

    if (view === "create") {
        return <CharacterCreator onCreate={onCreate} onBack={() => setView("main")} />;
    }

    if (view === "login") {
        return (
            <div className="start-screen landing-subscreen landing-login-screen">
                <button type="button" className="start-back-button" onClick={() => setView("main")}>Back</button>
                <LoginPanel
                    onLogin={onLogin}
                    onAdmin={onAdmin}
                    initialName={initialName}
                    notice={notice}
                    onCreateAccount={() => setView("create")}
                />
            </div>
        );
    }

    return (
        <LandingMain
            onOpenCreate={() => setView("create")}
            onOpenLogin={() => setView("login")}
            onOpenGuides={() => setView("guides")}
            onOpenLeaderboard={() => setView("leaderboard")}
        />
    );
}

// Tabbed Create-Account / Log-In panel docked in the hero. The admin-routing +
// login submit logic is a verbatim move from the old StartScreen — behavior
// (Admin 2 auto-route, token-first login via onLogin) is preserved exactly.
function LoginPanel({ onLogin, onAdmin, initialName, notice, onCreateAccount }: {
    onLogin: (name: string, password: string) => void | Promise<void>;
    onAdmin: (prefilledPassword?: string) => void;
    initialName: string;
    notice: string;
    onCreateAccount: () => void;
}) {
    const [loginName, setLoginName] = useState(initialName);
    const [loginPassword, setLoginPassword] = useState("");
    const [showLoginPw, setShowLoginPw] = useState(false);
    const [loginStatus, setLoginStatus] = useState("");

    // Only "Admin 2" / "admin2" auto-routes to the admin login from the player
    // form. Admin 1 is intentionally NOT detected here (see the retired
    // StartScreen comment / docs) — it flows through logging in as Rill then the
    // in-game Admin button, gating Admin 1 behind both passwords.
    function normalizeAdminName(raw: string): "admin2" | null {
        const n = raw.trim().toLowerCase().replace(/\s+/g, "");
        if (n === "admin2") return "admin2";
        return null;
    }

    async function submitLogin() {
        if (loginName.trim().length < 2) return alert("Enter your player name.");
        if (!loginPassword) return alert("Enter your password.");

        if (normalizeAdminName(loginName)) {
            onAdmin(loginPassword);
            return;
        }

        setLoginStatus("Loading...");
        try {
            await onLogin(loginName.trim(), loginPassword);
        } finally {
            setLoginStatus("");
        }
    }

    return (
        <div className="landing-auth-card landing-login-card start-card">
            <div className="landing-login-head">
                <p className="landing-kicker">Returning Shinobi</p>
                <h2 className="start-card-title">Log In</h2>
                <p className="start-hint landing-login-subtitle">Restore your save and continue from your village.</p>
            </div>

            {notice && <p className="start-hint landing-auth-notice">{notice}</p>}

            <div className="landing-auth-body">
                <label className="start-field">
                    <span className="start-field-label">
                        <span className="start-field-icon"><IconUser /></span>
                        Name
                    </span>
                    <input
                        className="start-input"
                        value={loginName}
                        onChange={(e) => setLoginName(e.target.value)}
                        placeholder="Enter existing shinobi name"
                        autoComplete="username"
                    />
                </label>

                <label className="start-field">
                    <span className="start-field-label">
                        <span className="start-field-icon"><IconLock /></span>
                        Password
                    </span>
                    <span className="start-input-wrap">
                        <input
                            className="start-input has-toggle"
                            type={showLoginPw ? "text" : "password"}
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                        />
                        <button
                            type="button"
                            className="start-eye-btn"
                            onClick={() => setShowLoginPw(s => !s)}
                            aria-label={showLoginPw ? "Hide password" : "Show password"}
                        >
                            {showLoginPw ? <IconEyeOff /> : <IconEyeOpen />}
                        </button>
                    </span>
                </label>

                <button
                    className="start-primary-btn"
                    onClick={submitLogin}
                    disabled={!!loginStatus}
                >
                    {loginStatus || "Log Back In"}
                </button>

                <p className="start-hint">
                    Logging in automatically restores your full save including images.
                </p>

                <button type="button" className="landing-auth-secondary" onClick={onCreateAccount}>
                    Create a New Shinobi
                </button>
            </div>
        </div>
    );
}

function FeatureCard({ feature }: { feature: Feature }) {
    return (
        <article className="landing-feature-card">
            <div className="landing-feature-media">
                <img src={feature.img} alt={feature.title} decoding="async" />
                <span className="landing-feature-tag">{feature.tag}</span>
            </div>
            <div className="landing-feature-text">
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-blurb">{feature.blurb}</p>
            </div>
        </article>
    );
}

function LandingMain({ onOpenCreate, onOpenLogin, onOpenGuides, onOpenLeaderboard }: {
    onOpenCreate: () => void;
    onOpenLogin: () => void;
    onOpenGuides: () => void;
    onOpenLeaderboard: () => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const featuresRef = useRef<HTMLElement>(null);
    const [stats, setStats] = useState<LiveStats | null>(null);
    // A session-restore failure pre-fills the login name → open on Log In;
    // a fresh visitor lands on Create Account. Lifted here so the hero / band
    // CTAs can jump straight into the create flow.
    const year = new Date().getFullYear();

    // Live roster snapshot for the "online now" chip. Best-effort: if it fails
    // or the world is empty we simply omit the live chip — never fabricate a
    // number. Same public endpoint the Hall of Legends already uses.
    useEffect(() => {
        let cancelled = false;
        fetch("/api/player/roster")
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { players?: RosterEntry[] } | null) => {
                if (cancelled || !data) return;
                const players = Array.isArray(data.players) ? data.players : [];
                setStats({ online: players.filter((p) => p.online).length });
            })
            .catch(() => { /* offline / cold server — omit the live chip */ });
        return () => { cancelled = true; };
    }, []);

    // Hide the mobile sticky CTA whenever the auth panel is itself on screen, so
    // the bar never covers the create/login form's own submit button.
    const scrollToFeatures = () => featuresRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const scrollTop = () => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Hero / band CTAs → switch to the Create tab, bring the panel into view,
    // then focus the name field (without a second scroll jump).
    return (
        <div className="landing-root" ref={rootRef}>
            <header className="landing-topbar">
                <div className="landing-topbar-inner">
                    <button type="button" className="landing-brand" onClick={scrollTop}>
                        <BrandLockup variant="nav" />
                    </button>
                    <nav className="landing-topnav">
                        <a className="landing-navlink" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>
                        <button type="button" className="landing-navlink" onClick={onOpenGuides}>Guides</button>
                        <button type="button" className="landing-navlink" onClick={onOpenLeaderboard}>Leaderboard</button>
                        <button type="button" className="landing-navlink" onClick={onOpenLogin}>Log In</button>
                        <button type="button" className="landing-navlink landing-navlink--cta" onClick={onOpenCreate}>Play Now</button>
                    </nav>
                </div>
            </header>

            <section className="landing-hero">
                <div className="landing-hero-inner">
                    <div className="landing-hero-copy">
                        <p className="landing-eyebrow">Browser-based shinobi RPG</p>
                        <h1 className="landing-title">
                            <BrandLockup variant="hero" />
                        </h1>
                        <p className="landing-tagline">
                            Create your shinobi, train your power, and step into a world of
                            rival villages, hidden paths, and hard-earned legend.
                        </p>

                        <div className="landing-stat-chips">
                            {stats && stats.online > 0 && (
                                <span className="landing-stat-chip landing-stat-chip--live">
                                    <i className="landing-live-dot" aria-hidden="true" />
                                    {stats.online.toLocaleString()} online now
                                </span>
                            )}
                            <span className="landing-stat-chip">{villages.length} Rival Villages</span>
                            <span className="landing-stat-chip">Jutsu Combat</span>
                            <span className="landing-stat-chip">Browser Play</span>
                        </div>

                        <div className="landing-hero-actions">
                            <button type="button" className="landing-cta landing-cta--primary" onClick={onOpenCreate}>
                                Enter the World
                            </button>
                            <a className="landing-cta landing-cta--ghost" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                                Join the Discord
                            </a>
                        </div>

                        <p className="landing-cta-note">Free to start · Plays in your browser · No download</p>
                    </div>
                </div>

                <button type="button" className="landing-scroll-cue" onClick={scrollToFeatures} aria-label="Scroll to features">
                    <span>Discover the world</span>
                    <span className="landing-scroll-arrow" aria-hidden="true">▾</span>
                </button>
            </section>

            <section className="landing-features" ref={featuresRef}>
                <div className="landing-section-head">
                    <p className="landing-kicker">✦ The World Awaits ✦</p>
                    <h2 className="landing-section-title">A world built for growth</h2>
                    <p className="landing-section-sub">
                        A browser RPG built around character growth, tactical battles,
                        exploration, and long-term progression.
                    </p>
                </div>
                <div className="landing-feature-grid">
                    {FEATURES.map((f) => <FeatureCard key={f.title} feature={f} />)}
                </div>
            </section>

            <section className="landing-band" aria-labelledby="landing-band-title">
                <div className="landing-band-inner">
                    <p className="landing-kicker">✦ Choose Your Path ✦</p>
                    <h2 id="landing-band-title" className="landing-band-title">Train, fight, explore, endure</h2>
                    <p className="landing-band-sub">
                        Grow from a new recruit into the shinobi you want to become,
                        with room for combat, clans, companions, and story paths.
                    </p>
                    <div className="landing-band-actions">
                        <button type="button" className="landing-cta landing-cta--primary" onClick={onOpenGuides}>
                            Open the Guides
                        </button>
                        <button type="button" className="landing-cta landing-cta--ghost" onClick={onOpenLeaderboard}>
                            See the Legends
                        </button>
                    </div>
                </div>
                <ul className="landing-band-feats" aria-label="Shinobi Journey paths">
                    {PATH_HIGHLIGHTS.map((item) => (
                        <li key={item.label}>
                            {item.icon}
                            <span>{item.label}</span>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="landing-clan">
                <div className="landing-clan-inner">
                    <div className="landing-clan-media">
                        <img src={CLAN_IMG} alt="Rival shinobi clans muster for war beneath their banners" decoding="async" />
                    </div>
                    <div className="landing-clan-copy">
                        <p className="landing-kicker">✦ Stronger Together ✦</p>
                        <h2 className="landing-section-title landing-clan-title">Find Your Place</h2>
                        <p className="landing-clan-lead">
                            Join or form a clan, contribute to shared goals, and take part in
                            cooperative systems built around progression, rivalry, and teamwork.
                        </p>
                        <ul className="landing-clan-points">
                            {CLAN_POINTS.map((pt) => <li key={pt}>{pt}</li>)}
                        </ul>
                    </div>
                </div>
            </section>

            <section className="landing-clan landing-clan--reverse">
                <div className="landing-clan-inner">
                    <div className="landing-clan-media">
                        <img src={LEGACY_IMG} alt="An ancient path of torii gates leading toward legend" decoding="async" />
                    </div>
                    <div className="landing-clan-copy">
                        <p className="landing-kicker">✦ Your Legend Awaits ✦</p>
                        <h2 className="landing-section-title landing-clan-title">Forge a Legacy</h2>
                        <p className="landing-clan-lead">
                            As your shinobi grows, long-term goals open across rankings,
                            records, story paths, and late-game challenges.
                        </p>
                        <ul className="landing-clan-points">
                            {LEGACY_POINTS.map((pt) => <li key={pt}>{pt}</li>)}
                        </ul>
                    </div>
                </div>
            </section>

            <section className="landing-begin">
                <div className="landing-begin-inner">
                    <p className="landing-kicker">✦ Your Journey Awaits ✦</p>
                    <h2 className="landing-section-title">Begin Your Shinobi Journey</h2>
                    <p className="landing-begin-sub">Create your shinobi, choose a village, and grow into the role you want to play.</p>
                    <ol className="landing-steps">
                        <li>
                            <span className="landing-step-num">01</span>
                            <h3 className="landing-step-title">Create Your Shinobi</h3>
                            <p className="landing-step-desc">Choose a village, name your shinobi, and pick a starting bloodline.</p>
                        </li>
                        <li>
                            <span className="landing-step-num">02</span>
                            <h3 className="landing-step-title">Train Your Power</h3>
                            <p className="landing-step-desc">Build stats, unlock jutsu, and take missions that grow your character over time.</p>
                        </li>
                        <li>
                            <span className="landing-step-num">03</span>
                            <h3 className="landing-step-title">Choose Your Path</h3>
                            <p className="landing-step-desc">Explore battles, clans, pets, guides, and long-term goals as your journey opens up.</p>
                        </li>
                    </ol>
                    <div className="landing-guide-spotlight" aria-labelledby="landing-guide-title">
                        <div className="landing-guide-head">
                            <p className="landing-kicker">✦ Guide Spotlight ✦</p>
                            <h3 id="landing-guide-title" className="landing-guide-title">Know the world before you enter it</h3>
                            <p className="landing-guide-sub">
                                The guide library is already built into the game, so this space points new players
                                toward useful explanations instead of repeating another create button.
                            </p>
                        </div>
                        <div className="landing-guide-grid">
                            {GUIDE_SPOTLIGHTS.map((guide) => (
                                <article className="landing-guide-card" key={guide.title}>
                                    <h4>{guide.title}</h4>
                                    <p>{guide.blurb}</p>
                                </article>
                            ))}
                        </div>
                        <button type="button" className="landing-cta landing-cta--primary landing-guide-cta" onClick={onOpenGuides}>
                            Open Guide Library
                        </button>
                    </div>
                </div>
            </section>

            <footer className="landing-footer">
                <div className="landing-footer-inner">
                    <div className="landing-footer-brand">
                        <span className="landing-brand landing-brand--footer">
                            <BrandLockup variant="footer" />
                        </span>
                        <p className="landing-footer-tag">A browser-based shinobi RPG. Begin your journey for free.</p>
                    </div>
                    <nav className="landing-footer-links">
                        <button type="button" onClick={onOpenCreate}>Start Playing</button>
                        <button type="button" onClick={onOpenGuides}>Guides</button>
                        <button type="button" onClick={onOpenLeaderboard}>Leaderboard</button>
                        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>
                    </nav>
                </div>
                <p className="landing-footer-legal">© {year} Shinobi Journey. Forge your legend.</p>
            </footer>

            <div className="landing-mobile-cta">
                <button type="button" className="landing-cta landing-cta--primary" onClick={onOpenCreate}>
                    Play Free Now
                </button>
            </div>
        </div>
    );
}

function PublicLeaderboard({ onBack }: { onBack: () => void }) {
    const [tab, setTab] = useState<LbTab>("ranked");
    const [players, setPlayers] = useState<RosterEntry[]>([]);
    const [tournament, setTournament] = useState<PublicTournament>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError("");
            try {
                const [rosterRes, gameStateRes] = await Promise.all([
                    fetch("/api/player/roster"),
                    fetch("/api/game-state").catch(() => null),
                ]);
                if (!rosterRes.ok) throw new Error(`Roster HTTP ${rosterRes.status}`);
                const rosterData = await rosterRes.json() as { players?: RosterEntry[] };
                if (!cancelled) setPlayers(Array.isArray(rosterData.players) ? rosterData.players : []);

                if (gameStateRes && gameStateRes.ok) {
                    const gs = await gameStateRes.json() as { arenaTournament?: PublicTournament };
                    if (!cancelled) setTournament(gs.arenaTournament ?? null);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load leaderboard");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const tabs: { id: LbTab; label: string; icon: ReactNode }[] = [
        { id: "ranked",      label: "Ranked",       icon: <GiRank3 /> },
        { id: "kills",       label: "Kill Streaks", icon: <GiDaggers /> },
        { id: "xp",          label: "Most XP",      icon: <GiUpgrade /> },
        { id: "clans",       label: "Top Clans",    icon: <GiBlackFlag /> },
        { id: "pets",        label: "Pet Wins",     icon: <GiPawPrint /> },
        { id: "endless",     label: "Endless",      icon: <GiVortex /> },
        { id: "villageWars", label: "Village Wars", icon: <GiCrossedSwords /> },
        { id: "tournament",  label: "Tournament",   icon: <GiTrophy /> },
    ];

    function getValue(p: RosterEntry, t: LbTab): number {
        const c = p.character ?? {};
        switch (t) {
            case "ranked": return Number(c.rankedRating ?? 1000);
            case "kills": return Number(c.totalPvpKills ?? 0);
            case "xp": return Number(c.xp ?? 0);
            case "pets": return Number(c.totalPetWins ?? 0);
            case "endless": return Number(c.totalEndlessTowerWins ?? 0);
            case "villageWars": return Number(c.totalVillageRaids ?? 0);
            case "professions": return Number(c.professionXp ?? 0);
            case "weeklyBoss":
            case "clans":
            case "tournament":
            case "bounties":
            case "gauntlet":
            case "legends":
            case "news":
            case "eras":
                return 0;
        }
    }

    function getSuffix(t: LbTab): string {
        switch (t) {
            case "ranked": return " Elo";
            case "kills": return " kills";
            case "xp": return " XP";
            case "pets": return " wins";
            case "endless": return " waves";
            case "villageWars": return " raids";
            case "weeklyBoss": return " dmg";
            case "professions": return " XP";
            case "clans":
            case "tournament":
            case "bounties":
            case "gauntlet":
            case "legends":
            case "news":
            case "eras":
                return "";
        }
    }

    function getLabel(t: LbTab): string {
        switch (t) {
            case "ranked": return "Ranked Battle Rating (Elo)";
            case "kills": return "Total PvP Kills";
            case "xp": return "Total XP Earned";
            case "pets": return "Pet Coliseum Wins";
            case "endless": return "Endless Tower — Waves Survived";
            case "villageWars": return "Village War Raids Completed";
            case "weeklyBoss": return "Weekly Boss — Top Damage";
            case "clans": return "Clan Power (Ranked Wins + PvP Kills)";
            case "tournament": return "Last Tournament";
            case "professions": return "Top Profession XP (all professions)";
            case "bounties": return "Active Bounties";
            case "gauntlet": return "Weekly Pet Gauntlet";
            case "legends": return "Hall of Legends";
            case "news": return "World News";
            case "eras": return "World Eras";
        }
    }

    const playersWithChar = players.filter(p => p.character);

    // Player leaderboards (per-stat sort, top 25)
    const rankedPlayers = (tab === "clans" || tab === "tournament")
        ? []
        : [...playersWithChar]
            .sort((a, b) => getValue(b, tab) - getValue(a, tab))
            .slice(0, 25);

    // Clan aggregation — matches HallOfLegends logic
    const clanMap = new Map<string, { score: number; members: number; topVillage: string }>();
    for (const p of playersWithChar) {
        const c = p.character ?? {};
        if (!c.clan) continue;
        const existing = clanMap.get(c.clan) ?? { score: 0, members: 0, topVillage: p.village };
        clanMap.set(c.clan, {
            score: existing.score + Number(c.rankedWins ?? 0) + Number(c.totalPvpKills ?? 0),
            members: existing.members + 1,
            topVillage: existing.topVillage,
        });
    }
    const topClans = [...clanMap.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 25);

    return (
        <div className="card start-leaderboard">
            <div className="start-back-row">
                <button className="start-back-button" onClick={onBack}>← Back</button>
            </div>

            <div className="start-leaderboard-header">
                <div style={{ flex: 1 }}>
                    <h2><GiTrophy style={SS_ICON} />Hall of Legends</h2>
                    <p className="start-leaderboard-subtitle">Eternal records of the world's greatest shinobi.</p>
                </div>
            </div>

            <div className="start-leaderboard-tabs">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        className={`start-leaderboard-tab ${tab === t.id ? "is-active" : ""}`}
                        onClick={() => setTab(t.id)}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            <div className="start-leaderboard-board">
                <p className="start-leaderboard-board-label">{getLabel(tab)}</p>

                {loading && <p className="start-leaderboard-empty">Summoning legends...</p>}
                {!loading && error && (
                    <p className="start-leaderboard-empty">Could not load leaderboard ({error}).</p>
                )}

                {!loading && !error && tab !== "clans" && tab !== "tournament" && (
                    rankedPlayers.length === 0
                        ? <p className="start-leaderboard-empty">No shinobi have recorded glory yet.</p>
                        : rankedPlayers.map((p, i) => {
                            const v = getValue(p, tab);
                            const rankCls = i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : "";
                            const medal = i < 3 ? ["🥇","🥈","🥉"][i] : `#${i + 1}`;
                            return (
                                <div key={p.name} className={`start-leaderboard-row ${rankCls}`}>
                                    <span className="start-leaderboard-rank">{medal}</span>
                                    <span className="start-leaderboard-name">
                                        {p.name}
                                        {p.village ? <span className="start-leaderboard-village"> · {p.village}</span> : null}
                                    </span>
                                    <span className="start-leaderboard-value">{v.toLocaleString()}{getSuffix(tab)}</span>
                                </div>
                            );
                        })
                )}

                {!loading && !error && tab === "clans" && (
                    topClans.length === 0
                        ? <p className="start-leaderboard-empty">No clan data available yet.</p>
                        : topClans.map(([clan, data], i) => {
                            const rankCls = i === 0 ? "top-1" : i === 1 ? "top-2" : i === 2 ? "top-3" : "";
                            const medal = i < 3 ? ["🥇","🥈","🥉"][i] : `#${i + 1}`;
                            return (
                                <div key={clan} className={`start-leaderboard-row ${rankCls}`}>
                                    <span className="start-leaderboard-rank">{medal}</span>
                                    <span className="start-leaderboard-name">
                                        {clan}
                                        <span className="start-leaderboard-village"> · {data.members} member{data.members !== 1 ? "s" : ""}</span>
                                    </span>
                                    <span className="start-leaderboard-value">{data.score.toLocaleString()} pts</span>
                                </div>
                            );
                        })
                )}

                {!loading && !error && tab === "tournament" && (
                    !tournament
                        ? <p className="start-leaderboard-empty">No tournament has been held yet.</p>
                        : (
                            <div className="start-tournament-card">
                                <h3>{tournament.name ?? "Arena Tournament"}</h3>
                                {tournament.createdBy && <p><strong>Hosted by:</strong> {tournament.createdBy}</p>}
                                <p>
                                    <strong>Participants ({tournament.participants?.length ?? 0}):</strong>{" "}
                                    {(tournament.participants ?? []).join(", ") || "—"}
                                </p>
                                {tournament.advancedPlayers && tournament.advancedPlayers.length > 0 && (
                                    <p><strong>Advanced Players:</strong> {tournament.advancedPlayers.join(", ")}</p>
                                )}
                                {tournament.endsAt && (
                                    <p className="start-tournament-ended">
                                        Ended {new Date(tournament.endsAt).toLocaleDateString()}
                                    </p>
                                )}
                            </div>
                        )
                )}
            </div>
        </div>
    );
}
