/** Read-only code-default inventory. Run with node --import tsx, passing an output path. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LEGACY_DEFS } from '../api/_legacy-defs.js';
import { LEGACY_JUTSU_CATALOG } from '../api/pvp/_legacy-jutsu-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { OPPONENT_AFFECTING_TAGS } from '../api/pvp/_tags.js';
import { anchorRyoPerMinute } from '../shared/economy-anchor.js';
import { GEAR_CRAFT_RYO, supplyCraftRyo } from '../shared/craft-fees.js';
import { SUPPLY_CRAFT_RECIPES, standardSaleUnitValue } from '../shared/crafting-recipes.js';
import { saleCostBasis } from '../shared/shop-pricing.js';
import { economyIncomeForecasts } from './_economy-income-forecasts.js';
import { dailyLoginRyo } from '../api/player/_daily-login.js';
import { AI_FIGHT_HARD_CAP_PER_DAY, AI_FIGHT_SOFT_CAP_PER_DAY, AI_FIGHT_REDUCED_MULT, AI_FIGHT_PURSE_BASE, AI_FIGHT_PURSE_PER_LEVEL, MAX_AI_FIGHT_RYO } from '../api/missions/_ai-fight-reward.js';
import { FIELD_MISSIONS, COMBAT_MISSIONS, DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT } from '../api/missions/_mission-catalog.js';
import { BANK_INTEREST_PRINCIPAL_CAP, projectedBankInterest } from '../shared/bank-interest.js';

const levels = [10, 30, 50, 70, 90];
const effort = (ryo: number) => Object.fromEntries(levels.map(level => [level, Number((ryo / anchorRyoPerMinute(level)).toFixed(2))]));
const globals = Object.values(JUTSU_CATALOG).filter(j => j.id.startsWith('starter-'));
const report = {
    basis: 'Current repository defaults; no production overrides, telemetry, purchases or save writes. Active-minute prices are opportunity-cost scenarios, not measured earning rates.',
    legacies: LEGACY_DEFS.map(def => ({ id: def.id, name: def.name, rarity: def.rarity, category: def.category, requirements: def.reqs,
        signature: LEGACY_JUTSU_CATALOG[def.specialtyJutsuId!] })),
    globalJutsu: globals,
    globalElementBudgets: ['Earth', 'Wind', 'Lightning', 'Fire', 'Water'].map(element => {
        const kit = globals.filter(j => j.element === element);
        return { element, count: kit.length, damage: kit.filter(j => j.effectPower > 0).length,
            utility: kit.filter(j => j.effectPower === 0).length,
            totalDamageEp: kit.reduce((sum, j) => sum + j.effectPower, 0),
            ap: [...new Set(kit.map(j => j.ap))], cooldowns: [...new Set(kit.map(j => j.cooldown))] };
    }),
    selfBuffMetadata: globals.filter(j => j.effectPower === 0 && !j.tags.some(t => OPPONENT_AFFECTING_TAGS.has(t.name)) && j.target !== 'SELF').map(j => j.id),
    activeIncome: levels.map(level => ({ level, ryoPerMinute: anchorRyoPerMinute(level),
        casual30Minutes: 30 * anchorRyoPerMinute(level), regular90Minutes: 90 * anchorRyoPerMinute(level), intensive240Minutes: 240 * anchorRyoPerMinute(level) })),
    independentDailySources: levels.map(level => {
        const aiPurse = Math.min(MAX_AI_FIGHT_RYO, AI_FIGHT_PURSE_BASE + AI_FIGHT_PURSE_PER_LEVEL * level);
        const maxHunt = Math.max(...FIELD_MISSIONS.filter(m => m.id.startsWith('hunt-') && m.levelReq <= level).map(m => m.ryoReward));
        const maxFetch = Math.max(...FIELD_MISSIONS.filter(m => m.id.startsWith('fetch-') && m.levelReq <= level).map(m => m.ryoReward));
        return { level, login: dailyLoginRyo(level), ordinaryAiPurse: aiPurse,
            tenHuntsWithOneKillPurseEachAndLogin: 10 * maxHunt + 10 * aiPurse + dailyLoginRyo(level),
            ordinaryAi100WinDay: AI_FIGHT_SOFT_CAP_PER_DAY * aiPurse + (AI_FIGHT_HARD_CAP_PER_DAY - AI_FIGHT_SOFT_CAP_PER_DAY) * Math.floor(aiPurse * AI_FIGHT_REDUCED_MULT),
            bestHuntBase: maxHunt, twentyHuntClaims: DAILY_HUNT_LIMIT * maxHunt,
            bestFetchBase: maxFetch, twentyFetchClaims: DAILY_MISSION_LIMIT * maxFetch,
            bestCombatMissionBase: Math.max(...COMBAT_MISSIONS.filter(m => m.min <= level).map(m => m.ryo)),
            note: 'Separate activity scenarios, not additive daily totals. Hunt/mission completion, time, rank, caps and bonuses apply. Hunt rank can raise the 20-claim base cap to 25. Kill receipts must not be counted twice.' };
    }),
    bankMaximumDaily: projectedBankInterest(BANK_INTEREST_PRINCIPAL_CAP, .5),
    additionalIncomeScenarios: economyIncomeForecasts(),
    pricedCatalog: Object.values(ITEM_CATALOG).filter(item => Number(item.cost) > 0).map(item => ({
        id: item.id, name: item.name, rarity: item.rarity, slot: item.slot, levelReq: item.levelReq,
        cost: item.cost, saleBasis: saleCostBasis({ cost: item.cost!, saleBasis: item.saleBasis }),
        // Legendary/mythic shop prices use Fate Shards; do not call them ryo.
        currency: ['legendary', 'mythic'].includes(item.rarity) ? 'fateShards-or-special-source' : 'ryo',
        ...(!['legendary', 'mythic'].includes(item.rarity) ? { activeMinutes: effort(item.cost!) } : {}),
    })),
    gearCraftFees: Object.entries(GEAR_CRAFT_RYO).map(([rarity, ryo]) => ({ rarity, ryo, activeMinutes: effort(ryo), materialsAdditional: true })),
    supplyCrafts: Object.entries(SUPPLY_CRAFT_RECIPES).map(([id, recipe]) => {
        const item = ITEM_CATALOG[id], count = recipe.count ?? 1;
        const fee = supplyCraftRyo(id, item?.cost ?? 0, count);
        const resale = item ? standardSaleUnitValue(id, saleCostBasis({ cost: item.cost ?? 0, saleBasis: item.saleBasis })) * count : null;
        return { id, count, fee, shelfBatch: item ? (item.cost ?? 0) * count : null, resale,
            netBeforeMaterials: resale === null ? null : resale - fee, activeMinutes: effort(fee), ingredients: recipe.ingredients };
    }),
};
const output = resolve(process.argv[2] ?? '.tmp/balance-audit-20261028/catalog-economy.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const markdownArg = process.argv.indexOf('--markdown');
if (markdownArg >= 0) {
    const destination = process.argv[markdownArg + 1];
    if (!destination || destination.startsWith('--')) throw new Error('--markdown requires an output path');
    const cell = (value: unknown) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
    const tags = (j: typeof globals[number]) => j.tags.map(tag => `${tag.name}${tag.percent ? ` ${tag.percent}%` : ''}`).join('; ');
    const lines = [
        '# October 28, 2026 audit inventory', '',
        'Generated snapshot of repository defaults, not a new canonical catalog. See [the audit report](balance-audit-2026-10-28.md) for findings, assumptions and validation. Requirements below are authored qualification floors; live scoring, admin overrides and trial gates remain authoritative. Tag percentages are authored values before mastery and runtime caps. Resource costs are calculated at cast time by the live v2 rules.', '',
        '## All 100 legacy paths', '',
        '| Path / rarity | Identity | Qualification floors | Signature | Budget and delivery | Tags |',
        '| --- | --- | --- | --- | --- | --- |',
        ...report.legacies.map(row => {
            const j = row.signature;
            return '| ' + [
                `${row.name} (${row.id}) / ${row.rarity}`, row.category,
                row.requirements.map(req => 'stat' in req
                    ? `${req.stat} ≥ ${req.atLeast}${req.weight ? ` (weight ${req.weight})` : ''}`
                    : `any of: ${req.anyOf.map(option => `${option.stat} ≥ ${option.atLeast}`).join(' OR ')}`).join('; '),
                `${j.name} (${j.id})`, `${j.type}; ${j.ap} AP; ${j.effectPower} EP; range ${j.range}; cooldown ${j.cooldown}; ${j.method}`, tags(j),
            ].map(cell).join(' | ') + ' |';
        }), '', '## All 101 global techniques', '',
        '| Technique | Element / discipline | Budget and delivery | Tags |',
        '| --- | --- | --- | --- |',
        ...globals.map(j => '| ' + [`${j.name} (${j.id})`, `${j.element} / ${j.type}`,
            `${j.ap} AP; ${j.effectPower} EP; range ${j.range}; cooldown ${j.cooldown}; ${j.method}`, tags(j)].map(cell).join(' | ') + ' |'), '',
    ];
    const markdownOutput = resolve(destination);
    mkdirSync(dirname(markdownOutput), { recursive: true });
    writeFileSync(markdownOutput, lines.join('\n'));
}
console.log(JSON.stringify({ output, legacies: report.legacies.length, globalJutsu: globals.length,
    elementBudgets: report.globalElementBudgets, activeIncome: report.activeIncome,
    gearCraftFees: report.gearCraftFees, selfBuffMetadata: report.selfBuffMetadata.length,
    positiveCraftResaleBeforeMaterials: report.supplyCrafts.filter(row => (row.netBeforeMaterials ?? 0) > 0).map(row => ({ id: row.id, net: row.netBeforeMaterials })) }, null, 2));
