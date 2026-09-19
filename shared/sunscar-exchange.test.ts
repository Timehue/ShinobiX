import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    EXCHANGE_MARKET_DEFAULT_QUERY,
    EXCHANGE_MARKET_PAGE_SIZE,
    EXCHANGE_MARKET_SEARCH_MAX,
    compareExchangeMarketRows,
    exchangeMarketFilterKey,
    exchangeMarketMatches,
    isExchangeMarketPage,
    parseExchangeMarketQuery,
    type ExchangeMarketQuery,
    type ExchangeMarketRow,
} from './sunscar-exchange.js';

/*
 * The market query is the one definition the server filters and sorts with and
 * the Exchange screen's controls speak. If the two ever disagreed, a page
 * would show something other than what the filters say.
 */

const query = (over: Partial<ExchangeMarketQuery> = {}): ExchangeMarketQuery => ({ ...EXCHANGE_MARKET_DEFAULT_QUERY, ...over });
const row = (over: Partial<ExchangeMarketRow> = {}): ExchangeMarketRow => ({
    id: 'a', sellerName: 'Rin', price: 100, currency: 'ryo', createdAt: 1_000,
    name: 'Ember Blade', description: 'A blade from the dunes.', category: 'weapons', rarity: 'rare', ...over,
});

describe('exchange market query validation', () => {
    it('accepts the defaults and every supported control value', () => {
        assert.deepEqual(parseExchangeMarketQuery(EXCHANGE_MARKET_DEFAULT_QUERY), EXCHANGE_MARKET_DEFAULT_QUERY);
        for (const over of [{ category: 'pets' as const }, { rarity: 'named' }, { rarity: 'standard' }, { currency: 'fateShards' as const },
            { sort: 'price-low' as const }, { sort: 'price-high' as const }, { sort: 'rarity' as const }, { search: 'ember' }, { affordable: true }, { page: 40 }]) {
            assert.deepEqual(parseExchangeMarketQuery(query(over)), query(over), JSON.stringify(over));
        }
    });

    it('refuses anything a control could not have produced', () => {
        for (const bad of [null, 'browse', [], { v: 1 }, query({ page: 0 }), query({ page: 1.5 }), query({ category: 'treasure' as never }),
            query({ rarity: 'shiny' }), query({ currency: 'gold' as never }), query({ sort: 'cheapest' as never }),
            query({ search: 'x'.repeat(EXCHANGE_MARKET_SEARCH_MAX + 1) }), query({ affordable: 'yes' as never })]) {
            assert.equal(parseExchangeMarketQuery(bad), null, JSON.stringify(bad));
        }
    });

    it('identifies a result set by everything except the page', () => {
        assert.equal(exchangeMarketFilterKey(query({ page: 1 })), exchangeMarketFilterKey(query({ page: 7 })));
        assert.notEqual(exchangeMarketFilterKey(query({ rarity: 'rare' })), exchangeMarketFilterKey(query()));
        assert.equal(exchangeMarketFilterKey(query({ search: '  Ember ' })), exchangeMarketFilterKey(query({ search: 'ember' })));
    });

    it('validates a page the way a client must before trusting it', () => {
        const page = { v: 2 as const, query: query(), page: 1, pageSize: EXCHANGE_MARKET_PAGE_SIZE, pages: 1, total: 0, listings: [] };
        assert.equal(isExchangeMarketPage(page), true);
        assert.equal(isExchangeMarketPage({ ...page, pageSize: 50 }), false);
        assert.equal(isExchangeMarketPage({ ...page, page: 2 }), false, 'a page beyond the page count is not a page');
        assert.equal(isExchangeMarketPage({ ...page, listings: new Array(EXCHANGE_MARKET_PAGE_SIZE + 1).fill({}) }), false);
        assert.equal(isExchangeMarketPage(undefined), false);
    });
});

