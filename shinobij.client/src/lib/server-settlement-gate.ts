/**
 * Release gate for economy/progression actions that still mutate only the
 * browser save. The generic save route deliberately refuses those mutations,
 * so leaving the controls live would either show progress that disappears on
 * refresh or (for destructive transforms) consume an owned item without
 * delivering its reward.
 *
 * Flip an entry only after its action is settled by a dedicated, locked server
 * endpoint and the client has been migrated to use that endpoint.
 */
export const SERVER_SETTLEMENT_STATUS = {
    profileStatRespec: false,
    profileFateShardTitle: false,
    shopPurchase: false,
    shopCardPack: false,
    inventorySale: false,
    warCrateOpen: false,
    clientWarCrateGrant: false,
    fieldHuntMissions: false,
    hollowGatePetBefriend: false,
    hollowGateRun: false,
    petTraining: false,
    hollowGateAttunement: false,
    creatorItemCraft: false,
    timedJutsuTraining: false,
    bankDeposit: false,
    rankedPvp: false,
    pvpSession: false,
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
    creatorItemCraft: "Item crafting",
    timedJutsuTraining: "Timed jutsu training",
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
