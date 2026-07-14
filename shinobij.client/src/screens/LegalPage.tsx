import { useEffect, type ReactNode } from "react";
import { LEGAL_PAGE_LINKS, type LegalPageSlug } from "../data/legal";

type LegalSection = {
    id: string;
    title: string;
    content: ReactNode;
};

type LegalDocument = {
    shortTitle: string;
    title: string;
    summary: string;
    sections: LegalSection[];
};

const LAST_UPDATED = "July 14, 2026";
const VERSION = "1.0";

const documents: Record<LegalPageSlug, LegalDocument> = {
    terms: {
        shortTitle: "Terms",
        title: "Terms of Service",
        summary: "The rules for accessing and playing the Shinobi Journey public beta.",
        sections: [
            {
                id: "agreement",
                title: "Agreement and eligibility",
                content: <>
                    <p>By creating an account or using Shinobi Journey, you agree to these Terms and the Community Rules. If you cannot legally agree to them, do not use the service.</p>
                    <p>The public beta may change, reset, pause, or end as development continues. Features and availability are not guaranteed.</p>
                </>,
            },
            {
                id: "accounts",
                title: "Accounts",
                content: <>
                    <p>You are responsible for your account credentials and activity. Use an original player name, keep your password private, and tell staff promptly if you believe your account has been compromised.</p>
                    <p>Do not sell, trade, share, impersonate, or obtain accounts without permission. Staff may restrict or recover accounts when needed to protect players or the service.</p>
                </>,
            },
            {
                id: "conduct",
                title: "Player conduct",
                content: <>
                    <p>You must follow the <a href="/community-rules">Community Rules</a>. Cheating, automation, exploit abuse, harassment, scams, malicious links, unauthorized access, and interference with the game or its APIs are prohibited.</p>
                    <p>Staff may investigate activity, preserve relevant evidence, remove content, reverse illegitimate gains, restrict features, suspend accounts, or close accounts based on context and severity.</p>
                </>,
            },
            {
                id: "player-content",
                title: "Player content",
                content: <>
                    <p>You remain responsible for text, names, messages, prompts, and images you submit. Only submit material you own or are allowed to use.</p>
                    <p>You give Shinobi Journey permission to host, copy, display, moderate, and process that material only as reasonably needed to operate, secure, and improve the service. Public-facing content may be seen and shared by other players.</p>
                </>,
            },
            {
                id: "virtual-items",
                title: "Virtual items and game changes",
                content: <>
                    <p>Characters, currencies, items, rankings, and other game content are limited permissions within the service. They have no cash value, cannot be cashed out, and may be balanced, corrected, removed, or reset.</p>
                    <p>See <a href="/purchases-and-refunds">Purchases and Refunds</a> for the current beta position on real-money payments and failed in-game deliveries.</p>
                </>,
            },
            {
                id: "availability",
                title: "Availability and responsibility",
                content: <>
                    <p>The service is provided on an as-available basis. Outages, bugs, latency, data loss, and incompatible changes may occur during beta. Nothing in these Terms excludes rights or remedies that cannot lawfully be excluded.</p>
                    <p>To the extent permitted by law, Shinobi Journey is not responsible for indirect or consequential losses arising from use of the service.</p>
                </>,
            },
            {
                id: "changes-contact",
                title: "Changes and contact",
                content: <>
                    <p>These Terms may be updated as the game changes. The version and date above will change when the published Terms change, and material changes may require renewed acceptance.</p>
                    <p>For account or Terms questions, contact game staff privately through the official community link on the main page. Do not post passwords, tokens, or private identifying information in a public channel.</p>
                </>,
            },
        ],
    },
    privacy: {
        shortTitle: "Privacy",
        title: "Privacy Policy",
        summary: "What the game collects, why it is used, and which information other players can see.",
        sections: [
            {
                id: "collection",
                title: "Information collected",
                content: <>
                    <p>Shinobi Journey processes account identifiers, salted password hashes, session records, character saves, progression, inventory, currencies, combat results, rankings, clan and social activity, preferences, and support or moderation records.</p>
                    <p>The service may also process IP addresses, a browser-derived device fingerprint, request and performance diagnostics, error details, and security events. If you use social or creative features, submitted messages, titles, names, images, uploads, and optional image-generation prompts are also processed.</p>
                </>,
            },
            {
                id: "use",
                title: "How information is used",
                content: <>
                    <p>Information is used to authenticate players, save progress, operate multiplayer and social features, publish appropriate game records, prevent abuse, enforce rules, diagnose failures, secure the service, and improve game performance.</p>
                    <p>IP and device signals are security data, not anonymous data. They may be used to rate-limit requests, investigate abuse, and identify linked activity.</p>
                </>,
            },
            {
                id: "visibility",
                title: "Information visible to others",
                content: <p>Player names, avatars, villages, profile fields, titles, rankings, online or recent activity, combat results, clan information, chat, and other content intentionally posted to shared features may be visible to other players. Password hashes, session tokens, IP addresses, and browser fingerprints are not intended to be public.</p>,
            },
            {
                id: "providers",
                title: "Service providers",
                content: <>
                    <p>Hosting and database providers process game data to run the service. Error reporting may be sent to Sentry when that feature is configured. When optional AI image generation is enabled and used, the submitted prompt is sent to OpenAI to generate the requested image.</p>
                    <p>These providers process information for their service roles. Shinobi Journey does not state that personal information is sold or shared for behavioral advertising.</p>
                </>,
            },
            {
                id: "storage-retention",
                title: "Browser storage, retention, and deletion",
                content: <>
                    <p>The game uses browser storage for sign-in, preferences, cached game state, and interrupted-session recovery. Details appear in the <a href="/cookies">Cookie and Local Storage Notice</a>.</p>
                    <p>Records are kept while needed to operate accounts, shared game systems, security, moderation, troubleshooting, and backups. Some shared records may need to be anonymized rather than removed. Current deletion is handled by request and is complete only after connected records have been reviewed.</p>
                </>,
            },
            {
                id: "choices",
                title: "Your choices and requests",
                content: <>
                    <p>You may request access, correction, export, or deletion of account information. Rights vary by location, and identity verification may be required before a request is completed.</p>
                    <p>Use the <a href="/privacy-request">Privacy Request</a> instructions. Clearing browser storage removes local copies and preferences but does not by itself delete server-side account data.</p>
                </>,
            },
            {
                id: "security-changes",
                title: "Security and policy changes",
                content: <>
                    <p>Shinobi Journey uses technical and organizational safeguards, but no online service can promise complete security. Never send a password or session token to another player.</p>
                    <p>This policy may change as the beta and its providers change. The version and date above identify the currently published notice.</p>
                </>,
            },
        ],
    },
    "community-rules": {
        shortTitle: "Rules",
        title: "Community Rules",
        summary: "Simple standards for fair play and a safe community.",
        sections: [
            {
                id: "people",
                title: "Treat players like people",
                content: <p>No harassment, hate, threats, sexual harassment, stalking, doxxing, targeted humiliation, or encouragement of real-world harm. Disagreements are not permission to abuse another person.</p>,
            },
            {
                id: "privacy-content",
                title: "Protect privacy and keep content appropriate",
                content: <p>Do not share another person's private information, impersonate players or staff, send malicious links, post fake staff messages, or use abusive clan chat, village chat, private messages, custom titles, named weapons, images, or AI prompts.</p>,
            },
            {
                id: "fair-play",
                title: "Play fairly",
                content: <p>No automated training, bots, save editing, API tampering, currency duplication, exploit farming, win trading, alternate-account manipulation, clan-war collusion, village-war manipulation, leaderboard manipulation, scams, or account trading.</p>,
            },
            {
                id: "content-rights",
                title: "Respect content rights",
                content: <p>Upload or generate only content you own or are authorized to use. Do not submit prohibited, deceptive, infringing, or harmful material. Copyright reports are explained in the <a href="/copyright">Copyright Policy</a>.</p>,
            },
            {
                id: "reports",
                title: "Report problems responsibly",
                content: <p>Report serious bugs, exploits, security issues, and player-safety concerns privately to staff through the official community link. Do not demonstrate a live exploit publicly or use it for advantage.</p>,
            },
            {
                id: "enforcement",
                title: "Enforcement and appeals",
                content: <p>Staff may preserve evidence and investigate linked accounts. Warnings, content removal, reversals, restrictions, suspensions, or account closure depend on context, severity, history, and risk. Appeals should be made privately and include the player name and the decision being appealed.</p>,
            },
        ],
    },
    "purchases-and-refunds": {
        shortTitle: "Purchases",
        title: "Virtual Items, Purchases, and Refunds",
        summary: "How virtual currencies and failed deliveries are handled during the current beta.",
        sections: [
            {
                id: "current-beta",
                title: "Current beta",
                content: <p>The current public beta includes virtual currencies, items, rewards, redemption-style actions, and in-game exchanges. It does not currently present a player-facing real-money checkout. If paid products are introduced, the price, provider, delivery terms, and applicable refund process must be shown before payment.</p>,
            },
            {
                id: "virtual-property",
                title: "Virtual items are not money",
                content: <p>Virtual currencies and items are gameplay records. They are not legal tender, have no cash value, cannot be cashed out, and may not be sold or transferred outside supported game features.</p>,
            },
            {
                id: "changes",
                title: "Balance and availability changes",
                content: <p>Stats, prices, reward rates, limits, availability, and uses may change for balance, security, technical, or beta-testing reasons. Staff may correct duplicated, exploited, mistakenly delivered, or otherwise invalid balances and items.</p>,
            },
            {
                id: "failed-delivery",
                title: "Failed or duplicate delivery",
                content: <p>If an in-game transaction fails, is duplicated, or delivers the wrong result, stop retrying and contact staff privately with your player name, approximate time, action taken, and any safe screenshot. Verified game-record errors may be corrected; outcomes depend on the available records and circumstances.</p>,
            },
            {
                id: "future-payments",
                title: "Future real-money payments",
                content: <p>No blanket “no refunds” rule is stated here. Any future real-money refund request will be handled under the terms shown at purchase, the payment provider's process, and applicable law. Fraud, chargebacks, reversed payments, and delivery disputes may lead to a temporary restriction while records are reviewed.</p>,
            },
        ],
    },
    cookies: {
        shortTitle: "Cookies",
        title: "Cookie and Local Storage Notice",
        summary: "A short explanation of the browser storage needed for sign-in and gameplay.",
        sections: [
            {
                id: "technology",
                title: "What the game uses",
                content: <p>Shinobi Journey primarily uses browser local storage and session storage rather than a marketing-cookie system. These technologies keep a session token or account reference, preferences, cached game data, performance state, and short-lived battle or screen recovery information on your device.</p>,
            },
            {
                id: "categories",
                title: "Storage categories",
                content: <ul>
                    <li><strong>Strictly necessary:</strong> authentication, account selection, save recovery, security, and essential game continuity.</li>
                    <li><strong>Preference and functional:</strong> interface choices, audio choices, dismissed guidance, and cached content.</li>
                    <li><strong>Diagnostics:</strong> short-lived performance and error context used to find reliability problems.</li>
                    <li><strong>Advertising:</strong> no advertising-storage feature is currently described by the game client.</li>
                </ul>,
            },
            {
                id: "control",
                title: "Your controls",
                content: <p>You can clear or block storage through browser settings. Blocking required storage may prevent login, saving, preferences, or session recovery from working. Clearing storage signs the browser out and removes local caches, but it does not delete server-side account data.</p>,
            },
            {
                id: "consent",
                title: "Why there is no decorative banner",
                content: <p>The current game does not offer an advertising preference banner because the published client does not describe advertising storage. If optional analytics or advertising storage is introduced, it must be controlled before loading where consent is required and this notice must be updated.</p>,
            },
        ],
    },
    copyright: {
        shortTitle: "Copyright",
        title: "Copyright Policy",
        summary: "Rules for submitted images and other player-created content.",
        sections: [
            {
                id: "uploads",
                title: "Only submit authorized content",
                content: <p>Players may submit only text, images, names, prompts, and other material they created or have permission to use. Content may be removed or restricted when a credible rights complaint is received.</p>,
            },
            {
                id: "report",
                title: "Copyright reports",
                content: <>
                    <p>Send a private report to game staff through the official community link on the main page. Do not post personal contact details in a public channel. Include:</p>
                    <ul>
                        <li>your contact information and authority to act;</li>
                        <li>the copyrighted work you believe is affected;</li>
                        <li>the exact in-game content and enough detail to locate it;</li>
                        <li>why the use is not authorized;</li>
                        <li>a good-faith and accuracy statement; and</li>
                        <li>your physical or electronic signature.</li>
                    </ul>
                </>,
            },
            {
                id: "response",
                title: "Response and counter-notices",
                content: <p>Staff may ask for verification, remove or disable content, notify the submitting player, and accept a counter-notice where appropriate. A counter-notice should identify the removed content, explain why removal was a mistake, include reliable contact details and required legal statements, and be signed.</p>,
            },
            {
                id: "repeat",
                title: "Repeat infringement and false reports",
                content: <p>Repeated infringement may result in feature restrictions or account closure. Knowingly false or abusive reports may also lead to action and may create legal consequences.</p>,
            },
            {
                id: "dmca",
                title: "DMCA status",
                content: <p>This page does not claim that a United States DMCA designated agent has been registered. The ordinary private reporting process above is the currently published contact path.</p>,
            },
        ],
    },
    "privacy-request": {
        shortTitle: "Privacy Request",
        title: "Privacy Requests and Account Deletion",
        summary: "How to ask for access, correction, export, or deletion of account information.",
        sections: [
            {
                id: "submit",
                title: "Submit a request",
                content: <>
                    <p>Contact game staff privately through the official community link on the main page and state that you are making a privacy request. Do not put passwords, session tokens, or identity documents in a public channel.</p>
                    <p>Include your player name, the type of request, and a safe way for staff to reply. Staff may require fresh account authentication or other proportionate verification before releasing, changing, or deleting data.</p>
                </>,
            },
            {
                id: "types",
                title: "Request types",
                content: <ul>
                    <li>Access to or a copy of available account information</li>
                    <li>Correction of editable profile information</li>
                    <li>Deletion of an account and connected data</li>
                    <li>Restriction, objection, portability, consent withdrawal, or appeal where applicable</li>
                </ul>,
            },
            {
                id: "limits",
                title: "What may be limited",
                content: <p>Some identifiers, shared battle or chat history, fraud and security evidence, moderation records, transaction records, and backups may need to be retained temporarily or anonymized instead of immediately erased. Any response should explain material limits that apply to the request.</p>,
            },
            {
                id: "deletion",
                title: "Account deletion",
                content: <p>Clearing browser storage or deleting a local login reference does not delete the server account. A deletion request is complete only after credentials, active sessions, the player save, public profile references, connected social records, uploaded content, and relevant security indexes have been reviewed for deletion or appropriate anonymization.</p>,
            },
            {
                id: "safety",
                title: "Request safety",
                content: <p>Staff will not ask you to publish a password or authentication token. Requests may be paused when identity cannot be verified or when fulfilling them would expose another player's private information, undermine service security, or conflict with a lawful retention duty.</p>,
            },
        ],
    },
};

