import { useEffect, useId, useMemo, useState } from "react";
import type { Character } from "../types/character";
import { cwListWars, sharedClanWarCache, type CwWar } from "../lib/clan-war-api";
import {
    endedVillageWarRecordsFor,
    loadVillageState,
    loadWarStandings,
} from "../lib/world-state";
import "../styles/living-chronicle-spine.css";
import "../styles/story-living-chronicle.css";

type PersonalChronicleRecord = {
    id: string;
    icon: string;
    title: string;
    detail: string;
};

const LEGACY_STAGE_LABELS = ["", "accepted", "awakened", "bound", "proven", "raised to mythic"] as const;

function count(value: number | undefined): number {
    return Math.max(0, Math.floor(Number(value ?? 0)));
}

function titleFromId(value: string): string {
    return value
        .replace(/^legacy-/, "")
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ");
}

function personalChronicleRecords(character: Character): PersonalChronicleRecord[] {
    const records: PersonalChronicleRecord[] = [];
    const village = character.storyVillage || character.village;
    const chapters = count(character.storyProgress);
    if (chapters > 0) {
        records.push({
            id: "story",
            icon: "📖",
            title: `${chapters.toLocaleString()} story chapter${chapters === 1 ? "" : "s"} completed`,
            detail: `${village} remembers the road you took and the decisions you left behind.`,
        });
    }

    const storyCards = character.tileCards.filter((id) => id.startsWith("story-")).length;
    const witnessCards = character.tileCards.filter((id) => id.startsWith("pet-witness-")).length;
    const legacyCards = character.tileCards.filter((id) => id.startsWith("legacy-")).length;
    const pressedRecords = storyCards + witnessCards + legacyCards;
    if (pressedRecords > 0) {
        records.push({
            id: "pressed-records",
            icon: "🎴",
            title: `${pressedRecords.toLocaleString()} earned record${pressedRecords === 1 ? "" : "s"} pressed`,
            detail: `${storyCards} story · ${witnessCards} living witness · ${legacyCards} Legacy`,
        });
    }

    if (character.legacy) {
        const stage = LEGACY_STAGE_LABELS[character.legacy.stage] || "recognized";
        records.push({
            id: "legacy",
            icon: "✦",
            title: `${titleFromId(character.legacy.legacyId)} ${stage}`,
            detail: "The Sage recognized a pattern you freely chose to repeat.",
        });
    }

    const showdownWins = count(character.cardClashWins);
    if (showdownWins > 0) {
        records.push({
            id: "showdown",
            icon: "⚔️",
            title: `${showdownWins.toLocaleString()} Chronicle Showdown ${showdownWins === 1 ? "victory" : "victories"}`,
            detail: "You defended the record at the card table.",
        });
    }

    const petWins = count(character.totalPetWins);
    if (petWins > 0) {
        records.push({
            id: "companions",
            icon: "🐾",
            title: `${petWins.toLocaleString()} companion ${petWins === 1 ? "victory" : "victories"}`,
            detail: "The arena remembers the beasts that carried your banner.",
        });
    }

    const warWins = count(character.warsWon);
    const warMvps = count(character.warMvpCount);
    const warDamage = count(character.lifetimeWarDamage);
    if (warWins > 0 || warMvps > 0 || warDamage > 0) {
        records.push({
            id: "war-service",
            icon: "🏯",
            title: `${warWins.toLocaleString()} war ${warWins === 1 ? "victory" : "victories"} claimed`,
            detail: `${warMvps.toLocaleString()} MVP honors · ${warDamage.toLocaleString()} lifetime war damage`,
        });
    }

    const missions = count(character.totalMissionsCompleted);
    if (missions > 0) {
        records.push({
            id: "missions",
            icon: "📜",
            title: `${missions.toLocaleString()} missions completed`,
            detail: "Contracts carried from the village board into the world.",
        });
    }

    const explored = count(character.totalTilesExplored);
    if (explored > 0) {
        records.push({
            id: "exploration",
            icon: "🧭",
            title: `${explored.toLocaleString()} sectors explored`,
            detail: "Roads, ruins, and hidden places entered into the map record.",
        });
    }

    return records;
}

function clanWarLabel(war: CwWar, clanName: string): { title: string; tone: "win" | "loss" | "draw" } {
    const opponent = war.clans.find((candidate) => candidate !== clanName) ?? "another clan";
    if (!war.winnerClan) return { title: `${clanName} and ${opponent} fought to a draw`, tone: "draw" };
    if (war.winnerClan === clanName) return { title: `${clanName} defeated ${opponent}`, tone: "win" };
    return { title: `${clanName} stood against ${opponent}`, tone: "loss" };
}

