import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { type Character } from "../App";
import { villages } from "../data/sectors";
import { GameIcon } from "../components/icons/GameIcon";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { LEGAL_PAGE_LINKS, legalPageForPath, type LegalPageSlug } from "../data/legal";
import { LegalPage } from "./LegalPage";
import { LoginGate } from "./start/LoginGate";
import { rememberedShinobi } from "../lib/player-accounts";
import { captureProductEvent } from "../lib/analytics";
import type { SignupCredential } from "../lib/guest-play";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
} from "../lib/live-capabilities-context";
import {
    capabilityAdmissionAllowed,
    playerLoginAdmissionMessage,
    registrationAdmissionMessage,
} from "../lib/live-capability-admission";

const PRODUCT_ANALYTICS_ENABLED = import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED === "1";

const CharacterCreator = lazyWithRetry(() => import("./CharacterCreator").then(m => ({ default: m.CharacterCreator })));
const PublicLeaderboard = lazyWithRetry(() => import("./PublicLeaderboard").then(m => ({ default: m.PublicLeaderboard })));

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

type StartView = "main" | "create" | "login" | "leaderboard" | "guides" | `legal:${LegalPageSlug}`;

// ── Landing feature showcase ─────────────────────────────────────────────

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
        tag: "Progression", title: "Master the Shinobi Arts",
        blurb: "Train your attributes, master new jutsu, and rise from academy recruit to legendary shinobi.",
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
    { label: `${villages.length} rival villages`, icon: <GameIcon name="map" /> },
    { label: "jutsu combat", icon: <GameIcon name="sword" /> },
    { label: "long-term progression", icon: <GameIcon name="chakra" /> },
    { label: "public leaderboards", icon: <GameIcon name="medal" /> },
];

type BrandLockupVariant = "nav" | "hero" | "footer";

// The wordmark is artwork, but the app's NAME has to be readable as text, not
// only painted into a WebP. Google's OAuth brand verification rejected the app
// for exactly this: it compares the consent-screen app name against the name it
// can find on the home page, and a 1px-clipped span behind an aria-hidden image
// gave it nothing to match. The alt text carries the name now — which is also
// what a screen reader should have been getting all along.
export const APP_NAME = "Shinobi Journey";

function BrandLockup({ variant = "nav" }: { variant?: BrandLockupVariant }) {
    const src = variant === "hero" ? "/shinobi-journey-title-art.webp" : "/shinobi-journey-logo-wide.webp";
    return (
        <span className={`landing-logo landing-logo--${variant}`}>
            <img className="landing-logo-art" src={src} alt={APP_NAME} draggable={false} />
        </span>
    );
}

