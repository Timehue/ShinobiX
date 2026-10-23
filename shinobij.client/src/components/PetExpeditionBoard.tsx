import type { Character } from "../types/character";
import type {
    Pet,
    PetExpeditionProvision,
    PetExpeditionReturnChoice,
    PetExpeditionRisk,
    PetExpeditionType,
} from "../types/pet";
import { countItem } from "../lib/inventory";
import { masteryBonus, masteryHasCapstone } from "../lib/profession-mastery";
import { petCurrentHappiness, petDisplayName } from "../lib/pet";
import { formatPetTimer } from "../lib/utils";
import { craftMaterialName } from "../../../shared/crafting-recipes";
import { PET_EXPEDITION_MATERIAL_BASE_COUNTS, PET_EXPEDITION_MATERIAL_LABELS } from "../../../shared/pet-expedition-materials";
import {
    PET_EXPEDITION_CARAVAN_BONUS,
    PET_EXPEDITION_DAILY_CAP,
    PET_EXPEDITION_PROVISION_RULES,
    PET_EXPEDITION_PROVISIONS,
    PET_EXPEDITION_RISK_RULES,
    PET_EXPEDITION_RISKS,
    PET_EXPEDITION_ROUTES,
    PET_EXPEDITION_TYPES,
    petExpeditionRewardPreview,
    PET_EXPEDITION_TAMER_MULTIPLIER,
} from "../../../shared/pet-expedition-contract";

type Props = {
    character: Character;
    selectedPet: Pet | null;
    expeditionType: PetExpeditionType;
    risk: PetExpeditionRisk;
    provision: PetExpeditionProvision;
    now: number;
    launchBusy: boolean;
    claimBusy: boolean;
    error: string;
    onTypeChange: (type: PetExpeditionType) => void;
    onRiskChange: (risk: PetExpeditionRisk) => void;
    onProvisionChange: (provision: PetExpeditionProvision) => void;
    onStart: () => void;
    onCollect: (choice: PetExpeditionReturnChoice) => void;
};

function utcDay(now: number) {
    return new Date(now).toISOString().slice(0, 10);
}

