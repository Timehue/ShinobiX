import "../styles/landing-home.css";
import { Suspense, useEffect, useRef, useState } from "react";
import { type Character } from "../App";
import { villages } from "../data/sectors";
import { GameIcon } from "../components/icons/GameIcon";
import { IphoneInstallGuide } from "../components/IphoneInstallGuide";
import { GameplayGallery } from "./start/GameplayGallery";
import { LandingAtmosphere } from "./start/LandingAtmosphere";
import { useLandingReveals } from "./start/useLandingReveals";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { LEGAL_PAGE_LINKS, legalPageForPath, type LegalPageSlug } from "../data/legal";
import { LegalPage } from "./LegalPage";
import { LoginGate } from "./start/LoginGate";
import { rememberedShinobi } from "../lib/player-accounts";
import { DISCORD_INVITE_URL } from "../constants/game";
import { captureProductEvent } from "../lib/analytics";
import type { SignupCredential } from "../lib/guest-play";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
} from "../lib/live-capabilities-context";
import {
    capabilityAdmissionOpenUntilRefused,
    playerLoginAdmissionMessage,
    registrationAdmissionMessage,
} from "../lib/live-capability-admission";

const PRODUCT_ANALYTICS_ENABLED = import.meta.env.VITE_PRODUCT_ANALYTICS_ENABLED === "1";

const CharacterCreator = lazyWithRetry(() => import("./CharacterCreator").then(m => ({ default: m.CharacterCreator })));
const PublicLeaderboard = lazyWithRetry(() => import("./PublicLeaderboard").then(m => ({ default: m.PublicLeaderboard })));

const GuidesLibrary = lazyWithRetry(() => import("../components/GuidesLibrary").then(m => ({ default: m.GuidesLibrary })));

type StartView = "main" | "create" | "login" | "leaderboard" | "guides" | `legal:${LegalPageSlug}`;

type BrandLockupVariant = "nav" | "hero" | "footer";

// The wordmark is artwork, but the app's NAME has to be readable as text, not
// only painted into a WebP. Google's OAuth brand verification rejected the app
// for exactly this: it compares the consent-screen app name against the name it
// can find on the home page, and a 1px-clipped span behind an aria-hidden image
// gave it nothing to match. The alt text carries the name now — which is also
// what a screen reader should have been getting all along.
export const APP_NAME = "Shinobi Journey";

