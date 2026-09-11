/** Development-only harness for the production ladder and ranked entry card.
 * Network fixtures belong to the Playwright script; this page cannot alter an
 * actual account. It is not a production build input. */
import { createRoot } from "react-dom/client";
import { lazy, Suspense, useState } from "react";
import { PetLadder } from "./screens/PetLadder";
const ArenaDistrictLobby = lazy(() => import("./features/arena/components/ArenaDistrictLobby").then((module) => ({ default: module.ArenaDistrictLobby })));
import { rawPetPool } from "./data/pet-pool";
import type { Character } from "./types/character";
import type { Pet } from "./types/pet";
import "./index.css";

if (!import.meta.env.DEV && import.meta.env.MODE !== "warfront-qa") throw new Error("This fixture is only available in development or the isolated QA build.");

const elements = ["Fire", "Water", "Wind", "Earth"];
const pets = elements.map((element, index) => {
    const template = (element === "Wind" ? rawPetPool.find((pet) => pet.name === "Tempest Hawk") : null)
        ?? rawPetPool.find((pet) => pet.element === element)!;
    return { ...template, id: `qa-${index}`, templateId: template.id, level: 30, xp: 0, maxLevel: 100, unlockedForPve: true } as Pet;
});
const character = { name: "Warfront QA", level: 30, pets } as Character;
sessionStorage.setItem("petLadder.mode", "tactical");
const noop = () => undefined;
function WarfrontLadderQa() {
    const [district, setDistrict] = useState(() => new URLSearchParams(window.location.search).get("district") === "1");
    const [account, setAccount] = useState(character);
    const [, rerender] = useState(0);
    return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 0", minHeight: "100vh", background: "#0b101a" }}>
        <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAccount({ ...character, name: "Second QA" })}>Switch QA account</button>
            <button onClick={() => rerender((value) => value + 1)}>Rerender QA account</button>
        </div>
        <output id="qa-pets" hidden>{JSON.stringify(pets)}</output>
        {district ? <Suspense fallback={<p>Loading district fixture…</p>}><ArenaDistrictLobby character={account} activeTab="petBattles" hasAvailablePet availablePetCount={4}
            opponentClanData={null} clanWarOpponents={[]} incomingClanWarChallenges={[]} arenaTournament={null}
            tournamentRemaining={0} matchRemaining={0} isAdminTournamentManager={false} playerRankedEnabled={false}
            rankedQueueActive={false} rankedQueueSize={0} spectatorFights={[]} pendingSpectatorChallenges={[]}
            onBack={noop} onTabChange={noop} onChallengePlayer={noop} onAcceptDistrictChallenge={noop}
            onDeclineChallenge={noop} onAdvanceTournamentPlayer={noop} onDeclareTournamentWinner={noop}
            tournamentWinnerBusy={false} onClearTournament={noop} onStartTournament={noop} onJoinRankedQueue={noop}
            onLeaveRankedQueue={noop} onRefreshFights={noop} onSpectateFight={noop} onViewPendingChallenge={noop}
            onOpenPetLadder={(mode) => { sessionStorage.setItem("petLadder.mode", mode); setDistrict(false); }} /></Suspense>
            : <PetLadder character={account} setScreen={() => setDistrict(true)} sharedImages={{}} onVersionedCharacter={() => false} />}
    </main>
    );
}

createRoot(document.getElementById("root")!).render(<WarfrontLadderQa />);