export function LegalPage({ slug }: { slug: LegalPageSlug }) {
    const document = documents[slug];

    useEffect(() => {
        const previousTitle = window.document.title;
        window.document.title = `${document.title} — Shinobi Journey`;
        window.scrollTo({ top: 0 });
        return () => { window.document.title = previousTitle; };
    }, [document.title]);

    return (
        <div className="legal-page-shell">
            <header className="legal-page-header">
                <a className="legal-back-link" href="/" aria-label="Back to Shinobi Journey home">← Back to Home</a>
                <p className="legal-page-kicker">Shinobi Journey Policies</p>
                <h1>{document.title}</h1>
                <p className="legal-page-summary">{document.summary}</p>
                <p className="legal-page-meta">Version {VERSION} · Last updated {LAST_UPDATED}</p>
            </header>

            <nav className="legal-page-nav" aria-label="Legal and player policies">
                {LEGAL_PAGE_LINKS.map((link) => (
                    <a key={link.slug} href={`/${link.slug}`} aria-current={link.slug === slug ? "page" : undefined}>
                        {link.label}
                    </a>
                ))}
            </nav>

            <main className="legal-page-content">
                <aside className="legal-page-toc" aria-label="On this page">
                    <strong>On this page</strong>
                    {document.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
                </aside>
                <article className="legal-page-article">
                    {document.sections.map((section) => (
                        <section key={section.id} id={section.id}>
                            <h2>{section.title}</h2>
                            {section.content}
                        </section>
                    ))}
                </article>
            </main>

            <footer className="legal-page-footer">
                <a href="/">© {new Date().getFullYear()} Shinobi Journey</a>
            </footer>
        </div>
    );
}
