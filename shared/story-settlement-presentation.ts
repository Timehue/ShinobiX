/** Owner-visible delivery facts; no internal ledger records or new authority. */
export type StorySettlementDelivery = {
    battle: 'confirmed';
    personalReward: 'committed';
    combatRecord: 'confirmed' | 'unavailable';
    legacyRecord: 'confirmed' | 'pending' | 'unavailable' | 'not-applicable';
};
