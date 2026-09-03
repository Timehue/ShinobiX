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

// Bump BOTH whenever the published wording changes — the pages tell players
// these identify the notice currently in force, so leaving them stale makes
// that statement false. 1.4: Google sign-in and guest characters (what each
// sign-in method collects, the guest fourteen-day deletion, and IP / device
// fingerprint processing stated plainly rather than implied).
// 1.5: third-party notices — Apache 2.0 attribution for the self-hosted Roboto
// webfont, and the Google trademark disclaimer for the sign-in button.
// 1.7: the published contact moved from a personal Gmail to
// support@shinobijourney.com (Cloudflare Email Routing on the game's own
// domain). Same human behind it; the address players are told to write to is
// what changed, which is exactly what these version fields exist to record.
// 1.8: the real-money storefront went live (Tebex). Until this version the
// purchases page stated the game "does not currently present a player-facing
// real-money checkout" and described payments as a future possibility — which
// became FALSE the moment the shop shipped, while money was actually changing
// hands. The privacy policy also listed every processor except the one handling
// payments. Both are corrected here.
const LAST_UPDATED = "September 2, 2026";
const VERSION = "1.8";

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
                    <p><strong>You must be at least 13 years old to create an account or use the service.</strong> Shinobi Journey is not directed to children under 13, and we do not knowingly allow them to register. Where the law of your country sets a higher minimum age for using an online service or for consenting to the processing of personal data, you confirm that you meet that higher age. When you create a character you confirm that you meet this age requirement.</p>
                    <p>The public beta may change, reset, pause, or end as development continues. Features and availability are not guaranteed.</p>
                </>,
            },
            {
                id: "accounts",
                title: "Accounts",
                content: <>
                    <p>You are responsible for your account credentials and activity. Use an original player name, keep your password private, and tell staff promptly if you believe your account has been compromised. If you sign in with Google, whoever controls that Google account can reach your character, so protect it accordingly.</p>
                    <p>A guest character is not a protected account: it has no password and no linked identity, it exists only in the browser that made it, and it is deleted after fourteen days without play. Link a Google account or set a password to keep one permanently.</p>
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
                id: "governing-law",
                title: "Governing law and disputes",
                content: <>
                    <p>These Terms, and any dispute arising from them or from your use of Shinobi Journey, are governed by the laws of the State of Wisconsin, USA, without regard to its conflict-of-laws rules. You and the operator agree that the state and federal courts located in Wisconsin are the venue for any dispute, unless a mandatory law that applies to you provides otherwise.</p>
                    <p>Nothing here removes protections you cannot legally waive. If you are a consumer, you keep the mandatory consumer rights — and any right to bring a claim in the courts of your own country or state — that the law of your home jurisdiction guarantees.</p>
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
                    <p><strong>Sign-in method.</strong> There are three ways to create an account, and they collect different things. A shinobi name and password collects no email address. Guest play collects no email address and no password. Signing in with Google shares your email address and a permanent Google account identifier with us; both are stored on your account, the identifier so the same Google account returns you to the same character and the email so you can tell which Google account you linked. We request nothing else from Google, neither value is shown to other players, and both are deleted when the account is deleted. You can add a password to a Google account at any time from your Profile, and you are never required to use Google to play.</p>
                    <p><strong>IP addresses and device signals.</strong> Every request to the service is processed with the IP address it came from, and the game additionally derives a device fingerprint in your browser from characteristics such as screen size, time zone, language, and graphics rendering. Both are recorded against your account name and retained. Depending on where you live, an IP address and a device fingerprint may themselves be personal information — we treat them that way. They are collected on every account type, including guest play, and there is no way to use the service without them.</p>
                    <p>The service may also process request and performance diagnostics, error details, and security events. If you use social or creative features, submitted messages, titles, names, images, uploads, and optional image-generation prompts are also processed.</p>
                    <p>Shinobi Journey is intended for players aged 13 and older and is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has created an account, contact staff through the official community link and we will remove the account and its personal information.</p>
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
                    <p>If you choose to sign in with Google, that sign-in happens on Google's own pages and is governed by Google's privacy policy. We receive only your email address and a Google account identifier, and we send Google nothing about your character or play. Choosing another sign-in method means no data is exchanged with Google at all.</p>
                    <p>These providers process information for their service roles. Shinobi Journey does not sell personal information and does not share it for behavioral advertising.</p>
                    <p>Payments are handled by <strong>Tebex</strong>, who act as the merchant of record for the store. Card and billing details are entered on Tebex's own checkout and go to Tebex and their payment processors — they are never sent to, seen by, or stored by Shinobi Journey.</p>
                </>,
            },
            {
                id: "payments",
                title: "Purchases and subscriptions",
                content: (
                    <>
                        <p>Buying Fate Shards or a Shinobi Supporter subscription sends you to a checkout hosted by Tebex, the merchant of record. You enter your payment details there, not here. Shinobi Journey never receives your card number, and no payment instrument is stored on your account.</p>
                        <p><strong>What is sent to Tebex.</strong> When you start a purchase the game creates a basket identified by your player name, so the items can be credited to the right character. That name is set by the server from your signed-in session — you are never asked to type it at checkout, which is what stops a purchase landing on someone else's account. Tebex separately collects whatever their checkout requires to take the payment and meet their tax obligations, under their own privacy policy.</p>
                        <p><strong>What is kept here.</strong> A completed purchase records the provider's transaction reference on your account, so the same payment can never be credited twice. A subscription additionally stores its recurring-payment reference, which is what lets the subscription be cancelled if the account is deleted. Neither is shown to other players.</p>
                        <p><strong>Deleting your account cancels the subscription.</strong> Account deletion asks Tebex to end any active recurring payment before the account records are removed, so a deleted account does not keep being billed. If that request cannot be completed at the time, the reference is kept for staff to cancel manually — the alternative would be losing the only record of which subscription to stop.</p>
                        <p>Refunds, chargebacks, and billing questions are covered in <a href="/purchases-and-refunds">Virtual Items, Purchases, and Refunds</a>.</p>
                    </>
                ),
            },
            {
                id: "storage-retention",
                title: "Browser storage, retention, and deletion",
                content: <>
                    <p>The game uses browser storage for sign-in, preferences, cached game state, and interrupted-session recovery. Details appear in the <a href="/cookies">Cookie and Local Storage Notice</a>.</p>
                    <p><strong>Guest characters are deleted automatically.</strong> A guest character has no password and no linked account, so it exists only in the browser that made it. If it goes fourteen days without being played, it and its save are deleted permanently and the name is released. Linking a Google account to it stops that clock immediately and makes it an ordinary account. Clearing your browser storage before you link one loses a guest character with no way to recover it — we hold nothing that could identify you as its owner.</p>
                    <p>Records are kept while needed to operate accounts, shared game systems, security, moderation, troubleshooting, and backups. IP and device records are kept for abuse investigation. Some shared records — clan history, leaderboard entries, chat other players have seen — may need to be anonymized rather than removed. Current deletion is handled by request and is complete only after connected records have been reviewed.</p>
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
        summary: "What you can buy, who takes the payment, how it is delivered, and how refunds and cancellations work.",
        sections: [
            {
                id: "what-is-sold",
                title: "What is sold",
                content: (
                    <>
                        <p>The Premium Shop sells <strong>Fate Shards</strong>, a virtual currency spent in game, and <strong>Shinobi Supporter</strong>, a monthly subscription. Prices are shown before you pay, and the exact amount in your own currency — including any tax — is confirmed by the checkout before the payment is taken.</p>
                        <p>Everything Fate Shards buy can also be earned by playing. Shinobi Supporter grants convenience and cosmetic benefits — a larger jutsu loadout, an extra pet and bloodline slot, and a custom avatar — and grants no combat advantage.</p>
                    </>
                ),
            },
            {
                id: "who-you-pay",
                title: "Who takes the payment",
                content: <p>Payments are processed by <strong>Tebex</strong>, who act as the merchant of record. Your card and billing details are entered on Tebex's checkout and are handled by Tebex and their payment processors; Shinobi Journey never receives or stores them. Your purchase contract for the payment itself is with Tebex, and their terms and privacy policy apply to it alongside these terms.</p>,
            },
            {
                id: "delivery",
                title: "Delivery",
                content: <p>Purchases are credited automatically to the account you were signed in as when you started checkout, usually within a few seconds of the payment clearing. There is no code to redeem and no account name to type — the account is identified from your session, so a purchase cannot be delivered to the wrong player by mistyping. If a purchase has not appeared after a few minutes, return to the Premium Shop and use the balance check there before buying again.</p>,
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
                id: "refunds",
                title: "Refunds",
                content: (
                    <>
                        <p>No blanket “no refunds” rule is stated here. Because Tebex is the merchant of record, refund requests go to Tebex under their process, and are handled together with the terms shown at purchase and whatever your local law requires — including any statutory right to cancel a digital purchase, which these terms do not override.</p>
                        <p>If a payment succeeded but the items never arrived, that is a delivery failure rather than a refund question: contact staff with your player name and the approximate time, and the purchase can be credited from the payment record.</p>
                        <p>Fraud, chargebacks, reversed payments, and delivery disputes may lead to a temporary restriction while records are reviewed. Shards already spent are not clawed back automatically.</p>
                    </>
                ),
            },
            {
                id: "subscription",
                title: "Subscription terms",
                content: (
                    <>
                        <p>Shinobi Supporter renews monthly until cancelled. You can cancel at any time through Tebex, using the receipt they email you; cancelling stops future renewals and the benefits continue until the end of the period you have already paid for.</p>
                        <p><strong>Deleting your account cancels the subscription.</strong> Account deletion asks Tebex to end the recurring payment before your records are removed, so a deleted account is not left being billed. If that request fails at the time, the reference is kept so staff can cancel it manually — tell staff if you are ever charged after deleting.</p>
                    </>
                ),
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
                    <li><strong>Guest characters:</strong> a guest character's only credential is a random key held in this browser's storage. It is what signs you back in, it is not shared with anyone, and clearing it loses that character permanently.</li>
                    <li><strong>Google sign-in:</strong> a short-lived random value is held for the length of one sign-in attempt so a completed sign-in can be matched to the browser that started it. It is discarded as soon as the attempt finishes.</li>
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
                title: "Notice, not a consent gate",
                content: <p>New visitors see a short notice that the game stores data on the device for sign-in and gameplay, with a link to this page. Because that storage is strictly necessary, the notice is informational and there is nothing here to opt out of — the game uses no advertising or third-party tracking cookies. If optional analytics or advertising storage is ever introduced, it must be gated behind consent before loading where consent is required, and this notice must be updated.</p>,
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
                    <p>Send a copyright notice by email to <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a>, or privately through the official community link on the main page. Do not post personal contact details in a public channel. Include:</p>
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
                content: <p>Copyright and DMCA notices may be sent to <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a>. Any registered United States DMCA designated-agent details, once filed with the U.S. Copyright Office, will be published here.</p>,
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
                content: <>
                    <p>You can delete your own account at any time without contacting anyone &mdash; see <a href="/delete-account">Delete Your Account</a> for the steps and for exactly what is removed.</p>
                    <p>Clearing browser storage or deleting a local login reference does not delete the server account. A deletion request is complete only after credentials, active sessions, the player save, public profile references, connected social records, uploaded content, and relevant security indexes have been reviewed for deletion or appropriate anonymization.</p>
                </>,
            },
            {
                id: "safety",
                title: "Request safety",
                content: <p>Staff will not ask you to publish a password or authentication token. Requests may be paused when identity cannot be verified or when fulfilling them would expose another player's private information, undermine service security, or conflict with a lawful retention duty.</p>,
            },
        ],
    },
    "delete-account": {
        shortTitle: "Delete Account",
        title: "Delete Your Account",
        summary: "How to permanently delete your Shinobi Journey account and what is removed.",
        sections: [
            {
                id: "in-game",
                title: "Delete it yourself, in the game",
                content: <>
                    <p>This is the fastest route and needs no one's help. Sign in, open your <strong>Profile</strong>, and choose <strong>Delete Character</strong>. You will be asked to confirm twice, and accounts with a password must re-enter it, so the action cannot happen by accident.</p>
                    <p>Deletion is immediate and permanent. There is no undo, no grace period, and no way for staff to restore the account afterwards.</p>
                </>,
            },
            {
                id: "cannot-sign-in",
                title: "If you cannot sign in",
                content: <>
                    <p>Email <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a> from an address connected to the account, or contact staff privately through the official community link on the main page, and state that you want your account deleted. Include your player name.</p>
                    <p>Verification is required before anything is deleted, so that no one can erase another player's account. Never send a password, session token, or identity document in a public channel &mdash; staff will never ask for one.</p>
                </>,
            },
            {
                id: "what-is-deleted",
                title: "What is deleted",
                content: <>
                    <p>Deleting the account removes your sign-in credentials, any linked Google sign-in, your recovery code, your character save, your friends list, and your entry in the public player directory. Your membership is removed from any clan roster, and existing sign-in sessions are invalidated so no previously issued token keeps working.</p>
                    <p>Clearing your browser storage, or removing the app, does <strong>not</strong> delete the server account &mdash; only the steps above do.</p>
                </>,
            },
            {
                id: "what-remains",
                title: "What may remain for a limited time",
                content: <p>Content that is part of another player's record can outlive the account: messages you sent to others, shared battle and chat history, clan and war outcomes, and moderation or security evidence. Backups are retained on their normal schedule before ageing out. Where this material is kept, it is kept because deleting it would erase another player's history or remove evidence of abuse, and it is anonymized or aged out rather than kept indefinitely. See <a href="/privacy-request">Privacy Requests</a> for the wider set of data rights.</p>,
            },
        ],
    },
    notices: {
        shortTitle: "Notices",
        title: "Additional Notices",
        summary: "Who runs the service and how to reach us, plus accessibility, families, third-party notices, AI content, and security reporting.",
        sections: [
            {
                id: "provider-contact",
                title: "Provider and contact",
                content: <>
                    <p>Shinobi Journey is an independent browser game. For account, legal, privacy, copyright, or safety matters, contact the operator by email at <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a>, or privately through the official community link on the main page.</p>
                    <p>Email is the direct contact point for formal notices; community channels are for general help. Please do not put passwords, session tokens, or identity documents in any public channel.</p>
                </>,
            },
            {
                id: "accessibility",
                title: "Accessibility",
                content: <p>We want the game to be usable by as many players as possible and treat the WCAG 2.1 AA guidelines as our target. Accessibility is a work in progress and some features are inherently visual. If you hit a barrier that stops you playing, email <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a> with what you were trying to do, and we will try to help or improve it.</p>,
            },
            {
                id: "children",
                title: "Children and families",
                content: <p>Shinobi Journey is intended for players aged 13 and older and is not directed to children under 13 — see the <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>. We aim to collect as little as the game needs: there is no advertising and no third-party tracking, product analytics are aggregate-only, and an email address is never required — it is collected only if you choose to sign in with Google. Playing does require processing your IP address and a browser-derived device fingerprint, which we use for security and abuse investigation and which may count as personal information where you live; the <a href="/privacy">Privacy Policy</a> sets out what is kept and why. We do not knowingly collect personal information from children under 13.</p>,
            },
            {
                id: "third-party-notices",
                title: "Third-party software and fonts",
                content: <>
                    <p>Shinobi Journey includes open-source components. Their licences are honoured and their notices are preserved.</p>
                    <p><strong>Roboto</strong> — Copyright 2011 Google Inc., used under the Apache License 2.0. It renders the label on the "Sign in with Google" button, whose branding guidelines call for that typeface. The font is served from this site rather than from Google's font service, so displaying it sends nothing to a third party. The full licence ships with the game at <a href="/fonts/roboto-LICENSE.txt">/fonts/roboto-LICENSE.txt</a>.</p>
                    <p>The Google "G" mark on that button is a trademark of Google LLC, reproduced under Google's Sign in with Google branding guidelines. Shinobi Journey is not affiliated with, endorsed by, or sponsored by Google.</p>
                </>,
            },
            {
                id: "ai-content",
                title: "AI-generated content",
                content: <p>Some artwork may be generated with AI image tools from text prompts. Where player-facing generation is enabled, prompts are filtered for family-friendly, non-infringing content and remain subject to the provider's own safety systems. Where the law requires AI-generated media to be labeled as such, we will label it. Report any generated content that looks harmful or infringing using the in-game report control or the contact email above.</p>,
            },
            {
                id: "security",
                title: "Security and responsible disclosure",
                content: <>
                    <p>If you find a security vulnerability, please report it privately to <a href="mailto:support@shinobijourney.com">support@shinobijourney.com</a> and give us a reasonable chance to fix it before sharing it publicly. While testing, do not access other players' data, degrade the service, or use the issue for in-game advantage.</p>
                    <p>A machine-readable contact is published at <a href="/.well-known/security.txt">/.well-known/security.txt</a>. We appreciate good-faith reports and will not pursue researchers who follow this policy.</p>
                </>,
            },
        ],
    },
};

// The heading and summary of each document, without rendering it. The build
// step that writes a static copy of these pages (scripts/prerender-legal.mts)
// needs a real <title> and meta description for each one, and those are the
// only two things a crawler that does not run JavaScript reads before the body.
// Exported from a component file, which costs this file fast refresh. Moving it
// out would mean moving `documents` — the entire published wording — out with
// it, and the wording belongs next to the component that renders it.
// eslint-disable-next-line react-refresh/only-export-components
export const LEGAL_DOCUMENT_META = Object.fromEntries(
    Object.entries(documents).map(([slug, doc]) => [slug, { title: doc.title, summary: doc.summary }]),
) as Record<LegalPageSlug, { title: string; summary: string }>;

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
