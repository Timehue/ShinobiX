/** One certificate covers half of one Broker sealed crate's stake; redemption still uses a daily pull. */
export type BrokerPayment = 'ryo' | 'certificate';

export type BrokerCrateReward = {
    tier: 'scraps' | 'trinket' | 'haul' | 'relic' | 'fortune' | 'jackpot';
    label: string; ryo: number; fateShards: number; boneCharms: number; auraStones: number; mythicSeals: number;
};
export type BrokerCrateReceipt = {
    requestId: string; payment: BrokerPayment; cost: number; reward: BrokerCrateReward;
};
export type BrokerCrateLedger = { day: string; used: number; receipts: BrokerCrateReceipt[] };

/** Keep the old per-day counter during rollout; the co-written save ledger cannot lose a pull. */
export function brokerDailyUsed(character: { brokerCrateLedger?: unknown }, day: string, legacy: unknown = 0): number {
    const ledger = character.brokerCrateLedger as Partial<BrokerCrateLedger> | undefined;
    const whole = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
    return Math.max(whole(legacy), ledger?.day === day ? whole(ledger.used) : 0);
}

export function brokerCertificateCount(character: { brokerCertificates?: unknown }): number {
    const count = character.brokerCertificates;
    return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function rallyBrokerCertificates(place: number): number {
    return place === 1 ? 2 : place === 2 ? 1 : 0;
}

/** A completed daily delivery earns one certificate; a failed delivery earns none. */
export function caravanBrokerCertificates(success: boolean): number {
    return success ? 1 : 0;
}
