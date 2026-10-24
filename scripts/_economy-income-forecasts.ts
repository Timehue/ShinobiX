/** Code-default scenarios, not measured incomes or additive 90-minute routines. */
import { anchorRyoPerMinute } from '../shared/economy-anchor.js';
import {
    PET_EXPEDITION_DAILY_CAP, PET_EXPEDITION_CARAVAN_BONUS, PET_EXPEDITION_ROUTES,
    PET_EXPEDITION_RYO_SCALE, PET_EXPEDITION_TYPES, petExpeditionRewardPreview,
    resolvePetExpeditionChoice,
} from '../shared/pet-expedition-contract.js';
import { masteryBonus, masteryHasCapstone } from '../api/_profession-mastery.js';
import { petExpeditionTraitMultiplier } from '../api/missions/report-pet-event.js';
import { BLACK_MARKET_COST, BLACK_MARKET_CERTIFICATE_COST } from '../api/festival/_black-market.js';
import { blackMarketPullEv } from '../api/_black-market-loop.js';
import { rallyBrokerCertificates, caravanBrokerCertificates } from '../shared/sunscar/broker-certificates.js';

// Eight legal mastery points: six path ranks plus the two-point capstone.
const EXPEDITION_SPEC = { 'exp-rewards': 3, 'exp-materials': 3, 'caravan-master': 1 };

/** Global expected cash flow: resale prices do not create ryo. A certificate
 *  covers half the stake (owner ruling 2026-10-23), so its pull debits the rest. */
export function brokerExpectedNetRyo(paidPulls: number, certificatePulls: number, exchangeFees = 0): number {
    const ev = blackMarketPullEv().ryo;
    const net = (ev - BLACK_MARKET_COST) * paidPulls + (ev - BLACK_MARKET_CERTIFICATE_COST) * certificatePulls - exchangeFees;
    // Both per-pull nets are negative, so zero pulls would otherwise give -0.
    return net === 0 ? 0 : net;
}

export function economyIncomeForecasts() {
    const expeditions = PET_EXPEDITION_TYPES.flatMap(route => [
        { id: 'ordinary-safe', profession: 'vanguard', advanced: false, boon: false },
        { id: 'tamer-safe', profession: 'petTamer', advanced: false, boon: false },
        { id: 'tamer-mastery-bold-caravan', profession: 'petTamer', advanced: true, boon: false },
        { id: 'tamer-mastery-bold-caravan-boonbringer', profession: 'petTamer', advanced: true, boon: true },
    ].map(scenario => {
        const spec = scenario.advanced ? EXPEDITION_SPEC : {};
        const dailyClaims = PET_EXPEDITION_DAILY_CAP + (masteryHasCapstone(scenario.profession, spec, 'caravan-master') ? PET_EXPEDITION_CARAVAN_BONUS : 0);
        const rewardMastery = 1 + masteryBonus(scenario.profession, spec, 'expRewardPct') / 100;
        const risk = scenario.advanced ? 'bold' : 'safe';
        const sealed = petExpeditionRewardPreview(route, {
            profession: scenario.profession, risk, provision: 'none', rewardMastery,
            materialMastery: 1, ryoScale: PET_EXPEDITION_RYO_SCALE,
        });
        const traitMultiplier = petExpeditionTraitMultiplier({ trait: scenario.boon ? 'Boonbringer' : 'Steadfast' });
        const returned = (multiplier: number) => Math.round(sealed.ryo * traitMultiplier * multiplier);
        // Sweep the actual choice resolver, then round each RETURN before summing.
        const choices = Array.from({ length: 100 }, (_, i) => returned(resolvePetExpeditionChoice('investigate', (i + .5) / 100).ryoMultiplier));
        return {
            route, scenario: scenario.id, profession: scenario.profession,
            requiredPetLevel: PET_EXPEDITION_ROUTES[route].requiredLevel,
            durationMinutes: PET_EXPEDITION_ROUTES[route].durationMinutes,
            dailyClaims, rewardMastery, risk, traitMultiplier,
            sealedRyoPerClaim: sealed.ryo,
            secureRyoPerClaim: returned(1), secureRyoPerDay: returned(1) * dailyClaims,
            investigateRyoExpectedPerDay: Math.round(choices.reduce((s, n) => s + n, 0) / choices.length * dailyClaims * 100) / 100,
            allInvestigationsSucceedRyoPerDay: Math.max(...choices) * dailyClaims,
        };
    }));
    const ev = blackMarketPullEv();
    const certificates = { rallyFirstPlace: rallyBrokerCertificates(1), rallySecondPlace: rallyBrokerCertificates(2), caravanSuccess: caravanBrokerCertificates(true), caravanFailure: caravanBrokerCertificates(false) };
    const successCertificates = certificates.rallyFirstPlace + certificates.caravanSuccess;
    return {
        basis: 'Code defaults; gross conditional scenarios, not measured completion times or a forecast for every player.',
        activityAnchor: [10, 30, 50, 70, 90].map(level => ({ level, ryoPerActiveMinute: anchorRyoPerMinute(level), standard90MinuteRyo: 90 * anchorRyoPerMinute(level) })),
        expeditions,
        expeditionAssumptions: [
            'Reward version 2 at the code-default scale; in-flight sealed rewards are unchanged.',
            'Relevant pet levels, sufficient available pets/slots, timely restarts, and happiness upkeep are required.',
            'Gross ryo excludes feeding, provisions and opportunity costs; daily claim caps are not proof every roster can fill them.',
            'All-investigation-success is a tail outcome, not expected income. Return rounding precedes daily aggregation.',
        ],
        broker: {
            paidPullCostRyo: BLACK_MARKET_COST, certificatePullCostRyo: BLACK_MARKET_CERTIFICATE_COST, expectedRewardPerPull: ev,
            paidPullNetRyo: brokerExpectedNetRyo(1, 0),
            certificatePullNetRyo: brokerExpectedNetRyo(0, 1),
            certificateAwards: certificates,
            dailySuccessScenario: { certificates: successCertificates, expectedRedemptionRyo: successCertificates * ev.ryo, expectedRedemptionNetRyo: brokerExpectedNetRyo(0, successCertificates) },
            netRyoFormula: '(expectedRewardRyo - certificateCostRyo) * certificatePulls + (expectedRewardRyo - paidCostRyo) * paidPulls; subtract actual Exchange fees separately',
            assumptions: [
                'First place in the daily Rally and a successful daily Caravan are conditional; their certificate sources predate the rebalance.',
                'A certificate covers half the stake (owner ruling 2026-10-23): redemption pays the gross reward, debits the other half, and consumes the existing daily Broker pull allowance. Earning a certificate is not immediate ryo.',
                'Direct Rally/Caravan rewards are additional; do not count certificate value again as activity ryo.',
                'Selling rewards to other players transfers existing ryo and burns the fee; resale profit is not new currency issuance.',
            ],
        },
    };
}
