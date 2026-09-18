import { useEffect, useState } from "react";
import vanguardBg from "../../assets/professions/vanguard.webp";
import arenaArt from "../../assets/facilities/battle-arena.webp";
import mapArt from "../../assets/facilities/world-map.webp";
import targetArt from "../../assets/towers/story/escort-vanguard.webp";
import raidArt from "../../assets/clan-hall/clan-hall-fortress.webp";
import sealsArt from "../../assets/clan-exchange/honorSealBundle.webp";
import { ProfessionHero } from "../../components/ProfessionHero";
import { MasteryPanel } from "../../components/MasteryPanel";
import { ProfessionRankBar } from "../ProfessionRankBar";
import { DailyProfessionMissions } from "../DailyProfessionMissions";
import { ProfessionDestination, ProfessionSectionHeading } from "./ProfessionHubUI";
import { VANGUARD_SEALS_PER_KILL, VANGUARD_PER_TARGET_DAILY_CAP, PROFESSION_MAX_RANK } from "../../constants/profession";
import { vanguardDailySealProgress } from "../../lib/profession-bonuses";
import { serverNow } from "../../lib/server-clock";
import { visiblePoll } from "../../lib/poll";
import type { Character, Screen } from "../../App";
import type { VersionedCharacterCommit } from "../../types/character";
import { useCapabilityViewAvailability } from "../../lib/live-capabilities-context";
import { capabilityAdmissionAllowed, sectorMapAdmissionMessage } from "../../lib/live-capability-admission";

export function VanguardHub({ character, onVersionedCharacter, setScreen, onBack }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; setScreen: (s: Screen) => void; onBack: () => void;
}) {
    const availability = useCapabilityViewAvailability("villageWar");
    const sectorMapOpen = capabilityAdmissionAllowed(availability);
    const rank = Math.max(1, Math.min(PROFESSION_MAX_RANK, character.professionRank ?? 1));
    const [todayKey, setTodayKey] = useState(() => new Date(serverNow()).toISOString().slice(0, 10));
    useEffect(() => visiblePoll(() => setTodayKey(new Date(serverNow()).toISOString().slice(0, 10)), 30_000, 0, { immediate: true }), []);
    const { earned: sealsToday, cap: dailyCap } = vanguardDailySealProgress(character, todayKey);
    const cappedSeals = Math.min(dailyCap, sealsToday);

    return <div className="profession-hub profession-hub-vanguard ph-hub">
        <ProfessionHero image={vanguardBg} title="Vanguard" tagline="Lead the charge." chapter="The frontline / Vanguard command" description="Win your battles. Earn your honor. Hold the line." village={character.village} onBack={onBack} />
        <div className="ph-body">
            <ProfessionRankBar character={character} headquarters />
            <section className="ph-panel ph-honor" aria-label="Honor Seal economy">
                <div className="ph-honor-balance"><img src={sealsArt} alt="" /><div><span className="ph-eyebrow">Honor Seals</span><strong>{(character.honorSeals ?? 0).toLocaleString()}</strong><span>Your spoils of battle</span></div></div>
                <div className="ph-honor-ledger">
                    <div className="ph-honor-rate"><span>Base victory reward</span><strong>{VANGUARD_SEALS_PER_KILL[rank]} <small>Seals</small></strong></div>
                    <div className="ph-meter-label"><span>Earned today</span><strong>{sealsToday} <span>/ {dailyCap}</span></strong></div>
                    <div className="profession-progress-track ph-meter" role="progressbar" aria-label="Daily Honor Seal progress" aria-valuemin={0} aria-valuemax={dailyCap} aria-valuenow={cappedSeals}><span style={{ width: `${cappedSeals / dailyCap * 100}%` }} /></div>
                    <p className="ph-note">Up to {VANGUARD_PER_TARGET_DAILY_CAP} Seals per target each day. Only qualifying real-player kills count.</p>
                </div>
            </section>
            <section aria-label="Vanguard destinations">
                <ProfessionSectionHeading eyebrow="Deployment" title="Take the field" detail="Choose your next battle" />
                <div className="ph-destinations">
                    <ProfessionDestination image={targetArt} title="Find a Target" description="Challenge a rival shinobi" onClick={() => setScreen("userHub")} featured />
                    <ProfessionDestination image={raidArt} title="Raid a Village" description="Join the village war effort" onClick={() => setScreen("villageWar")} />
                    <ProfessionDestination image={mapArt} title="Sector Map" description="Survey the contested territories" onClick={() => setScreen("villageWarMap")} disabled={!sectorMapOpen} status={!sectorMapOpen ? sectorMapAdmissionMessage(availability) : undefined} />
                    <ProfessionDestination image={arenaArt} title="Arena District" description="Enter the competitive arenas" onClick={() => setScreen("arenaDistrict")} />
                </div>
            </section>
            <section className="ph-panel" aria-label="Honor Seals earned per win by profession rank">
                <ProfessionSectionHeading eyebrow="Rank rewards" title="The price of victory" detail="Base Seals per win" />
                <ol className="profession-rank-ladder ph-rank-ladder">{Array.from({ length: PROFESSION_MAX_RANK }, (_, i) => i + 1).map(r => <li key={r} className={r === rank ? "is-current" : r < rank ? "is-earned" : ""} aria-current={r === rank ? "step" : undefined}><span>Rank {r}</span><strong>{VANGUARD_SEALS_PER_KILL[r]}</strong><small>{r === rank ? "Current" : r < rank ? "Reached" : "Seals"}</small></li>)}</ol>
            </section>
            <DailyProfessionMissions character={character} headquarters />
            <MasteryPanel character={character} onVersionedCharacter={onVersionedCharacter} headquarters />
        </div>
    </div>;
}
