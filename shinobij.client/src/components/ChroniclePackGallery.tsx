import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, VersionedCharacterCommit } from "../types/character";
import type { ChronicleDisplayCard } from "../lib/chronicle-duel";
import { ownedChronicleCounts } from "../lib/chronicle-duel";
import { activeElderFocus } from "../lib/village-elder-focus";
import { hasPendingCardPackRequest, openCardPack, type CardPackType } from "../lib/card-pack";
import { packArtUrl } from "../lib/card-pack-reveal";
import { requireServerSettlement } from "../lib/server-settlement-gate";
import { makeId } from "../lib/utils";
import { CardPackOpening } from "./CardPackOpening";

type PackRarity = "common" | "rare" | "epic" | "legendary";
/** `pool` and `rarities` publish the live server pool (api/card-clash/_pack.ts).
 *  The pool is server-only, so the numbers are static here and
 *  ChroniclePackGallery.test.ts fails until they match it: a drift is a
 *  player-facing lie about the odds. */
type PackListing = {
  type: CardPackType; name: string; note: string; count: number; cost: number; currency: "chroniclePoints" | "fateShards";
  pool: number; rarities: Partial<Record<PackRarity, number>>; mythic?: number;
};

const BASIC_PACKS: readonly PackListing[] = [
  { type: "standard", name: "Random Pack", note: "All elements, plus Jutsu and Snares", count: 5, cost: 100, currency: "chroniclePoints", pool: 125, rarities: { common: 55, rare: 70 } },
  { type: "fire", name: "Fire Pack", note: "Fire Monsters only", count: 5, cost: 100, currency: "chroniclePoints", pool: 13, rarities: { common: 8, rare: 5 } },
  { type: "water", name: "Water Pack", note: "Water Monsters only", count: 5, cost: 100, currency: "chroniclePoints", pool: 15, rarities: { common: 7, rare: 8 } },
  { type: "earth", name: "Earth Pack", note: "Earth Monsters only", count: 5, cost: 100, currency: "chroniclePoints", pool: 16, rarities: { common: 10, rare: 6 } },
  { type: "wind", name: "Wind Pack", note: "Wind Monsters only", count: 5, cost: 100, currency: "chroniclePoints", pool: 14, rarities: { common: 9, rare: 5 } },
  { type: "lightning", name: "Lightning Pack", note: "Lightning Monsters only", count: 5, cost: 100, currency: "chroniclePoints", pool: 15, rarities: { common: 6, rare: 9 } },
  { type: "snare", name: "Snare Pack", note: "Five Snares for traps, counters and combat tricks", count: 5, cost: 100, currency: "chroniclePoints", pool: 25, rarities: { common: 6, rare: 19 } },
  { type: "jutsu", name: "Jutsu Pack", note: "Five Jutsu cards for direct plays and setup", count: 5, cost: 100, currency: "chroniclePoints", pool: 27, rarities: { common: 9, rare: 18 } },
];

const PREMIUM_PACKS: readonly PackListing[] = [
  { type: "epic", name: "Elite Pack", note: "1 top-tier Rare or Epic card", count: 1, cost: 6, currency: "fateShards", pool: 76, rarities: { rare: 12, epic: 64 } },
  { type: "legendary", name: "Legendary Pack", note: "1 guaranteed Legendary card", count: 1, cost: 20, currency: "fateShards", pool: 60, rarities: { legendary: 60 }, mythic: 1 },
  { type: "epic-five", name: "Epic Quintet Pack", note: "5 random Epic cards · all five guaranteed Epic", count: 5, cost: 35, currency: "fateShards", pool: 64, rarities: { epic: 64 } },
  { type: "legendary-five", name: "Legendary Quintet Pack", note: "5 random Legendary cards · all five guaranteed Legendary", count: 5, cost: 100, currency: "fateShards", pool: 60, rarities: { legendary: 60 }, mythic: 1 },
];

