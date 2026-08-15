import {
    GiBoxingGlove,
    GiBriefcase,
    GiCrossedSwords,
    GiEyeball,
    GiFireSpellCast,
    GiHealing,
    GiHealthPotion,
    GiMagicSwirl,
    GiPawPrint,
    GiRun,
    GiSandsOfTime,
    GiTargeted,
    GiWaterDrop,
    GiBootPrints,
} from "react-icons/gi";
import { BattleTabBar } from "../../../components/BattleTabBar";
import { CombatCommandBar } from "../../../components/CombatHudLayout";
import { CombatDetailPortal } from "../../../components/CombatDetailPortal";
import { JutsuEffectCards } from "../../../components/JutsuEffectCards";
import { JUTSU_MAX_LEVEL, jutsuLevelCapForLevel } from "../../../constants/game";
import { countItem } from "../../../lib/inventory";
import { equipmentSlotLabel, normalizeEquipmentSlot } from "../../../lib/equipment";
import { getJutsuMastery, jutsuResourceDisplay, scaleJutsuByLevel } from "../../../lib/jutsu-scaling";
import { jutsuTargetingLabel } from "../../../lib/jutsu-effects";
import { petDisplayName } from "../../../lib/pet";
import type { BattleTab } from "../../../lib/use-battle-tabs";
import type { JutsuType } from "../../../types/core";
import type { Character } from "../../../types/character";
import type { GameItem, Jutsu } from "../../../types/combat";
import type { Pet } from "../../../types/pet";
import type { ArenaBattleActor, ArenaSelectedCombatAction } from "../types";

type ArenaCommandDeckProps = {
    battleTab: BattleTab;
    setBattleTab: (tab: BattleTab) => void;
    unreadBattleEntries: number;
    showRookieCombatTip: boolean;
    battleEnded: boolean;
    activeActor: ArenaBattleActor;
    actionsThisTurn: number;
    character: Character;
    lensDiscipline: JutsuType;
    playerHp: number;
    ap: number;
    adjustedApCost: (cost: number) => number;
    cooldowns: Record<string, number>;
    selectedActionId: ArenaSelectedCombatAction;
    canSummonPet: boolean;
    activeBattlePetCanSummon: boolean;
    summonedPet: Pet | null;
    petSummonedThisFight: boolean;
    activeBattlePetSummonNote: string;
    opponentName: string;
    equippedJutsus: Jutsu[];
    combatEquippedItems: GameItem[];
    pendingTargetJutsuId: string;
    pendingTargetWeapon: GameItem | null;
    jutsuCooldowns: Record<string, number>;
    inspectedJutsu: Jutsu | undefined;
    inspectedCombatItem: GameItem | undefined;
    inspectedJutsuId: string;
    inspectedCombatItemId: string;
    combatItemConsumed: (item: GameItem) => boolean;
    canUseCombatItem: (item: GameItem) => boolean;
    combatItemSummary: (item: GameItem) => string;
    onBasicAttack: () => void;
    onToggleMove: () => void;
    onBasicHeal: () => void;
    onClearEnemyPositiveEffects: () => void;
    onCleansePlayerNegativeEffects: () => void;
    onSummonActivePet: () => void;
    onFlee: () => void;
    onWaitTurn: () => void;
    onSelectJutsu: (jutsu: Jutsu) => void;
    onActivateCombatItem: (item: GameItem) => void;
    onInspectJutsu: (id: string) => void;
    onInspectCombatItem: (id: string) => void;
    onCloseJutsu: () => void;
    onCloseCombatItem: () => void;
};