function BrandLockup({ variant = "nav" }: { variant?: BrandLockupVariant }) {
    const hero = variant === "hero";
    // Both assets contain the complete emblem; the former wide asset cut off
    // its top and bottom. Small placements use a separate, lighter export.
    const src = hero ? "/landing/logo-complete.webp" : "/landing/logo-small.webp";
    return (
        <span className={`landing-logo landing-logo--${variant}`}>
            <img
                className="landing-logo-art"
                src={src}
                alt={APP_NAME}
                width={1688}
                height={932}
                loading={variant === "footer" ? "lazy" : "eager"}
                decoding="async"
                fetchPriority={hero ? "high" : "auto"}
                draggable={false}
            />
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
    const playerLoginOpen = capabilityAdmissionOpenUntilRefused(playerLoginAvailability);
    // Open until the server actually refuses. Failing closed here greyed out the
    // landing call to action and printed "Checking whether new character
    // registration is available" on every cold load, for the length of one
    // capability round-trip, to every visitor — while the real gate never moved:
    // App.createPlayerAccount rechecks with fresh truth at submit, and the server
    // 503s a paused registration at the route boundary either way.
    const registrationOpen = capabilityAdmissionOpenUntilRefused(registrationsAvailability);
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
                <Suspense fallback={<div className="card start-leaderboard"><p className="start-leaderboard-empty">Loading leaderboard…</p></div>}>
                    <PublicLeaderboard onBack={() => setView("main")} />
                </Suspense>
            </div>
        );
    }

    if (view === "guides") {
        return (
            <div className="start-screen landing-subscreen">
                <Suspense fallback={<div className="guides-root"><p className="guides-intro">Loading guides…</p></div>}>
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
                        <button type="button" className="start-primary-btn" onClick={() => setView("login")}>Log in</button>
                        <button type="button" className="landing-auth-secondary" onClick={() => setView("main")}>Back</button>
                    </div>
                </div>
            );
        }
        return (
            <Suspense fallback={<div className="start-screen"><div className="start-card">Loading creator…</div></div>}>
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
                            from the landing's Log in before any character
                            exists. Both halves read the same remembered list so
                            the greeting matches who is actually standing here. */}
                        <section className="landing-login-copy" aria-label={knowsSomeone ? "Return briefing" : "Village briefing"}>
                            <p className="landing-kicker">Log in</p>
                            <h1 className="landing-login-title">
                                {knowsSomeone ? "Your shinobi story is still moving." : "The village is expecting you."}
                            </h1>
                            <p className="landing-login-lead">
                                {knowsSomeone
                                    ? "Step back into missions, rival clans, pet battles, world records, and the next chapter of your story."
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

function LandingMain({ onOpenCreate, onOpenLogin, onOpenGuides, onOpenLeaderboard, registrationOpen, registrationMessage }: {
    onOpenCreate: () => void;
    onOpenLogin: () => void;
    onOpenGuides: () => void;
    onOpenLeaderboard: () => void;
    registrationOpen: boolean;
    registrationMessage: string;
}) {
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const landingRef = useLandingReveals();
    const [menuOpen, setMenuOpen] = useState(false);
    const year = new Date().getFullYear();
    useEffect(() => {
        if (menuOpen) document.getElementById('landing-navigation')?.querySelector<HTMLButtonElement>('button')?.focus();
    }, [menuOpen]);
    const scrollTo = (id: string) => {
        setMenuOpen(false);
        const destination = document.getElementById(id);
        destination?.focus({ preventScroll: true });
        destination?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            block: 'start',
        });
    };
    const playProps = {
        onClick: onOpenCreate,
        disabled: !registrationOpen,
        title: !registrationOpen ? registrationMessage : undefined,
    };

    return (
        <div className="landing-root" id="landing-home" tabIndex={-1} ref={landingRef}>
            <a className="landing-skip" href="#landing-discover">Skip to content</a>
            <header className="landing-topbar" onKeyDown={(event) => {
                if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButtonRef.current?.focus(); }
            }}>
                <div className="landing-utility">
                    <span>A free browser RPG</span>
                    <div><a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">Community ↗</a></div>
                </div>
                <div className="landing-topbar-inner">
                    <button type="button" className="landing-brand" onClick={() => scrollTo('landing-home')} aria-label="Shinobi Journey home">
                        <BrandLockup variant="nav" />
                    </button>
                    <nav className={`landing-topnav${menuOpen ? ' is-open' : ''}`} id="landing-navigation" aria-label="Primary navigation">
                        <button type="button" className="landing-navlink" onClick={() => scrollTo('landing-discover')}>The world</button>
                        <button type="button" className="landing-navlink" onClick={() => scrollTo('landing-gameplay')}>Gameplay</button>
                        <button type="button" className="landing-navlink" onClick={onOpenGuides}>Guides</button>
                        <button type="button" className="landing-navlink" onClick={onOpenLeaderboard}>Leaderboard</button>
                        <button type="button" className="landing-navlink landing-mobile-login" onClick={onOpenLogin}>Log in</button>
                    </nav>
                    <div className="landing-nav-actions">
                        <button type="button" className="landing-navlink landing-desktop-login" onClick={onOpenLogin}>Log in</button>
                        <button type="button" className="landing-cta landing-cta--primary landing-nav-play" {...playProps}>Play free</button>
                        <button type="button" ref={menuButtonRef} className="landing-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
                    </div>
                </div>
            </header>

            <section className="landing-hero" aria-label="Welcome to Shinobi Journey">
                <LandingAtmosphere />
                <div className="landing-hero-inner">
                    <div className="landing-hero-copy">
                        <p className="landing-eyebrow">A free shinobi RPG in your browser</p>
                        <h1 className="landing-title"><BrandLockup variant="hero" /></h1>
                        <p className="landing-hero-hook">Four villages are at war. Choose one.</p>
                        <p className="landing-tagline">
                            Train a shinobi, learn their jutsu, and fight for one of {villages.length} rival villages. <strong>{APP_NAME}</strong> is a free role-playing game you play in your browser.
                        </p>
                        <div className="landing-hero-actions">
                            <button type="button" className="landing-cta landing-cta--primary" data-testid="start-create" {...playProps}>Play free <span aria-hidden="true">→</span></button>
                            <button type="button" className="landing-cta landing-cta--ghost" onClick={() => scrollTo('landing-gameplay')}><span className="landing-play-icon" aria-hidden="true">◇</span> See gameplay</button>
                        </div>
                        <p className="landing-cta-note" role={!registrationOpen ? 'status' : undefined}>{registrationOpen ? 'Free to play  ·  No download required' : registrationMessage}</p>
                        <IphoneInstallGuide />
                    </div>
                </div>
                <button type="button" className="landing-scroll-cue" onClick={() => scrollTo('landing-discover')}><span>See the world</span><span aria-hidden="true">⌄</span></button>
                <span className="landing-hero-caption">A hidden mountain village at sunset</span>
            </section>

            <div className="landing-world-strip" aria-label="Discover Shinobi Journey">
                <span><GameIcon name="map" />{villages.length} rival villages</span><i aria-hidden="true">◆</i>
                <span><GameIcon name="sword" />Tactical jutsu combat</span><i aria-hidden="true">◆</i>
                <span><GameIcon name="paw" />Pets that fight beside you</span>
            </div>

            <section className="landing-features" id="landing-discover" aria-labelledby="landing-world-title" tabIndex={-1}>
                <div className="landing-section-head" data-landing-reveal>
                    <p className="landing-kicker">This is Shinobi Journey</p>
                    <h2 id="landing-world-title" className="landing-section-title">Every fight you win shapes the world.</h2>
                    <p className="landing-section-sub">Missions, story chapters and clan wars all happen in the same living world.<br className="landing-desktop-break" /> You choose which ones your shinobi takes on.</p>
                </div>
                <div className="landing-feature-grid">
                    <button type="button" className="landing-feature-card landing-feature-card--world" data-landing-reveal="card" onClick={() => scrollTo('landing-story')}>
                        <img src="/landing-hero-village-v2.webp" alt="A hidden mountain village connected by bridges and waterfalls" loading="lazy" width="1829" height="860" />
                        <div className="landing-feature-text"><span className="landing-kicker">The world</span><h3>Choose a village</h3><p>Pick a village, take its missions, and help it hold its sectors.</p><span className="landing-text-link">Read the story <span aria-hidden="true">↗</span></span></div>
                    </button>
                    <button type="button" className="landing-feature-card" data-landing-reveal="card" onClick={() => scrollTo('landing-companions')}>
                        <img src="/landing/companion.webp" alt="A shinobi and his fox companion beneath golden autumn leaves" loading="lazy" width="1024" height="1536" />
                        <div className="landing-feature-text"><span className="landing-kicker">Clans and companions</span><h3>Fight with a clan</h3><p>Join a clan and raise companions who fight beside you.</p><span className="landing-text-link">Meet the companions <span aria-hidden="true">↗</span></span></div>
                    </button>
                    <button type="button" className="landing-feature-card" data-landing-reveal="card" onClick={() => scrollTo('landing-gameplay')}>
                        <img src="/landing-clanwar-v2.webp" alt="Shinobi gather beneath crimson banners overlooking a mountain fortress" loading="lazy" width="1448" height="1086" />
                        <div className="landing-feature-text"><span className="landing-kicker">Combat</span><h3>Earn your rank</h3><p>Train your jutsu, climb the ranked ladder, and earn a place in the Hall of Legends.</p><span className="landing-text-link">See it in action <span aria-hidden="true">↗</span></span></div>
                    </button>
                </div>
            </section>

            <GameplayGallery />

            <section className="landing-clan landing-story" id="landing-story" aria-labelledby="landing-story-title" tabIndex={-1}>
                <div className="landing-clan-inner">
                    <div className="landing-clan-copy" data-landing-reveal><p className="landing-kicker">Story chapters</p><h2 id="landing-story-title" className="landing-section-title">Each village<br />tells its own story.</h2><p>Every village has its own chapters, told in illustrated scenes. The choices you make there are remembered, and later chapters answer them.</p><button type="button" className="landing-text-link" onClick={onOpenGuides}>Read the starter guide <span aria-hidden="true">→</span></button></div>
                    <figure className="landing-clan-media" data-landing-reveal><img src="/landing/story.webp" alt="Actual gameplay: the What Came Back epilogue in a snow-dusted village" loading="lazy" width="1366" height="768" /><figcaption><span>The What Came Back epilogue</span><span>In-game capture</span></figcaption></figure>
                </div>
            </section>

            <section className="landing-clan landing-clan--reverse" id="landing-companions" aria-labelledby="landing-companion-title" tabIndex={-1}>
                <div className="landing-clan-inner">
                    <div className="landing-companion-art" data-landing-reveal><img src="/landing/companion.webp" alt="A fox companion leans into a shinobi's hand in the golden light of a mountain village" loading="lazy" width="1024" height="1536" /></div>
                    <div className="landing-clan-copy" data-landing-reveal><p className="landing-kicker">Companions</p><h2 id="landing-companion-title" className="landing-section-title">Your companion<br />fights beside you.</h2><p>Raise a companion, send it on expeditions, and test it against other players' pets in the arena.</p><div className="landing-companion-traits"><span><GameIcon name="map" />Expeditions</span><span><GameIcon name="paw" />Training</span><span><GameIcon name="sword" />Pet arena</span><span><GameIcon name="medal" />Ranked ladder</span></div><button type="button" className="landing-text-link" onClick={onOpenGuides}>Open the guides <span aria-hidden="true">→</span></button></div>
                </div>
            </section>

            <section className="landing-begin" aria-labelledby="landing-begin-title">
                <div className="landing-begin-inner" data-landing-reveal><p className="landing-kicker">No download needed</p><h2 id="landing-begin-title" className="landing-section-title">A village is waiting for you.</h2><p>Pick a village and make your shinobi to begin.</p><button type="button" className="landing-cta landing-cta--primary" {...playProps}>Play free <span aria-hidden="true">→</span></button><p className="landing-cta-note" role={!registrationOpen ? 'status' : undefined}>{registrationOpen ? 'It runs in your browser on desktop and phone.' : registrationMessage}</p></div>
            </section>

            <footer className="landing-footer">
                <div className="landing-community"><div><p className="landing-kicker">Community</p><h2>Find a clan on Discord.</h2></div><a className="landing-cta landing-cta--ghost" href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">Join the Discord <span aria-hidden="true">↗</span></a></div>
                <div className="landing-footer-inner"><div className="landing-footer-brand"><BrandLockup variant="footer" /><p>A free browser-based shinobi RPG.</p></div><nav className="landing-footer-links" aria-label="Footer navigation"><button type="button" {...playProps}>Play free</button><button type="button" onClick={onOpenGuides}>Guides</button><button type="button" onClick={onOpenLeaderboard}>Leaderboard</button><button type="button" onClick={onOpenLogin}>Log in</button></nav></div>
                <div className="landing-footer-legal"><p>© {year} Shinobi Journey.</p><nav className="landing-footer-policy-links" aria-label="Legal and player policies">{LEGAL_PAGE_LINKS.map((link) => <a key={link.slug} href={`/${link.slug}`}>{link.label}</a>)}</nav></div>
            </footer>
        </div>
    );
}