const PACKS = [...BASIC_PACKS, ...PREMIUM_PACKS];

const RARITY_NAMES: Record<PackRarity, string> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
/** A share of the pool as a percentage with at most one decimal (44, 61.5). */
const poolShare = (cards: number, pool: number) => Math.round((1000 * cards) / pool) / 10;
const perCardRate = (pool: number) => Number((100 / pool).toFixed(2));

function raritySplit(pack: PackListing): string {
  const entries = Object.entries(pack.rarities) as Array<[PackRarity, number]>;
  if (entries.length === 1) {
    const [[rarity]] = entries;
    return pack.mythic ? `${RARITY_NAMES[rarity]} · ${pack.mythic} Mythic-tier` : RARITY_NAMES[rarity];
  }
  return entries.map(([rarity, cards]) => `${RARITY_NAMES[rarity]} ${poolShare(cards, pack.pool)}%`).join(" · ");
}

type PackConversion = { index: number; cardId: string; chroniclePoints: number; fateShards: number };

export function ChroniclePackGallery({ character, cardsById, onVersionedCharacter, onOpenEchoesOfWar }: {
  character: Character;
  cardsById: Record<string, ChronicleDisplayCard>;
  onVersionedCharacter: VersionedCharacterCommit;
  onOpenEchoesOfWar?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reveal, setReveal] = useState<{
    nonce: string; type: CardPackType; cards: string[]; ownedBefore: Map<string, number>;
    conversions: Map<number, PackConversion>;
  } | null>(null);
  const byType = useMemo(() => new Map(PACKS.map((pack) => [pack.type, pack])), []);
  const pending = (type: CardPackType) => hasPendingCardPackRequest(character.name, type);
  const costOf = (pack: PackListing) => pack.currency === "chroniclePoints"
    ? pack.cost
    : Math.max(1, Math.round(pack.cost * (activeElderFocus(character) === "trade" ? 0.95 : 1)));
  const balanceOf = (pack: PackListing) => pack.currency === "chroniclePoints"
    ? character.chroniclePoints ?? 0
    : character.fateShards ?? 0;
  const unavailable = (pack: PackListing) => busy || (!pending(pack.type) && balanceOf(pack) < costOf(pack));

  useEffect(() => {
    for (const pack of PACKS) new Image().src = packArtUrl(pack.type);
  }, []);

  async function open(pack: PackListing) {
    if (!requireServerSettlement("shopCardPack")) return;
    if (balanceOf(pack) < costOf(pack) && !pending(pack.type)) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const ownedBefore = ownedChronicleCounts(character.tileCards ?? []);
      const result = await openCardPack(character.name, pack.type);
      if (!result.ok || !result.character || !result.cards) {
        window.alert(result.error || "Could not open the card pack.");
        return;
      }
      // The pack is paid even if a newer save was adopted first and this commit
      // is refused as stale (the coordinator then reads the stored save back).
      onVersionedCharacter(result.character, result._saveVersion);
      // A copy past the 3-copy playset became points or shards on the server;
      // older servers send no `converted`, which reads as none.
      const conversions = new Map((result.converted ?? []).map((entry) => [entry.index, entry]));
      setReveal({ nonce: makeId(), type: pack.type, cards: result.cards, ownedBefore, conversions });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const renderPack = (pack: PackListing) => (
    <article className={`chronicle-pack chronicle-pack--${pack.type}`} key={pack.type}>
      <img className="chronicle-pack__art" src={packArtUrl(pack.type)} alt="" loading="lazy" />
      <div className="chronicle-pack__body">
        <div className="chronicle-pack__eyebrow">{pack.currency === "chroniclePoints" ? "CHRONICLE ARCHIVE" : "PREMIUM ARCHIVE"}</div>
        <h3>{pack.name}</h3>
        <p>{pack.note}</p>
        <div className="chronicle-pack__facts">
          <span>{pack.count} {pack.count === 1 ? "card" : "cards"}</span>
          <span>{raritySplit(pack)}</span>
          <span>{pack.pool} in pool · {perCardRate(pack.pool)}% each</span>
        </div>
        <button type="button" onClick={() => void open(pack)} disabled={unavailable(pack)}>
          {pending(pack.type) ? `Recover ${pack.name}` : `Open ${pack.name}`}
          <strong>{costOf(pack)} {pack.currency === "chroniclePoints" ? "Chronicle Points" : "Fate Shards"}</strong>
        </button>
      </div>
    </article>
  );

  const revealPack = reveal ? byType.get(reveal.type) : undefined;
  return (
    <section className="chronicle-pack-gallery" aria-labelledby="chronicle-pack-gallery-title">
      <div className="chronicle-pack-gallery__intro">
        <div>
          <span className="chronicle-pack-gallery__kicker">CARD HALL · PACK ARCHIVE</span>
          <h2 id="chronicle-pack-gallery-title">Choose your next draw</h2>
          <p>Focus on one element, or take a chance on the full Basic card pool.</p>
        </div>
        <div className="chronicle-pack-gallery__balances" aria-label="Pack balances">
          <span><strong>{character.chroniclePoints ?? 0}</strong> Chronicle Points</span>
          <span><strong>{character.fateShards ?? 0}</strong> Fate Shards</span>
          <span><strong>{character.tileCards?.length ?? 0}</strong> owned cards</span>
        </div>
      </div>
      <p className="chronicle-pack-gallery__odds">
        <strong>Pack odds:</strong> Elemental packs draw only matching-element Monsters. The Random Pack draws from every eligible Basic card, including Jutsu and Snares. Basic packs draw Common or Rare cards; Elite draws a Marketplace Rare or Epic; Legendary is always Legendary. Epic Quintet draws five Marketplace Epics; Legendary Quintet draws five Marketplace Legendaries. Within each eligible pool, every card is equally likely. There are no weighted tiers or pity timer. Each card is drawn independently from the full eligible pool, so duplicates can appear within a pack or across packs regardless of owned copies. A copy beyond your third of any card converts instead: Common and Rare cards give 5 Chronicle Points, Epic cards give 1 Fate Shard, and Legendary cards give 3 Fate Shards. Deck copy limits apply only when building a deck. The Legendary pool includes one Mythic-tier card, drawn at the same rate as every Legendary.
      </p>
      <div className="chronicle-pack-gallery__section-head">
        <div><h3>Basic packs</h3><p>Five cards per pack · 100 Chronicle Points</p></div>
        {onOpenEchoesOfWar ? <button type="button" onClick={onOpenEchoesOfWar}>Earn points in Echoes of War →</button> : null}
      </div>
      <div className="chronicle-pack-gallery__grid">{BASIC_PACKS.map(renderPack)}</div>
      <div className="chronicle-pack-gallery__section-head chronicle-pack-gallery__section-head--premium">
        <div><h3>Premium packs</h3><p>Single-card pulls and five-card rarity packs from the premium card pool</p></div>
      </div>
      <div className="chronicle-pack-gallery__grid chronicle-pack-gallery__grid--premium">{PREMIUM_PACKS.map(renderPack)}</div>
      {reveal && revealPack ? <CardPackOpening
        key={reveal.nonce}
        packType={reveal.type}
        cards={reveal.cards}
        cardsById={cardsById}
        ownedBefore={reveal.ownedBefore}
        conversions={reveal.conversions}
        onClose={() => setReveal(null)}
        onOpenAnother={() => void open(revealPack)}
        openAnotherLabel={`${pending(reveal.type) ? "Recover pack" : "Open another"} · ${costOf(revealPack)} ${revealPack.currency === "chroniclePoints" ? "Chronicle Points" : "Fate Shards"}`}
        openAnotherDisabled={unavailable(revealPack)}
      /> : null}
    </section>
  );
}
