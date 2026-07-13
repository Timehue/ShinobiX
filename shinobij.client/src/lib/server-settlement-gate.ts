/**
 * Central readiness registry for economy/progression actions. Every listed
 * action now settles through a dedicated authenticated server path; retaining
 * the registry keeps call sites explicit without leaving stale release blocks.
 */
export const SERVER_SETTLEMENT_STATUS = {
    profileStatRespec: true,
    profileFateShardTitle: true,
    shopPurchase: true,
    shopCardPack: true,
    inventorySale: true,
    warCrateOpen: true,
    clientWarCrateGrant: true,
    fieldHuntMissions: true,
    hollowGatePetBefriend: true,
    hollowGateRun: true,
    petTraining: true,
    hollowGateAttunement: true,
    hollowGateKeyForge: true,
    creatorItemCraft: true,
    timedJutsuTraining: true,
    timedJutsuTrainingQueue: true,
    bankDeposit: true,
    rankedPvp: true,
    pvpSession: true,
} as const;

export type PendingServerSettlementAction = keyof typeof SERVER_SETTLEMENT_STATUS;

const ACTION_LABELS: Record<PendingServerSettlementAction, string> = {
    profileStatRespec: "Stat respec",
    profileFateShardTitle: "Paid title customization",
    shopPurchase: "Shop purchases",
    shopCardPack: "Card-pack purchases",
    inventorySale: "Item sales",
    warCrateOpen: "War-crate opening",
    clientWarCrateGrant: "Client-side war rewards",
    fieldHuntMissions: "Field missions and Hunter contracts",
    hollowGatePetBefriend: "Hollow Gate pet befriending",
    hollowGateRun: "Hollow Gate runs",
    petTraining: "Pet training",
    hollowGateAttunement: "Hollow Gate attunement",
    hollowGateKeyForge: "Hollow Gate key forging",
    creatorItemCraft: "Item crafting",
    timedJutsuTraining: "Timed jutsu training",
    timedJutsuTrainingQueue: "Queued jutsu training",
    bankDeposit: "Bank deposits",
    rankedPvp: "Ranked PvP",
    pvpSession: "PvP sessions",
};

export function isServerSettlementReady(action: PendingServerSettlementAction): boolean {
    return SERVER_SETTLEMENT_STATUS[action];
}

function browserNotice(message: string): void {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(message);
    }
}

/**
 * Returns true only after the action has a server-authoritative settlement.
 * Pending actions display an explicit notice and leave all local state intact.
 */
export function requireServerSettlement(
    action: PendingServerSettlementAction,
    notify: (message: string) => void = browserNotice,
): boolean {
    if (isServerSettlementReady(action)) return true;
    notify(`${ACTION_LABELS[action]} is temporarily unavailable while secure server settlement is being completed. Nothing was spent or changed.`);
    return false;
}
