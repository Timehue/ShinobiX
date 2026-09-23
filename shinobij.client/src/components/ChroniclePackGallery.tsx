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

type PackListing = { type: CardPackType; name: string; note: string; count: number; cost: number; currency: "chroniclePoints" | "fateShards" };

const BASIC_PACKS: readonly PackListing[] = [
  { type: "standard", name: "Random Pack", note: "All elements, plus Jutsu and Snares", count: 5, cost: 100, currency: "chroniclePoints" },
  { type: "fire", name: "Fire Pack", note: "Fire Monsters only", count: 5, cost: 100, currency: "chroniclePoints" },
  { type: "water", name: "Water Pack", note: "Water Monsters only", count: 5, cost: 100, currency: "chroniclePoints" },
  { type: "earth", name: "Earth Pack", note: "Earth Monsters only", count: 5, cost: 100, currency: "chroniclePoints" },
  { type: "wind", name: "Wind Pack", note: "Wind Monsters only", count: 5, cost: 100, currency: "chroniclePoints" },
  { type: "lightning", name: "Lightning Pack", note: "Lightning Monsters only", count: 5, cost: 100, currency: "chroniclePoints" },
];

const PREMIUM_PACKS: readonly PackListing[] = [
  { type: "epic", name: "Elite Pack", note: "1 top-tier Rare or Epic card", count: 1, cost: 10, currency: "fateShards" },
  { type: "legendary", name: "Legendary Pack", note: "1 guaranteed Legendary card", count: 1, cost: 30, currency: "fateShards" },
];

const PACKS = [...BASIC_PACKS, ...PREMIUM_PACKS];

export function ChroniclePackGallery({ character, cardsById, onVersionedCharacter, onOpenEchoesOfWar }: {
  character: Character;
  cardsById: Record<string, ChronicleDisplayCard>;
  onVersionedCharacter: VersionedCharacterCommit;
  onOpenEchoesOfWar?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reveal, setReveal] = useState<{ nonce: string; type: CardPackType; cards: string[]; ownedBefore: Map<string, number> } | null>(null);
  const byType = useMemo(() => new Map(PACKS.map((pack) => [pack.type, pack])), []);
  const pending = (type: CardPackType) => hasPendingCardPackRequest(character.name, type);
  const costOf = (pack: PackListing) => pack.currency === "chroniclePoints"
    ? pack.cost
    : Math.max(1, Math.floor(pack.cost * (activeElderFocus(character) === "trade" ? 0.95 : 1)));
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
      if (!onVersionedCharacter(result.character, result._saveVersion)) return;
      setReveal({ nonce: makeId(), type: pack.type, cards: result.cards, ownedBefore });
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
          <span>{pack.currency === "chroniclePoints" ? "Common / Rare" : pack.type === "epic" ? "Rare / Epic" : "Legendary"}</span>
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
      <div className="chronicle-pack-gallery__section-head">
        <div><h3>Basic packs</h3><p>Five cards per pack · 100 Chronicle Points</p></div>
        {onOpenEchoesOfWar ? <button type="button" onClick={onOpenEchoesOfWar}>Earn points in Echoes of War →</button> : null}
      </div>
      <div className="chronicle-pack-gallery__grid">{BASIC_PACKS.map(renderPack)}</div>
      <div className="chronicle-pack-gallery__section-head chronicle-pack-gallery__section-head--premium">
        <div><h3>Premium packs</h3><p>Single-card pulls from the premium card pool</p></div>
      </div>
      <div className="chronicle-pack-gallery__grid chronicle-pack-gallery__grid--premium">{PREMIUM_PACKS.map(renderPack)}</div>
      <p className="chronicle-pack-gallery__odds">
        <strong>Pack odds:</strong> Elemental packs draw only matching-element Monsters. The Random Pack draws from every eligible Basic card, including Jutsu and Snares. Basic packs draw Common or Rare cards; Elite draws a Marketplace Rare or Epic; Legendary is always Legendary. Within each eligible pool, every playable card is equally likely. There are no weighted tiers or pity timer. Cards are drawn independently and may repeat until their deck copy limit is reached.
      </p>
      {reveal && revealPack ? <CardPackOpening
        key={reveal.nonce}
        packType={reveal.type}
        cards={reveal.cards}
        cardsById={cardsById}
        ownedBefore={reveal.ownedBefore}
        onClose={() => setReveal(null)}
        onOpenAnother={() => void open(revealPack)}
        openAnotherLabel={`${pending(reveal.type) ? "Recover pack" : "Open another"} · ${costOf(revealPack)} ${revealPack.currency === "chroniclePoints" ? "Chronicle Points" : "Fate Shards"}`}
        openAnotherDisabled={unavailable(revealPack)}
      /> : null}
    </section>
  );
}