describe('exchange market filters', () => {
    const purse = { ryo: 1_000, fateShards: 50 };

    it('matches category, rarity and currency exactly', () => {
        assert.equal(exchangeMarketMatches(query({ category: 'weapons' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ category: 'pets' }), row(), purse), false);
        assert.equal(exchangeMarketMatches(query({ rarity: 'rare' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ rarity: 'epic' }), row(), purse), false);
        assert.equal(exchangeMarketMatches(query({ currency: 'ryo' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ currency: 'fateShards' }), row(), purse), false);
        // A listing from before currency selection is priced in ryo.
        assert.equal(exchangeMarketMatches(query({ currency: 'ryo' }), row({ currency: undefined }), purse), true);
    });

    it('searches the name, the description and the seller, case- and space-insensitively', () => {
        assert.equal(exchangeMarketMatches(query({ search: 'EMBER' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ search: '  dunes ' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ search: 'rin' }), row(), purse), true);
        assert.equal(exchangeMarketMatches(query({ search: 'frost' }), row(), purse), false);
    });

    it('measures affordability only against the listing\'s own currency', () => {
        // 100 Fate Shards is out of reach on a 50-shard purse, however much ryo
        // is in it: the two are never exchanged for one another.
        assert.equal(exchangeMarketMatches(query({ affordable: true }), row({ price: 100, currency: 'fateShards' }), purse), false);
        assert.equal(exchangeMarketMatches(query({ affordable: true }), row({ price: 40, currency: 'fateShards' }), purse), true);
        assert.equal(exchangeMarketMatches(query({ affordable: true }), row({ price: 900, currency: 'ryo' }), purse), true);
        assert.equal(exchangeMarketMatches(query({ affordable: true }), row({ price: 1_100, currency: 'ryo' }), purse), false);
        // Whole-lot pricing: the filter compares the lot price, never a unit price.
        assert.equal(exchangeMarketMatches(query({ affordable: true }), row({ price: 1_000 }), purse), true);
    });
});

describe('exchange market ordering', () => {
    const sortRows = (sort: ExchangeMarketQuery['sort'], rows: ExchangeMarketRow[]) =>
        [...rows].sort((a, b) => compareExchangeMarketRows(sort, a, b)).map(r => r.id);

    it('keeps ryo and Fate Shards apart in price sorts instead of comparing them', () => {
        const rows = [row({ id: 'shard-cheap', price: 1, currency: 'fateShards' }), row({ id: 'ryo-dear', price: 99_999 }), row({ id: 'ryo-cheap', price: 5 })];
        assert.deepEqual(sortRows('price-low', rows), ['ryo-cheap', 'ryo-dear', 'shard-cheap']);
        assert.deepEqual(sortRows('price-high', rows), ['ryo-dear', 'ryo-cheap', 'shard-cheap']);
    });

    it('sorts newest first and rarest first', () => {
        const rows = [row({ id: 'old', createdAt: 1 }), row({ id: 'new', createdAt: 9 })];
        assert.deepEqual(sortRows('newest', rows), ['new', 'old']);
        const byRarity = [row({ id: 'common', rarity: 'common' }), row({ id: 'named', rarity: 'named' }), row({ id: 'epic', rarity: 'epic' })];
        assert.deepEqual(sortRows('rarity', byRarity), ['named', 'epic', 'common']);
        assert.deepEqual(sortRows('rarity', [...byRarity].reverse()), ['named', 'epic', 'common']);
    });

    it('breaks every tie the same way, so pages never overlap or skip', () => {
        const tied = ['c', 'a', 'b'].map(id => row({ id, price: 100, createdAt: 5, rarity: 'rare' }));
        for (const sort of ['newest', 'price-low', 'price-high', 'rarity'] as const) {
            assert.deepEqual(sortRows(sort, tied), ['a', 'b', 'c'], sort);
            assert.deepEqual(sortRows(sort, [...tied].reverse()), ['a', 'b', 'c'], `${sort} (reversed input)`);
        }
        // Newer first even when the sort key ties.
        assert.deepEqual(sortRows('price-low', [row({ id: 'a', price: 5, createdAt: 1 }), row({ id: 'b', price: 5, createdAt: 2 })]), ['b', 'a']);
    });
});
