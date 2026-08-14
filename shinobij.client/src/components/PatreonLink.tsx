import { useCallback, useEffect, useState } from 'react';
import type { Character } from '../types/character';
import { isPatreonSubscriber } from '../lib/entitlements';

/*
 * "Shinobi Supporter" account card — link a Patreon account and show
 * subscriber status + the perks it unlocks.
 *
 * The AUTHORITATIVE subscriber flag is character.patreon (server-owned, written
 * only by the signature-verified webhook / OAuth callback). This card reads that
 * flag for the badge and calls /api/patreon/status for the link state. Linking
 * is a top-level navigation to Patreon's OAuth consent (the server mints the
 * signed `state`); Patreon then bounces the browser back with ?patreon=...
 *
 * Degrades gracefully: if the backend is unconfigured (no PATREON_CLIENT_ID) it
 * falls back to a plain "Support on Patreon" link. Styling: styles/patreon-skin.css.
 */

const PATREON_PAGE = 'https://www.patreon.com/c/shinobijourney';

interface PatreonStatus {
    ok: boolean;
    configured: boolean;
    linked: boolean;
    active: boolean;
    tier: string;
    entitledCents: number;
    minCents: number;
}

interface Perk {
    label: string;
    detail: string;
    icon: React.ReactNode;
}

// Self-contained inline SVG chrome (no external icon deps), sized by CSS.
const ScrollIcon = (
    <svg className="patreon-benefit-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
);
const PawIcon = (
    <svg className="patreon-benefit-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <ellipse cx="12" cy="15.5" rx="4.3" ry="3.4" />
        <circle cx="6.8" cy="10.5" r="1.7" />
        <circle cx="12" cy="8.6" r="1.9" />
        <circle cx="17.2" cy="10.5" r="1.7" />
    </svg>
);
const MaskIcon = (
    <svg className="patreon-benefit-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <circle cx="12" cy="10" r="2.6" fill="currentColor" stroke="none" />
        <path d="M7.6 18c0.6-2.6 2.4-4 4.4-4s3.8 1.4 4.4 4" strokeLinecap="round" />
    </svg>
);
const DropletIcon = (
    <svg className="patreon-benefit-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3c3.3 4.1 5.5 6.9 5.5 9.7a5.5 5.5 0 0 1-11 0C6.5 9.9 8.7 7.1 12 3z" />
    </svg>
);

const PERKS: Perk[] = [
    { label: '15 Jutsu Slots', detail: 'up from 12', icon: ScrollIcon },
    { label: '6 Pet Companions', detail: 'up from 4', icon: PawIcon },
    { label: 'Custom Avatar', detail: 'upload your own', icon: MaskIcon },
    { label: '2 Bloodlines', detail: 'store & swap', icon: DropletIcon },
];

/** A gold shinobi seal: outer ring + four-point shuriken + center gem. */
function SupporterCrest() {
    return (
        <svg className="patreon-crest" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
            <circle cx="24" cy="24" r="17.5" stroke="currentColor" strokeWidth="0.9" opacity="0.28" />
            <path d="M24 7l3.4 13.6L41 24l-13.6 3.4L24 41l-3.4-13.6L7 24l13.6-3.4z" fill="currentColor" />
            <circle cx="24" cy="24" r="3.4" fill="var(--sj-void)" />
            <circle cx="24" cy="24" r="1.7" fill="currentColor" />
        </svg>
    );
}

const HeartIcon = (
    <svg className="patreon-cta-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
);

/** Read the OAuth callback bounce (?patreon=…) — available synchronously at
 *  mount, so it seeds initial state instead of a setState-in-effect. */
function initialNotice(): string | null {
    try {
        const p = new URLSearchParams(window.location.search).get('patreon');
        if (p === 'linked') return 'Patreon linked — your Shinobi Supporter perks are active!';
        if (p === 'linked_inactive') return 'Patreon linked. Subscribe on Patreon to unlock supporter perks.';
        if (p) return 'Could not link Patreon. Please try again.';
    } catch {
        /* no window — ignore */
    }
    return null;
}

