import type { ReactNode } from "react";
import type { Character } from "../types/character";
import type { BountyEntry } from "../lib/pvp-bounty";
import { buildReputationProfile, type ReputationBadge } from "../lib/reputation-profile";
import { titleStyleColor } from "../lib/legacy";

type ShinobiIdentityCardProps = {
    character: Character;
    avatarSrc?: string;
    avatarClassName?: string;
    bloodlineName?: string;
    bounty?: BountyEntry | null;
    elements?: string[];
    heading?: string;
    summary?: string;
    extraChips?: ReputationBadge[];
    avatarAction?: ReactNode;
};

export function ShinobiIdentityCard({
    character,
    avatarSrc,
    avatarClassName = "",
    bloodlineName,
    bounty,
    elements = [],
    heading = "Shinobi Identity",
    summary,
    extraChips = [],
    avatarAction,
}: ShinobiIdentityCardProps) {
    const profile = buildReputationProfile(character, { bloodlineName, bounty, elements });
    const identityChips = [...profile.identityChips, ...extraChips];
    const initials = character.name.slice(0, 2).toUpperCase();
    const legacyStage = Math.min(5, character.legacy?.stage ?? 0);
    const avatarClasses = [
        "sic-avatar",
        avatarClassName,
        legacyStage >= 2 ? `legacy-aura-s${legacyStage}` : "",
    ].filter(Boolean).join(" ");

    return (
        <section className="shinobi-identity-card" aria-label={`${character.name} identity and reputation`}>
            <div className="sic-hero">
                <div className="sic-avatar-stack">
                    <div className={avatarClasses}>
                        {avatarSrc ? (
                            <img
                                src={avatarSrc}
                                alt={`${character.name} avatar`}
                                onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = "none"; }}
                            />
                        ) : (
                            <span>{initials}</span>
                        )}
                    </div>
                    {avatarAction ? <div className="sic-avatar-action">{avatarAction}</div> : null}
                </div>
                <div className="sic-copy">
                    <p className="sic-kicker">{heading}</p>
                    <div className="sic-name-row">
                        <h3>{character.name}</h3>
                        {character.customTitle && (
                            <span className="sic-title" style={{ color: titleStyleColor(character.customTitleStyle) }}>
                                {character.customTitleIcon ? `${character.customTitleIcon} ` : ""}{character.customTitle}
                            </span>
                        )}
                    </div>
                    <p className="sic-subtitle">{profile.subtitle}</p>
                    {summary ? <p className="sic-summary">{summary}</p> : null}
                    <div className="sic-chip-row">
                        {identityChips.slice(0, 11).map((chip) => (
                            <span className={`sic-chip sic-tone-${chip.tone ?? "neutral"}`} key={chip.id}>
                                {chip.label}{chip.detail ? <small>{chip.detail}</small> : null}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div className="sic-stat-grid">
                {profile.metrics.map((metric) => (
                    <div className={`sic-stat sic-tone-${metric.tone ?? "neutral"}`} key={metric.id}>
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                        {metric.detail ? <small>{metric.detail}</small> : null}
                    </div>
                ))}
            </div>

            <div className="sic-footer-grid">
                <div className="sic-ledger">
                    <p className="sic-section-label">Titles and Badges</p>
                    {profile.titleBadges.length > 0 ? (
                        <div className="sic-badge-row">
                            {profile.titleBadges.slice(0, 8).map((badge) => (
                                <span className={`sic-badge sic-tone-${badge.tone ?? "neutral"}`} key={badge.id}>
                                    {badge.label}{badge.detail ? <small>{badge.detail}</small> : null}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="sic-empty">No public titles recorded yet.</p>
                    )}
                </div>
                <div className="sic-ledger">
                    <p className="sic-section-label">Rivalry</p>
                    <strong className={profile.rivalry.kind === "npc" ? "sic-rival-active" : ""}>{profile.rivalry.label}</strong>
                    <small>{profile.rivalry.detail}</small>
                </div>
            </div>
        </section>
    );
}