export function ArenaCommandDeck({
    battleTab,
    setBattleTab,
    unreadBattleEntries,
    showRookieCombatTip,
    battleEnded,
    activeActor,
    actionsThisTurn,
    character,
    lensDiscipline,
    playerHp,
    ap,
    adjustedApCost,
    cooldowns,
    selectedActionId,
    canSummonPet,
    activeBattlePetCanSummon,
    summonedPet,
    petSummonedThisFight,
    activeBattlePetSummonNote,
    opponentName,
    equippedJutsus,
    combatEquippedItems,
    pendingTargetJutsuId,
    pendingTargetWeapon,
    jutsuCooldowns,
    inspectedJutsu,
    inspectedCombatItem,
    inspectedJutsuId,
    inspectedCombatItemId,
    combatItemConsumed,
    canUseCombatItem,
    combatItemSummary,
    onBasicAttack,
    onToggleMove,
    onBasicHeal,
    onClearEnemyPositiveEffects,
    onCleansePlayerNegativeEffects,
    onSummonActivePet,
    onFlee,
    onWaitTurn,
    onSelectJutsu,
    onActivateCombatItem,
    onInspectJutsu,
    onInspectCombatItem,
    onCloseJutsu,
    onCloseCombatItem,
}: ArenaCommandDeckProps) {
    return (
        <>
            <BattleTabBar tab={battleTab} setTab={setBattleTab} unread={unreadBattleEntries} />

            {showRookieCombatTip && (
                <div className="rookie-combat-tip">
                    <strong>First Fight Plan</strong>
                    <span>Spend AP on Attack or jutsu, click highlighted targets, then Wait when AP runs low. The Battle Log records every result.</span>
                </div>
            )}

            <CombatCommandBar>
                <button onClick={onBasicAttack} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || character.stamina < 10 || ap < adjustedApCost(40)}><i className="cmd-icon" aria-hidden="true"><GiCrossedSwords /></i><span>Attack</span><small>40 AP | 10 SP</small></button>
                <button className={selectedActionId === "move" ? "selected-action" : ""} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(30)} onClick={onToggleMove}><i className="cmd-icon" aria-hidden="true"><GiBootPrints /></i><span>Move</span><small>{adjustedApCost(30)} AP / tile</small></button>
                <button
                    onClick={onBasicHeal}
                    title={playerHp >= character.maxHp ? "You are already at full HP" : "Restore 10% HP"}
                    disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || playerHp >= character.maxHp || (cooldowns.basicHeal ?? 0) > 0 || character.chakra < 10 || ap < adjustedApCost(60)}
                ><i className="cmd-icon" aria-hidden="true"><GiHealing /></i><span>Heal</span><small>{playerHp >= character.maxHp ? "Full HP - not needed" : `60 AP | 10 CP | CD ${cooldowns.basicHeal ?? 0}`}</small></button>
                <button onClick={onClearEnemyPositiveEffects} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || (cooldowns.clear ?? 0) > 0 || ap < adjustedApCost(60)}><i className="cmd-icon" aria-hidden="true"><GiMagicSwirl /></i><span>Clear</span><small>60 AP | CD {cooldowns.clear ?? 0}</small></button>
                <button onClick={onCleansePlayerNegativeEffects} disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || (cooldowns.cleanse ?? 0) > 0 || ap < adjustedApCost(60)}><i className="cmd-icon" aria-hidden="true"><GiWaterDrop /></i><span>Cleanse</span><small>60 AP | CD {cooldowns.cleanse ?? 0}</small></button>
                {canSummonPet && (
                    <button
                        onClick={onSummonActivePet}
                        disabled={!activeBattlePetCanSummon || Boolean(summonedPet) || petSummonedThisFight || activeActor !== "player"}
                        title={activeBattlePetSummonNote}
                    >
                        <i className="cmd-icon" aria-hidden="true"><GiPawPrint /></i>
                        <span>Summon Pet</span>
                        <small>{summonedPet ? `${petDisplayName(summonedPet)} fighting` : petSummonedThisFight ? "Pet already used" : activeBattlePetSummonNote}</small>
                    </button>
                )}
                <button
                    onClick={onFlee}
                    disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(100)}
                >
                    <i className="cmd-icon" aria-hidden="true"><GiRun /></i>
                    <span>Flee</span>
                    <small>100 AP | 50%</small>
                </button>
                <button onClick={onWaitTurn}><i className="cmd-icon" aria-hidden="true"><GiSandsOfTime /></i><span>Wait</span><small>{activeActor === "enemy" ? "Skip delay" : "End turn"}</small></button>
            </CombatCommandBar>

            <div className="jutsu-layout-card combat-jutsu-bar">
                {equippedJutsus.length === 0 && combatEquippedItems.length === 0 ? (
                    <div className="summary-box">
                        No equipped jutsus or combat items. Equip trained jutsus, weapons, or items from Profile.
                    </div>
                ) : (
                    <>
                        <div className="combat-equipped-jutsu-grid">
                            {equippedJutsus.map((jutsu) => {
                                const isArmed = pendingTargetJutsuId === jutsu.id;
                                const cooldown = jutsuCooldowns[jutsu.id] ?? 0;
                                const isOnCooldown = cooldown > 0;
                                const image = jutsu.image;
                                const FallbackIcon =
                                    jutsu.type === "Taijutsu" ? GiBoxingGlove :
                                        jutsu.type === "Bukijutsu" ? GiCrossedSwords :
                                            jutsu.type === "Genjutsu" ? GiEyeball :
                                                GiFireSpellCast;

                                return (
                                    <div
                                        key={jutsu.id}
                                        className={`combat-jutsu-card-wrap ${isArmed ? "selected-action" : ""}`}
                                    >
                                        {isOnCooldown && <span className="combat-cd-badge" title={`${cooldown} round(s) until ready`}>{cooldown}</span>}
                                        <button
                                            type="button"
                                            className={`combat-jutsu-button ${isArmed ? "selected-action" : ""} ${isOnCooldown ? "jutsu-on-cooldown" : ""}`}
                                            disabled={battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || isOnCooldown || ap < adjustedApCost(jutsu.ap)}
                                            title={isOnCooldown ? `${jutsu.name} cooldown: ${cooldown} rounds` : `${jutsu.name} | ${jutsu.ap} AP | Range ${jutsu.range}`}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onSelectJutsu(jutsu);
                                            }}
                                        >
                                            <span className="combat-jutsu-thumb">
                                                <strong className="combat-jutsu-fallback-icon"><FallbackIcon size={22} aria-hidden="true" /></strong>
                                                {image && <img src={image} alt={jutsu.name} />}
                                            </span>
                                            <span className="combat-jutsu-name">{jutsu.name}</span>
                                            <span className="combat-jutsu-info">
                                                {jutsu.ap} AP · R{jutsu.range}{isOnCooldown ? ` · CD ${cooldown}` : ""}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="combat-jutsu-help"
                                            id={`solo-combat-detail-trigger-jutsu-${jutsu.id}`}
                                            aria-haspopup="dialog"
                                            aria-controls={`solo-combat-detail-jutsu-${jutsu.id}`}
                                            aria-expanded={inspectedJutsuId === jutsu.id}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onInspectJutsu(jutsu.id);
                                            }}
                                            title={`View ${jutsu.name} details`}
                                        >
                                            ?
                                        </button>
                                    </div>
                                );
                            })}

                            {combatEquippedItems.map((item) => {
                                const slot = normalizeEquipmentSlot(item.slot);
                                const isWeapon = slot === "hand" || slot === "thrown";
                                const ItemIcon = slot === "thrown" ? GiTargeted : slot === "hand" ? GiCrossedSwords : slot === "potion" ? GiHealthPotion : GiBriefcase;
                                const itemAp = item.apCost ?? (slot === "thrown" ? 40 : slot === "hand" ? 40 : 35);
                                const weaponDisplayRange = item.weaponRange ?? (slot === "thrown" ? 4 : 1);
                                const consumed = combatItemConsumed(item);
                                const owned = consumed ? countItem(character, item.id) : null;
                                const usable = canUseCombatItem(item);
                                const countSuffix = owned != null ? ` ×${owned}` : "";
                                const itemCd = jutsuCooldowns[item.id] ?? 0;
                                const onCooldown = itemCd > 0;
                                const cdSuffix = onCooldown ? ` | CD ${itemCd}` : "";
                                const actionText = isWeapon
                                    ? `${itemAp} AP | R${weaponDisplayRange}${countSuffix}${cdSuffix}`
                                    : `${itemAp} AP | Use${countSuffix}${cdSuffix}`;
                                const isArmed = pendingTargetWeapon?.id === item.id;

                                return (
                                    <div className={`combat-jutsu-card-wrap combat-item-card-wrap ${isWeapon ? "combat-weapon-card" : "combat-consumable-card"}${onCooldown ? " jutsu-on-cooldown" : ""}`} key={item.id}>
                                        {onCooldown && <span className="combat-cd-badge" title={`${itemCd} round(s) until ready`}>{itemCd}</span>}
                                        <button
                                            type="button"
                                            className={`combat-jutsu-button combat-item-button rarity-${item.rarity}${isArmed ? " jutsu-armed" : ""}${onCooldown ? " jutsu-on-cooldown" : ""}`}
                                            title={onCooldown ? `${item.name} — on cooldown (${itemCd} round(s) left)` : isArmed ? `${item.name} armed — click ${opponentName} to fire` : !usable ? `${item.name} — none left this battle` : `${item.name} | ${equipmentSlotLabel(item.slot)} | ${combatItemSummary(item)}`}
                                            disabled={!usable || onCooldown || battleEnded || activeActor !== "player" || actionsThisTurn >= 5 || ap < adjustedApCost(itemAp)}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onActivateCombatItem(item);
                                            }}
                                        >
                                            <span className="combat-jutsu-thumb combat-item-thumb">
                                                <strong className="combat-jutsu-fallback-icon"><ItemIcon size={22} aria-hidden="true" /></strong>
                                                {item.image && <img src={item.image} alt={item.name} />}
                                            </span>
                                            <span className="combat-jutsu-name">{item.name}</span>
                                            <span className="combat-jutsu-info">{equipmentSlotLabel(item.slot)} | {actionText}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="combat-jutsu-help"
                                            id={`solo-combat-detail-trigger-item-${item.id}`}
                                            aria-haspopup="dialog"
                                            aria-controls={`solo-combat-detail-item-${item.id}`}
                                            aria-expanded={inspectedCombatItemId === item.id}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onInspectCombatItem(item.id);
                                            }}
                                            title={`View ${item.name} details`}
                                        >
                                            ?
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {inspectedJutsu && (() => {
                            const mastery = getJutsuMastery(character, inspectedJutsu.id);
                            const effectiveLevel = Math.min(mastery.level, jutsuLevelCapForLevel(character.level));
                            const scaled = scaleJutsuByLevel(inspectedJutsu, effectiveLevel);
                            const cooldown = jutsuCooldowns[inspectedJutsu.id] ?? 0;
                            const cleanTarget = inspectedJutsu.target.toLowerCase().replaceAll("_", " ");
                            const cleanMethod = inspectedJutsu.method.toLowerCase().replaceAll("_", " ");
                            const targeting = jutsuTargetingLabel(inspectedJutsu);

                            return (
                                <CombatDetailPortal
                                    id={`solo-combat-detail-jutsu-${inspectedJutsu.id}`}
                                    labelId={`solo-combat-detail-label-jutsu-${inspectedJutsu.id}`}
                                    triggerId={`solo-combat-detail-trigger-jutsu-${inspectedJutsu.id}`}
                                    onClose={onCloseJutsu}
                                >
                                    <div className="combat-jutsu-detail-header">
                                        <div>
                                            <strong id={`solo-combat-detail-label-jutsu-${inspectedJutsu.id}`}>{inspectedJutsu.name}</strong>
                                            <small>Level {mastery.level} / {JUTSU_MAX_LEVEL}{mastery.level > effectiveLevel ? ` · combat-capped to ${effectiveLevel} at your rank` : ""}</small>
                                        </div>
                                        <button type="button" data-combat-detail-close aria-label="Close combat details" onClick={onCloseJutsu}>×</button>
                                    </div>
                                    <div className="combat-jutsu-detail-grid">
                                        <span><strong>Type:</strong> {inspectedJutsu.type}</span>
                                        <span><strong>Element:</strong> {inspectedJutsu.element}</span>
                                        <span><strong>AP:</strong> {inspectedJutsu.ap}</span>
                                        <span><strong>Range:</strong> {inspectedJutsu.range}</span>
                                        <span><strong>Cooldown:</strong> {cooldown > 0 ? `${cooldown} active` : inspectedJutsu.cooldown}</span>
                                        <span><strong>Target:</strong> {cleanTarget}</span>
                                        <span><strong>Method:</strong> {cleanMethod}</span>
                                        <span><strong>Effect Power:</strong> {scaled.scaledEffectPower}</span>
                                        <span><strong>Chakra Usage:</strong> {jutsuResourceDisplay(inspectedJutsu, "chakra", character.level, character.specialty, mastery.level)}</span>
                                        <span><strong>Stamina Usage:</strong> {jutsuResourceDisplay(inspectedJutsu, "stamina", character.level, character.specialty, mastery.level)}</span>
                                    </div>
                                    <p className="combat-jutsu-detail-desc">
                                        <strong style={{ color: "#c084fc" }}><GiTargeted aria-hidden="true" /> {targeting.short}:</strong> {targeting.detail}
                                    </p>
                                    {inspectedJutsu.description && <p className="combat-jutsu-detail-desc">{inspectedJutsu.description}</p>}
                                    <div className="combat-jutsu-effects-list">
                                        <JutsuEffectCards jutsu={inspectedJutsu} scaledEffectPower={scaled.scaledEffectPower} masteryLevel={effectiveLevel} lensDiscipline={lensDiscipline} />
                                    </div>
                                </CombatDetailPortal>
                            );
                        })()}

                        {inspectedCombatItem && (
                            <CombatDetailPortal
                                id={`solo-combat-detail-item-${inspectedCombatItem.id}`}
                                labelId={`solo-combat-detail-label-item-${inspectedCombatItem.id}`}
                                triggerId={`solo-combat-detail-trigger-item-${inspectedCombatItem.id}`}
                                className="combat-item-detail-popover"
                                onClose={onCloseCombatItem}
                            >
                                <div className="combat-jutsu-detail-header">
                                    <div>
                                        <strong id={`solo-combat-detail-label-item-${inspectedCombatItem.id}`}>{inspectedCombatItem.name}</strong>
                                        <small>{equipmentSlotLabel(inspectedCombatItem.slot)} | {inspectedCombatItem.rarity}</small>
                                    </div>
                                    <button type="button" data-combat-detail-close aria-label="Close combat details" onClick={onCloseCombatItem}>×</button>
                                </div>
                                <div className="combat-jutsu-detail-grid">
                                    <span><strong>Action:</strong> {["hand", "thrown"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? "Weapon attack" : "Support item"}</span>
                                    <span><strong>AP:</strong> {inspectedCombatItem.apCost ?? (normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 40 : ["hand"].includes(normalizeEquipmentSlot(inspectedCombatItem.slot)) ? 40 : 35)}</span>
                                    <span><strong>Range:</strong> {normalizeEquipmentSlot(inspectedCombatItem.slot) === "thrown" ? 4 : normalizeEquipmentSlot(inspectedCombatItem.slot) === "hand" ? 1 : "Self"}</span>
                                    <span><strong>Rarity:</strong> {inspectedCombatItem.rarity}</span>
                                </div>
                                <p className="combat-jutsu-detail-desc">{inspectedCombatItem.description}</p>
                                <div className="combat-item-effect-box">
                                    <strong>Combat Bonuses</strong>
                                    <p>{combatItemSummary(inspectedCombatItem)}</p>
                                </div>
                            </CombatDetailPortal>
                        )}
                    </>
                )}
            </div>
        </>
    );
}
