import { useEffect, useRef, useState } from "react";
import { requestAiFight } from "../../lib/ai-fight-request";
import { exploreAmbushFightRequest } from "../../lib/road-flee-api";
import { openAncientChest, recordSectorExplore, worldRewardFailureMessage, type SectorExploreResult } from "../../lib/world-reward-api";
import { beginResolvedWorldExplore, beginWorldChestOperation, settleWorldRewardOperation } from "../../lib/world-reward-operations";
import { readPendingWorldRewards } from "../../lib/world-reward-recovery";
import type { Character, VersionedCharacterCommit } from "../../types/character";

const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ");
type Ambush = NonNullable<SectorExploreResult["pendingBattle"]>;

export default function CoastExplore({ character, sector, commit, disabled }: {
    character: Character; sector: number; commit: VersionedCharacterCommit; disabled: boolean;
}) {
    const name = character.name;
    const savedChest = () => readPendingWorldRewards(name).find(row => row.kind === "chest" && row.sector === sector)?.worldExploreRequestId;
    const [chest, setChest] = useState(savedChest);
    const [ambush, setAmbush] = useState<Ambush | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true), running = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function act() {
        if (running.current || disabled) return;
        running.current = true;
        setBusy(true);
        try {
            const source = chest || savedChest();
            if (source) {
                const receipt = beginWorldChestOperation(name, sector, source);
                const result = await openAncientChest(name, sector, receipt.id, source);
                if (!result.character || !result.loot) {
                    if (mounted.current) setMessage(worldRewardFailureMessage(result, "chest"));
                    return;
                }
                commit(result.character, result.saveVersion);
                settleWorldRewardOperation(name, receipt.id);
                settleWorldRewardOperation(name, source);
                if (mounted.current) {
                    setChest(undefined);
                    const loot = Object.entries(result.loot).filter(([key, value]) => value && key !== "duplicateSaleRyo")
                        .map(([key, value]) => typeof value === "number" ? value + " " + (key === "xp" ? "XP" : label(key)) : label(String(value)));
                    setMessage("The Ancient Chest held " + loot.join(", ") + ".");
                }
                return;
            }
            const operation = beginResolvedWorldExplore(name, sector);
            const result = await recordSectorExplore(name, sector, "tile", operation.id, { resolveOutcome: true });
            if (result.character) commit(result.character, result.saveVersion);
            if (result.pendingBattle || result.outcome?.kind === "battle") {
                const battle = result.pendingBattle ?? { sector, requestId: operation.id, encounter: result.outcome?.kind === "battle" ? result.outcome.encounter : undefined };
                if (result.pendingBattle && battle.requestId !== operation.id) settleWorldRewardOperation(name, operation.id);
                if (mounted.current) { setAmbush(battle); setMessage((battle.encounter?.displayName ?? "An Unmoored ambusher") + " blocks your way."); }
            } else if (!result.character) {
                if (result.retryable === false) settleWorldRewardOperation(name, operation.id);
                if (mounted.current) setMessage(worldRewardFailureMessage(result));
            } else if (result.outcome?.kind === "chest") {
                beginWorldChestOperation(name, sector, operation.id);
                if (mounted.current) { setChest(operation.id); setMessage("You found an Ancient Chest."); }
            } else {
                settleWorldRewardOperation(name, operation.id);
                const reward = result.reward;
                if (mounted.current) setMessage(reward ? "You found " + reward.xp + " XP and " + reward.ryo + " ryo." : "You searched this stretch of coast and found nothing.");
            }
        } finally { running.current = false; if (mounted.current) setBusy(false); }
    }
    return <div className="coast-explore-control">
        {ambush ? <button type="button" className="sector-hud-explore" disabled={disabled} onClick={() => {
            if (requestAiFight(exploreAmbushFightRequest(ambush.sector, ambush.requestId, character.level, ambush.encounter))) {
                settleWorldRewardOperation(name, ambush.requestId);
            } else setMessage("The fight could not start. Try again.");
        }}>Fight {ambush.encounter?.displayName ?? "the ambusher"}</button>
        : <button type="button" className="sector-hud-explore" disabled={busy || disabled} onClick={() => void act()}><span>{busy ? "Searching…" : chest ? "Open Ancient Chest" : "Explore"}</span><small>Search this sector</small></button>}
        {message && <p role="status">{message}</p>}
    </div>;
}