// StartScreen is now a thin router: the cinematic landing is the default view,
// with the Hall of Legends and Guides library reachable from the top nav /
// footer (each renders full-screen with its own Back button).
export function StartScreen({ onCreate, onLogin, onAdmin, onContinueAs, initialName = "", notice = "", googleSignup = null }: {
    onCreate: (character: Character, credential: SignupCredential) => void | Promise<void>;
    onLogin: (name: string, password: string) => void | Promise<void>;
    onAdmin: (prefilledPassword?: string) => void;
    /** Resume a shinobi this browser still holds a token for. */
    onContinueAs: (name: string) => void | Promise<void>;
    /** Set when a Google sign-in resolved to somebody with no shinobi yet. */
    googleSignup?: { suggestedName: string; signupTicket: string; nonce: string } | null;
    // Pre-filled login name + notice, set by App when a session restore failed
    // on refresh (expired token / unreachable server) so the player lands on a
    // pre-filled login with an explanation instead of a blank, silent form.
    initialName?: string;
    notice?: string;
}) {
    const playerLoginAvailability = useCapabilityViewAvailability();
    const registrationsAvailability = useCapabilityMutationAvailability("registrations");
    const playerLoginOpen = capabilityAdmissionAllowed(playerLoginAvailability);
    const registrationOpen = capabilityAdmissionAllowed(registrationsAvailability);
    const playerLoginMessage = playerLoginAdmissionMessage(playerLoginAvailability);
    const registrationMessage = playerLoginOpen
        ? registrationAdmissionMessage(registrationsAvailability)
        : playerLoginMessage;
    // Set by each door that opens the creator, and checked by the "create" view.
    // Seeded true for a Google signup because that door has no click here to gate:
    // the player is landing back from a completed OAuth round-trip, and refusing
    // them at a card — especially on a capability read that is merely still
    // "unknown" at boot — would strand an account mid-creation. Registrations are
    // still authoritatively gated where it counts, in App.createPlayerAccount,
    // which refuses the POST itself.
    const [creatorAdmissionGranted, setCreatorAdmissionGranted] = useState(() => Boolean(googleSignup));
    const [view, setView] = useState<StartView>(() => {
        const legalPage = typeof window === "undefined" ? null : legalPageForPath(window.location.pathname);
        if (legalPage) return `legal:${legalPage}`;
        // A Google sign-in with no shinobi behind it lands straight in the
        // creator — they have already committed, so asking them to find the
        // button again would be the one avoidable step in the whole flow.
        if (googleSignup) return "create";
        return initialName || notice ? "login" : "main";
    });
    // Which credential a new character will be claimed with. Google is decided
    // before the creator opens; guest is chosen from the gate.
    const [signupMode, setSignupMode] = useState<"password" | "guest">("password");
    // Does this browser hold a shinobi to come back to? Decides whether the gate
    // greets a returning player or a newcomer. Read once, same source the gate
    // itself uses, so the two halves cannot disagree.
    const [knowsSomeone] = useState(() => Boolean(initialName) || rememberedShinobi().length > 0);

    useEffect(() => {
        if (PRODUCT_ANALYTICS_ENABLED && view === "main") captureProductEvent("landing_viewed", { screenId: "landing", source: "navigation" });
    }, [view]);

    // The password signup door. Gated on the registrations capability so the
    // creator is never opened into a dead end: without this a player fills the
    // whole form and only learns registrations are paused when App refuses the
    // POST. `creatorAdmissionGranted` is what the "create" view checks, so a
    // direct navigation cannot skip the gate either.
    function openCreator(mode: "password" | "guest" = "password") {
        if (!registrationOpen) return;
        setSignupMode(mode);
        setCreatorAdmissionGranted(true);
        if (PRODUCT_ANALYTICS_ENABLED) captureProductEvent("character_creation_started", { source: "landing" });
        setView("create");
    }

    if (view.startsWith("legal:")) {
        return <LegalPage slug={view.slice("legal:".length) as LegalPageSlug} />;
    }

    if (view === "leaderboard") {
        return (
            <div className="start-screen landing-subscreen">
                <Suspense fallback={<div className="card start-leaderboard"><p className="start-leaderboard-empty">Loading leaderboard...</p></div>}>
                    <PublicLeaderboard onBack={() => setView("main")} />
                </Suspense>
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
        if (!creatorAdmissionGranted) {
            return (
                <div className="start-screen landing-subscreen landing-login-screen">
                    <div className="start-card" role="status" aria-live="polite">
                        <h2 className="start-card-title">Character creation is paused</h2>
                        <p className="start-hint landing-auth-notice">{registrationMessage}</p>
                        <button type="button" className="start-primary-btn" onClick={() => setView("login")}>Log In</button>
                        <button type="button" className="landing-auth-secondary" onClick={() => setView("main")}>Back</button>
                    </div>
                </div>
            );
        }
        return (
            <Suspense fallback={<div className="start-screen"><div className="start-card">Loading creator...</div></div>}>
                <CharacterCreator
                    onCreate={onCreate}
                    onBack={() => setView("main")}
                    googleSignup={googleSignup}
                    guest={signupMode === "guest"}
                />
            </Suspense>
        );
    }

    if (view === "login") {
        return (
            <div className="start-screen landing-subscreen landing-login-screen">
                <div className="landing-login-frame">
                    <button type="button" className="start-back-button landing-login-back" onClick={() => setView("main")}>Back</button>
                    <div className="landing-login-shell">
                        {/* "Your story is still moving" is a lie told to someone
                            who has never played, and this screen is reachable
                            from the landing's Log In before any character
                            exists. Both halves read the same remembered list so
                            the greeting matches who is actually standing here. */}
                        <section className="landing-login-copy" aria-label={knowsSomeone ? "Return briefing" : "Village briefing"}>
                            <p className="landing-kicker">Village Gates Open</p>
                            <h1 className="landing-login-title">
                                {knowsSomeone ? "Your shinobi story is still moving." : "The village is expecting you."}
                            </h1>
                            <p className="landing-login-lead">
                                {knowsSomeone
                                    ? "Step back into missions, rival clans, pet battles, world records, and the next chapter of your shinobi legend."
                                    : "Sign in to pick up a shinobi you already have, or start a new one — missions, rival clans, pet battles, and world records are waiting either way."}
                            </p>
                            <div className="landing-login-highlights" aria-label="World activity">
                                <span><GameIcon name="sword" /> Clan wars</span>
                                <span><GameIcon name="paw" /> Pet arena</span>
                                <span><GameIcon name="medal" /> Hall records</span>
                            </div>
                        </section>
                        <LoginGate
                            onLogin={onLogin}
                            onAdmin={onAdmin}
                            onContinueAs={onContinueAs}
                            onPlayAsGuest={() => openCreator("guest")}
                            initialName={initialName}
                            notice={notice}
                            onCreateAccount={openCreator}
                        />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <LandingMain
            onOpenCreate={openCreator}
            registrationOpen={registrationOpen}
            registrationMessage={registrationMessage}
            onOpenLogin={() => {
                if (PRODUCT_ANALYTICS_ENABLED) captureProductEvent("feature_entry_clicked", { source: "landing", contentId: "login" });
                setView("login");
            }}
            onOpenGuides={() => {
                if (PRODUCT_ANALYTICS_ENABLED) captureProductEvent("feature_entry_clicked", { source: "landing", contentId: "guides" });
                setView("guides");
            }}
            onOpenLeaderboard={() => {
                if (PRODUCT_ANALYTICS_ENABLED) captureProductEvent("feature_entry_clicked", { source: "landing", contentId: "leaderboard" });
                setView("leaderboard");
            }}
        />
    );
}

function FeatureCard({ feature }: { feature: Feature }) {
    return (
        <article className="landing-feature-card">
            <div className="landing-feature-media">
                <img src={feature.img} alt={feature.title} loading="lazy" decoding="async" />
                <span className="landing-feature-tag">{feature.tag}</span>
            </div>
            <div className="landing-feature-text">
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-blurb">{feature.blurb}</p>
            </div>
        </article>
    );
}

function LandingMain({ onOpenCreate, onOpenLogin, onOpenGuides, onOpenLeaderboard, registrationOpen, registrationMessage }: {
    onOpenCreate: () => void;
    onOpenLogin: () => void;
    onOpenGuides: () => void;
    onOpenLeaderboard: () => void;
    registrationOpen: boolean;
    registrationMessage: string;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const featuresRef = useRef<HTMLElement>(null);
    // A session-restore failure pre-fills the login name → open on Log In;
    // a fresh visitor lands on Create Account. Lifted here so the hero / band
    // CTAs can jump straight into the create flow.
    const year = new Date().getFullYear();

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
                        <button type="button" className="landing-navlink landing-navlink--cta" onClick={onOpenCreate} disabled={!registrationOpen} title={!registrationOpen ? registrationMessage : undefined}>Play Now</button>
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
                        {/* Says what the app IS, in plain words, above the fold.
                            Atmosphere is the job of the sections below; this
                            paragraph exists so a first-time visitor — or an
                            OAuth reviewer checking that the home page explains
                            the app's purpose — can tell what this is without
                            interpreting flavour text. Keep the app name in it
                            verbatim: it has to match the consent screen. */}
                        <p className="landing-tagline">
                            <strong>{APP_NAME}</strong> is a free role-playing game you play in your
                            browser. Create a shinobi, train their stats and jutsu, take on missions
                            and story chapters, raise companions, and test your build against other
                            players across {villages.length} rival villages.
                        </p>

                        <div className="landing-stat-chips">
                            <span className="landing-stat-chip">{villages.length} Rival Villages</span>
                            <span className="landing-stat-chip">Jutsu Combat</span>
                            <span className="landing-stat-chip">Browser Play</span>
                        </div>

                        <div className="landing-hero-actions">
                            <button type="button" className="landing-cta landing-cta--primary" data-testid="start-create" onClick={onOpenCreate} disabled={!registrationOpen} title={!registrationOpen ? registrationMessage : undefined}>
                                Enter the World
                            </button>
                            <a className="landing-cta landing-cta--ghost" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                                Join the Discord
                            </a>
                        </div>

                        <p className="landing-cta-note" role={!registrationOpen ? "status" : undefined}>{registrationOpen ? "Free to start · Plays in your browser · No download" : registrationMessage}</p>
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
                        <img src={CLAN_IMG} alt="Rival shinobi clans muster for war beneath their banners" loading="lazy" decoding="async" />
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
                        <img src={LEGACY_IMG} alt="An ancient path of torii gates leading toward legend" loading="lazy" decoding="async" />
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
                            <h3 className="landing-step-title">Master the Shinobi Arts</h3>
                            <p className="landing-step-desc">Train your attributes, master new jutsu, and earn your rank through missions.</p>
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
                        <button type="button" onClick={onOpenCreate} disabled={!registrationOpen} title={!registrationOpen ? registrationMessage : undefined}>Start Playing</button>
                        <button type="button" onClick={onOpenGuides}>Guides</button>
                        <button type="button" onClick={onOpenLeaderboard}>Leaderboard</button>
                        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>
                    </nav>
                </div>
                <div className="landing-footer-legal">
                    <p>© {year} Shinobi Journey. Forge your legend.</p>
                    <nav className="landing-footer-policy-links" aria-label="Legal and player policies">
                        {LEGAL_PAGE_LINKS.map((link) => <a key={link.slug} href={`/${link.slug}`}>{link.label}</a>)}
                    </nav>
                </div>
            </footer>

            <div className="landing-mobile-cta">
                <button type="button" className="landing-cta landing-cta--primary" onClick={onOpenCreate} disabled={!registrationOpen} title={!registrationOpen ? registrationMessage : undefined}>
                    Play Free Now
                </button>
            </div>
        </div>
    );
}