function nextUtcReset(now: number) {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function PetExpeditionBoard({
    character,
    selectedPet,
    expeditionType,
    risk,
    provision,
    now,
    launchBusy,
    claimBusy,
    error,
    onTypeChange,
    onRiskChange,
    onProvisionChange,
    onStart,
    onCollect,
}: Props) {
    const today = utcDay(now);
    const isTamer = character.profession === "petTamer";
    const claims = character.lastExpeditionClaimDate === today ? Math.max(0, character.expeditionsClaimedToday ?? 0) : 0;
    const starts = character.expeditionStartAllowance?.date === today ? Math.max(0, character.expeditionStartAllowance.count) : 0;
    const caravanMaster = masteryHasCapstone(character, "caravan-master");
    const dailyCap = PET_EXPEDITION_DAILY_CAP + (caravanMaster ? PET_EXPEDITION_CARAVAN_BONUS : 0);
    const rewardMastery = isTamer ? 1 + masteryBonus(character, "expRewardPct") / 100 : 1;
    const materialMastery = isTamer ? 1 + masteryBonus(character, "expMaterialPct") / 100 : 1;
    const boonMultiplier = selectedPet?.trait === "Boonbringer" ? 2 : 1;

    function preview(type: PetExpeditionType) {
        const rewards = petExpeditionRewardPreview(type, {
            profession: character.profession, risk, provision,
            rewardMastery, materialMastery,
        });
        return {
            petXp: !selectedPet || selectedPet.level >= selectedPet.maxLevel ? 0 : rewards.petXp * boonMultiplier,
            ryo: selectedPet ? rewards.ryo * boonMultiplier : 0,
            chances: rewards.chances,
            materials: PET_EXPEDITION_MATERIAL_BASE_COUNTS[type] * rewards.materialMultiplier,
        };
    }

    const selectedReady = Boolean(selectedPet?.expedition && now >= selectedPet.expedition.endsAt);
    const selectedAway = Boolean(selectedPet?.expedition && !selectedReady);
    const selectedLocked = Boolean(selectedPet && selectedPet.level < PET_EXPEDITION_ROUTES[expeditionType].requiredLevel);
    const selectedTraining = Boolean(selectedPet?.training);
    // Mirror the server gate in api/missions/expedition-start.ts: it charges
    // against the CURRENT happiness (pending daily decay applied), so reading the
    // raw stored value here would offer a bold route the server then rejects.
    const lacksBoldHappiness = risk === "bold" && Boolean(selectedPet && petCurrentHappiness(selectedPet) < PET_EXPEDITION_RISK_RULES.bold.happinessCost);
    const selectedProvisionCount = provision === "none" ? 0 : countItem(character, provision);
    const lacksProvision = provision !== "none" && selectedProvisionCount <= 0;
    const startDisabled = !selectedPet || selectedLocked || selectedTraining || Boolean(selectedPet.expedition)
        || starts >= dailyCap || lacksBoldHappiness || lacksProvision || launchBusy;
    const log = (character.petExpeditionLog ?? []).slice(-5).reverse();

    const badges = [
        character.petEscortBonusReady ? "Pet Escort · +20% Tamer XP" : null,
        selectedPet?.trait === "Boonbringer" ? "Boonbringer · 2× pet XP & ryo" : null,
        isTamer ? `Pet Tamer · ${PET_EXPEDITION_TAMER_MULTIPLIER}× expedition rewards` : null,
        masteryBonus(character, "expRewardPct") > 0 ? `Trailblazer +${masteryBonus(character, "expRewardPct")}%` : null,
        masteryBonus(character, "expMaterialPct") > 0 ? `Forager +${masteryBonus(character, "expMaterialPct")}%` : null,
        caravanMaster ? `Caravan Master · ${dailyCap}/day` : null,
    ].filter((badge): badge is string => Boolean(badge));

    return (
        <section className="pet-expedition-board" aria-labelledby="pet-expedition-board-title">
            <header className="pet-expedition-board__header">
                <div>
                    <span className="pet-yard-kicker">Field operations</span>
                    <h3 id="pet-expedition-board-title">Expedition Board</h3>
                    <p>Choose a route for {selectedPet ? petDisplayName(selectedPet) : "your companion"}. Set the risk, pack provisions, and send them into the wild.</p>
                </div>
                <div className="pet-expedition-caps" aria-label="Daily expedition limits">
                    <span><small>Started today</small><strong>{starts}/{dailyCap}</strong></span>
                    <span><small>Collected today</small><strong>{claims}/{dailyCap}</strong></span>
                    <span><small>UTC reset</small><strong>{formatPetTimer(Math.max(0, nextUtcReset(now) - now))}</strong></span>
                </div>
            </header>

            {badges.length > 0 && <div className="pet-expedition-badges" aria-label="Active expedition bonuses">
                {badges.map((badge) => <span key={badge}>{badge}</span>)}
            </div>}

            <div className="pet-expedition-routes" role="radiogroup" aria-label="Expedition route">
                {PET_EXPEDITION_TYPES.map((type) => {
                    const route = PET_EXPEDITION_ROUTES[type];
                    const routePreview = preview(type);
                    return (
                        <button
                            type="button"
                            role="radio"
                            aria-checked={expeditionType === type}
                            className={expeditionType === type ? "is-selected" : ""}
                            key={type}
                            disabled={Boolean(selectedPet?.expedition) || launchBusy || !selectedPet || selectedPet.level < route.requiredLevel}
                            onClick={() => onTypeChange(type)}
                        >
                            <span className="pet-expedition-route__time">Lv. {route.requiredLevel}+ · {route.durationLabel}</span>
                            <strong>{route.label}</strong>
                            <small>{route.description} {PET_EXPEDITION_MATERIAL_LABELS[type]} · about {routePreview.materials.toLocaleString(undefined, { maximumFractionDigits: 1 })} materials.</small>
                            <dl>
                                <div><dt>Pet XP</dt><dd>{routePreview.petXp.toLocaleString()}</dd></div>
                                <div><dt>Secure ryo</dt><dd>{routePreview.ryo.toLocaleString()}</dd></div>
                                <div><dt>Bone</dt><dd>{percent(routePreview.chances.bone)}</dd></div>
                                <div><dt>Aura / Fate</dt><dd>{percent(routePreview.chances.aura)} / {percent(routePreview.chances.fate)}</dd></div>
                            </dl>
                        </button>
                    );
                })}
            </div>

            <div className="pet-expedition-setup">
                <fieldset>
                    <legend>Risk stance</legend>
                    {PET_EXPEDITION_RISKS.map((value) => (
                        <label key={value} className="pet-expedition-risk">
                            <input type="radio" name="pet-expedition-risk" value={value} checked={risk === value} disabled={Boolean(selectedPet?.expedition) || launchBusy} onChange={() => onRiskChange(value)} />
                            <span><strong>{PET_EXPEDITION_RISK_RULES[value].label}</strong><small>{PET_EXPEDITION_RISK_RULES[value].description}</small></span>
                        </label>
                    ))}
                </fieldset>
                <label className="pet-expedition-provision" htmlFor="pet-expedition-provision">
                    <span>Optional provision</span>
                    <select id="pet-expedition-provision" value={provision} disabled={Boolean(selectedPet?.expedition) || launchBusy} onChange={(event) => onProvisionChange(event.target.value as PetExpeditionProvision)}>
                        {PET_EXPEDITION_PROVISIONS.map((value) => {
                            const owned = value === "none" ? null : countItem(character, value);
                            const rule = PET_EXPEDITION_PROVISION_RULES[value];
                            return <option key={value} value={value}>{rule.label}{owned == null ? "" : ` · owned ${owned}`} · pet XP ×{rule.petXpMultiplier.toFixed(2)}{rule.materialMultiplier > 1 ? ` · finds ×${rule.materialMultiplier.toFixed(2)}` : ""}</option>;
                        })}
                    </select>
                    <small>Consumed when your companion departs.</small>
                </label>
            </div>

            <div className="pet-expedition-action" aria-live="polite">
                {selectedAway && selectedPet?.expedition ? (
                    <div>
                        <strong>{petDisplayName(selectedPet)} is exploring {selectedPet.expedition.place || selectedPet.expedition.region || "the field"}.</strong>
                        <span>{formatPetTimer(selectedPet.expedition.endsAt - now)} remaining · {PET_EXPEDITION_RISK_RULES[selectedPet.expedition.risk ?? "safe"].label}</span>
                    </div>
                ) : selectedReady && selectedPet ? (
                    <div className="pet-expedition-return-choice">
                        <div>
                            <strong>{petDisplayName(selectedPet)} is ready to report.</strong>
                            <span>{(selectedPet.expedition?.choiceVersion ?? 0) >= 1 ? "Secure is guaranteed. Investigate has a 60% enhanced haul and a 40% setback." : "This legacy journey supports a secure return only."}</span>
                        </div>
                        <button type="button" disabled={claimBusy} onClick={() => onCollect("secure")}>{claimBusy ? "Recording…" : "Secure haul"}</button>
                        <button type="button" className="is-bold" disabled={claimBusy || (selectedPet.expedition?.choiceVersion ?? 0) < 1} onClick={() => onCollect("investigate")}>{claimBusy ? "Recording…" : "Investigate final lead"}</button>
                    </div>
                ) : (
                    <div>
                        <strong>{selectedPet ? `Send ${petDisplayName(selectedPet)} on ${PET_EXPEDITION_ROUTES[expeditionType].label}` : "Select a carried companion"}</strong>
                        <span>{selectedLocked ? `${PET_EXPEDITION_ROUTES[expeditionType].label} requires pet level ${PET_EXPEDITION_ROUTES[expeditionType].requiredLevel}.` : selectedTraining ? "Collect training before departing." : starts >= dailyCap ? "Daily start cap reached. New routes open at the UTC reset." : lacksBoldHappiness ? "This companion needs at least 5 happiness for a bold route." : lacksProvision ? "That provision is no longer in inventory." : isTamer ? "Your 1.5× profession bonus and purchased expedition perks are included. Rewards are locked in at departure." : "All eligible pets earn ryo, materials, and pet XP. Rewards are locked in at departure."}</span>
                    </div>
                )}
                {!selectedPet?.expedition && <button type="button" className="pet-home-primary" disabled={startDisabled} aria-busy={launchBusy} onClick={onStart}>{launchBusy ? "Sending…" : "Launch expedition"}</button>}
            </div>
            {error && <p id="pet-expedition-claim-error" className="pet-expedition-error" role="alert">{error}</p>}

            <details className="pet-expedition-log">
                <summary>Recent field reports{log.length > 0 ? ` · ${log.length}` : ""}</summary>
                {log.length === 0 ? <p>No completed expeditions recorded yet.</p> : (
                    <ol>
                        {log.map((entry) => {
                            const finds = [entry.foundBone ? "Bone Charm" : "", entry.foundAura ? "Aura Stone" : "", entry.foundFate ? "Fate Shard" : ""].filter(Boolean).join(", ");
                            const materials = (entry.materialRewards ?? []).map((reward) => `${reward.count} ${craftMaterialName(reward.itemId)}`).join(", ");
                            return <li key={entry.id}><strong>{entry.petName} · {entry.outcomeLabel}</strong><span>{entry.story}</span><small>+{entry.ryo.toLocaleString()} ryo · +{entry.petXp.toLocaleString()} pet XP{materials ? ` · Materials: ${materials}` : ""}{finds ? ` · Rare: ${finds}` : ""}</small></li>;
                        })}
                    </ol>
                )}
            </details>
        </section>
    );
}
