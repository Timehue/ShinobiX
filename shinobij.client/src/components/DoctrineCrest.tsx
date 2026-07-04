/*
 * Doctrine crest — the generated heraldic emblem for a clan's chosen doctrine,
 * shown wherever a doctrine appears (creation picker, hall, browse, rankings).
 * Falls back to the doctrine emoji for "none"/unknown so nothing ever renders empty.
 */
import { doctrineIcon, type ClanDoctrine } from "../lib/clan-doctrines";
import warmonger from "../assets/clan-doctrines/clan-doctrine-warmonger.webp";
import merchant from "../assets/clan-doctrines/clan-doctrine-merchant.webp";
import scholars from "../assets/clan-doctrines/clan-doctrine-scholars.webp";
import medics from "../assets/clan-doctrines/clan-doctrine-medics.webp";

const CRESTS: Partial<Record<ClanDoctrine, string>> = { warmonger, merchant, scholars, medics };

export function DoctrineCrest({ doctrine, size = 22 }: { doctrine?: ClanDoctrine; size?: number }) {
    const src = doctrine ? CRESTS[doctrine] : undefined;
    if (!src) return <span style={{ fontSize: size * 0.85 }}>{doctrineIcon(doctrine ?? "none")}</span>;
    return <img src={src} alt="" width={size} height={size} style={{ verticalAlign: "-0.28em", objectFit: "contain", display: "inline-block" }} />;
}