export function PatreonLink({ character }: { character: Character }) {
    const playerName = character.name;
    const [status, setStatus] = useState<PatreonStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(initialNotice);

    // Fetch link/subscription status on mount. setState runs only AFTER the
    // await, so it is not a synchronous update inside the effect body.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const resp = await fetch(`/api/patreon/status?playerName=${encodeURIComponent(playerName)}`);
                if (cancelled || !resp.ok) return;
                const data = (await resp.json()) as PatreonStatus;
                if (!cancelled && data?.ok) setStatus(data);
            } catch {
                /* status is best-effort; the badge falls back to the save flag */
            }
        })();
        return () => { cancelled = true; };
    }, [playerName]);

    // Strip the ?patreon param after mount so a refresh doesn't replay the
    // notice. Side effect only — no setState here.
    useEffect(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            if (!params.get('patreon')) return;
            params.delete('patreon');
            const qs = params.toString();
            window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
        } catch {
            /* no window / history — ignore */
        }
    }, []);

    const startLink = useCallback(async () => {
        setBusy(true);
        setNotice(null);
        try {
            const resp = await fetch(`/api/patreon/oauth-start?playerName=${encodeURIComponent(playerName)}`);
            const data = await resp.json();
            if (resp.ok && data?.url) {
                window.location.href = data.url as string;
                return;
            }
            setNotice(String(data?.error ?? 'Patreon linking is unavailable right now.'));
        } catch {
            setNotice('Patreon linking is unavailable right now.');
        } finally {
            setBusy(false);
        }
    }, [playerName]);

    // Prefer the authoritative save flag; fall back to the status endpoint.
    const active = isPatreonSubscriber(character) || status?.active === true;
    const configured = status?.configured !== false; // treat unknown as configured
    const linked = status?.linked === true;
    const noticeIsError = !!notice && /could not|unavailable/i.test(notice);

    return (
        <div className={`patreon-card${active ? ' is-active' : ''}`}>
            <div className="patreon-head">
                <SupporterCrest />
                <div className="patreon-titles">
                    <h3 className="patreon-title">Shinobi Supporter</h3>
                    <span className="patreon-subtitle">
                        {active ? 'Membership active' : 'Patreon membership'}
                    </span>
                </div>
                {active && <span className="patreon-pill">★ Active</span>}
            </div>

            <div className="patreon-benefits">
                {PERKS.map((perk) => (
                    <div className="patreon-benefit" key={perk.label}>
                        {perk.icon}
                        <span><strong>{perk.label}</strong><small>{perk.detail}</small></span>
                    </div>
                ))}
            </div>

            {active ? (
                <div className="patreon-actions">
                    <p className="patreon-note">Thank you for supporting Shinobi Journey — every perk above is unlocked.</p>
                    <a className="patreon-manage" href={PATREON_PAGE} target="_blank" rel="noopener noreferrer">Manage on Patreon ↗</a>
                </div>
            ) : !configured ? (
                <a className="patreon-fallback" href={PATREON_PAGE} target="_blank" rel="noopener noreferrer">
                    {HeartIcon} Support development on Patreon →
                </a>
            ) : (
                <div className="patreon-actions">
                    <button className="patreon-cta" onClick={() => void startLink()} disabled={busy}>
                        {HeartIcon}
                        {busy ? 'Opening Patreon…' : linked ? 'Re-check membership' : 'Link Patreon to unlock'}
                    </button>
                    <p className="patreon-note">
                        {linked
                            ? 'Linked, but no active membership was found. Subscribe on Patreon to unlock these perks.'
                            : 'Link your Patreon account to unlock these supporter perks.'}
                    </p>
                </div>
            )}

            {notice && <p className={`patreon-note${noticeIsError ? ' is-error' : ''}`}>{notice}</p>}
        </div>
    );
}