export function LivingChronicle({ character }: { character: Character }) {
    const headingId = useId();
    const personalRecords = useMemo(() => personalChronicleRecords(character), [character]);
    const village = character.storyVillage || character.village;
    const villageState = loadVillageState(village);
    const villageStanding = loadWarStandings().find((record) => record.village === village);
    const villageWars = endedVillageWarRecordsFor(village, 3);
    const clanName = character.clan?.trim() ?? "";
    const [clanWarSnapshot, setClanWarSnapshot] = useState<CwWar[] | null>(() => {
        if (!clanName) return [];
        const cachedWars = Object.values(sharedClanWarCache);
        return cachedWars.length > 0 ? cachedWars : null;
    });

    useEffect(() => {
        if (!clanName) return;
        let current = true;
        void cwListWars().then((wars) => {
            if (current) setClanWarSnapshot(wars);
        });
        return () => { current = false; };
    }, [clanName]);

    const recentClanWars = useMemo(() => (clanWarSnapshot ?? [])
        .filter((war): war is CwWar & { endedAt: number } => Boolean(war.endedAt) && war.clans.includes(clanName))
        .toSorted((a, b) => b.endedAt - a.endedAt)
        .slice(0, 3), [clanName, clanWarSnapshot]);

    const clanContribution = count(character.clanBattleContrib)
        + count(character.clanEventContrib)
        + count(character.clanMissionContrib);

    return (
        <div className="story-living-chronicle">
            <section className="living-chronicle-spine" aria-labelledby={headingId}>
                <header>
                    <small>ONE JOURNEY · FOUR FORMS OF PROOF</small>
                    <h2 id={headingId}>The Living Chronicle</h2>
                    <p>
                        The Chronicle is the world&apos;s changing record. It preserves what you, your companions,
                        your village, and your clan have actually done—it is not the card game itself.
                    </p>
                </header>
                <ol>
                    <li>
                        <span aria-hidden="true">01</span>
                        <strong>Make the deed</strong>
                        <p>Story victories and meaningful choices become part of the record.</p>
                    </li>
                    <li>
                        <span aria-hidden="true">02</span>
                        <strong>Carry a living witness</strong>
                        <p>Companions can witness your road and earn records through their own victories.</p>
                    </li>
                    <li>
                        <span aria-hidden="true">03</span>
                        <strong>Preserve what happened</strong>
                        <p>Scribes keep personal, village, and clan deeds from disappearing with the moment.</p>
                    </li>
                    <li>
                        <span aria-hidden="true">04</span>
                        <strong>Repeat the pattern</strong>
                        <p>The Sage may recognize a freely repeated Legacy, never a bloodline or inherited fate.</p>
                    </li>
                </ol>
            </section>

            <section className="chronicle-record-section" aria-labelledby={`${headingId}-personal`}>
                <div className="chronicle-record-heading">
                    <div>
                        <small>YOUR DEEDS</small>
                        <h3 id={`${headingId}-personal`}>{character.name}&apos;s record</h3>
                    </div>
                    <span>{personalRecords.length} entries</span>
                </div>
                {personalRecords.length > 0 ? (
                    <div className="chronicle-record-grid">
                        {personalRecords.map((record) => (
                            <article key={record.id} className="chronicle-record-card">
                                <span className="chronicle-record-icon" aria-hidden="true">{record.icon}</span>
                                <div>
                                    <h4>{record.title}</h4>
                                    <p>{record.detail}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <p className="chronicle-empty-record">Your first finished deed will be written here.</p>
                )}
            </section>

            <section className="chronicle-record-section" aria-labelledby={`${headingId}-village`}>
                <div className="chronicle-record-heading">
                    <div>
                        <small>VILLAGE RECORD</small>
                        <h3 id={`${headingId}-village`}>{village}</h3>
                    </div>
                    {villageStanding ? <span>{villageStanding.wins}W · {villageStanding.losses}L</span> : null}
                </div>
                {(villageState.firstLiberator || villageState.seatedKage) && (
                    <div className="chronicle-honor-strip">
                        {villageState.firstLiberator ? <span>First liberator · <strong>{villageState.firstLiberator}</strong></span> : null}
                        {villageState.seatedKage ? <span>Seated Kage · <strong>{villageState.seatedKage}</strong></span> : null}
                    </div>
                )}
                {villageWars.length > 0 ? (
                    <div className="chronicle-history-list">
                        {villageWars.map((war, index) => (
                            <article key={`${war.opponent}-${war.date}-${index}`}>
                                <span className={war.winner === village ? "is-win" : war.winner === "Draw" ? "is-draw" : "is-loss"} aria-hidden="true" />
                                <div>
                                    <h4>{war.winner === village ? `${village} defeated ${war.opponent}` : war.winner === "Draw" ? `${village} and ${war.opponent} fought to a draw` : `${village} stood against ${war.opponent}`}</h4>
                                    <p>{war.date} · Final strength {war.finalScore} · MVP {war.topDefender}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <p className="chronicle-empty-record">No completed village war has reached the current archive yet.</p>
                )}
            </section>

            <section className="chronicle-record-section" aria-labelledby={`${headingId}-clan`}>
                <div className="chronicle-record-heading">
                    <div>
                        <small>CLAN RECORD</small>
                        <h3 id={`${headingId}-clan`}>{clanName || "No clan sworn"}</h3>
                    </div>
                    {clanName ? <span>{clanContribution.toLocaleString()} contribution</span> : null}
                </div>
                {!clanName ? (
                    <p className="chronicle-empty-record">Join or found a clan and its shared victories will be preserved here.</p>
                ) : clanWarSnapshot === null ? (
                    <p className="chronicle-empty-record" role="status">Reading the clan archive…</p>
                ) : recentClanWars.length > 0 ? (
                    <div className="chronicle-history-list">
                        {recentClanWars.map((war) => {
                            const label = clanWarLabel(war, clanName);
                            const opponent = war.clans.find((candidate) => candidate !== clanName) ?? "Opponent";
                            return (
                                <article key={war.id}>
                                    <span className={`is-${label.tone}`} aria-hidden="true" />
                                    <div>
                                        <h4>{label.title}</h4>
                                        <p>
                                            {new Date(war.endedAt).toLocaleDateString()} · Final strength {count(war.hp[clanName]).toLocaleString()}–{count(war.hp[opponent]).toLocaleString()} · {war.completedChallenges.length} completed challenges
                                            {war.mvpByClan?.[clanName] ? ` · MVP ${war.mvpByClan[clanName]}` : ""}
                                        </p>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : (
                    <p className="chronicle-empty-record">{clanName}&apos;s first completed clan war will be written here.</p>
                )}
            </section>
        </div>
    );
}
