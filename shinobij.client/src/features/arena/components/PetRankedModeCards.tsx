import { GiColiseum, GiCrossedSwords } from "../../../components/icons/LightweightGameIcons";
import coliseumLadderImg from "../../../assets/coliseum/coliseum-bg.webp";
import tacticalLadderImg from "../../../assets/warfront-rite/warfront-rite-keyart.webp";
import { TACTICAL_ARENA_PET_REQUIREMENT } from "../../../lib/pet";

type PetRankedMode = "coliseum" | "tactical";

export function PetRankedModeCards({ availablePetCount, onOpenPetLadder }: {
    availablePetCount: number;
    onOpenPetLadder: (mode: PetRankedMode) => void;
}) {
    const cards = [
        { mode: "coliseum" as const, requirement: 4, img: coliseumLadderImg, emoji: <GiColiseum size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Pet Colosseum", sub: "2v2 live queue · two reserves · Pet Elo" },
        { mode: "tactical" as const, requirement: TACTICAL_ARENA_PET_REQUIREMENT, img: tacticalLadderImg, emoji: <GiCrossedSwords size={18} style={{ verticalAlign: "-0.12em" }} />, title: "Beastbound Warfront", sub: "4v4 offline ranked ladder" },
    ];
    return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, margin: "12px 0" }}>
        {cards.map((card) => {
            const needsPets = availablePetCount < card.requirement;
            const locked = card.mode === "coliseum" && needsPets;
            return <button key={card.mode} type="button"
                disabled={locked}
                title={locked ? `Locked: ${availablePetCount}/${card.requirement} available pets` : undefined}
                onClick={() => onOpenPetLadder(card.mode)}
                style={{ position: "relative", padding: 0, border: "1px solid rgba(244,196,81,.3)", borderRadius: 14, overflow: "hidden", cursor: locked ? "not-allowed" : "pointer", textAlign: "left", height: 132, background: "#11141f" }}>
                <img src={card.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: locked ? .32 : .85, filter: locked ? "grayscale(.75)" : undefined }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,10,18,.05), rgba(8,10,18,.85))" }} />
                <div style={{ position: "absolute", left: 14, right: 14, bottom: 12 }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: "#f7d98a", textShadow: "0 2px 8px #000" }}>{card.emoji} {card.title}</div>
                    <div style={{ fontSize: 12.5, color: "rgba(231,237,247,.9)", textShadow: "0 1px 5px #000" }}>
                        {locked ? `Locked · ${availablePetCount}/${card.requirement} available pets`
                            : card.mode === "tactical" && needsPets ? `View ladder · ${availablePetCount}/${card.requirement} ready to fight` : card.sub}
                    </div>
                </div>
            </button>;
        })}
    </div>;
}
