import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { EXCHANGE_CATEGORIES, EXCHANGE_CURRENCIES, EXCHANGE_FEE_PERCENT, EXCHANGE_LISTING_LIMIT, EXCHANGE_MARKET_PAGE_SIZE, EXCHANGE_MAX_PRICE, EXCHANGE_RARITY_ORDER, EXCHANGE_SALE_EVENT, exchangeCurrency, exchangeFee, exchangeMarketFilterKey, type ExchangeAsset, type ExchangeCategory, type ExchangeCurrency, type ExchangeListing, type ExchangeMarketPage, type ExchangeMarketQuery, type ExchangeMarketSort, type ExchangeOwnedAsset, type ExchangePurchaseReadiness } from '../../../shared/sunscar-exchange';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { GameItem } from '../types/combat';
import { Modal } from './ui/Modal';
import { getAllItems } from '../lib/items';
import { ExchangeRequestError, pendingExchangeRequest, requestExchange, requestExchangeMarket, requestExchangeReadiness, savePendingExchangeRequest, type ExchangeRequest, type ExchangeSnapshot } from '../lib/sunscar-exchange';
import { clearExchangeReturnContext, peekExchangeReturnContext, saveExchangeReturnContext } from '../lib/exchange-return';
import { setPetHomeTabHint } from './PetHomeTabs';
import type { Screen } from '../types/core';
import exchangeArt from '../assets/festival/sunscar-exchange-v1.webp';
import weaponArt from '../assets/clan-exchange/weaponCache.webp';
import armorArt from '../assets/clan-exchange/armorCache.webp';
import '../styles/sunscar-exchange.css';
import '../styles/sunscar-market-refined.css';

const money = (n: number) => n.toLocaleString('en-US');
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const playerSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
const rarityOrder: Readonly<Record<string, number>> = EXCHANGE_RARITY_ORDER;
const catalogArt = new Map(getAllItems([]).filter(item => item.image).map(item => [item.id, item.image!]));

export function SunscarExchangeEntrance({ onOpen }: { onOpen: () => void }) {
    return <section className="sunscar-exchange-entrance sunscar-poster">
        <div className="sunscar-poster-art"><img src={exchangeArt} alt="" /></div>
        <div className="sx-entrance-copy sunscar-poster-copy"><span className="sx-eyebrow">THE CARAVAN’S TRADING HALL</span>
            <h2>Sunscar Exchange</h2>
            <p>Find your next legend. Give another traveler theirs.</p>
            <div className="sunscar-poster-meta">Free to list<span>{EXCHANGE_FEE_PERCENT}% fee on sales</span></div>
            <button className="sx-primary" onClick={onOpen}>Enter the Exchange <span aria-hidden="true">↗</span></button>
            <small>Player-to-player trading · Ryo & Fate Shards</small>
        </div>
    </section>;
}

function AssetPortrait({ asset }: { asset: ExchangeAsset }) {
    const fallback = catalogArt.get(asset.id) ?? (asset.category === 'weapons' ? weaponArt : asset.category === 'armor' ? armorArt : undefined);
    const image = asset.image && /^(https?:\/\/|\/|data:image\/)/.test(asset.image) ? asset.image : fallback;
    const [failedSource, setFailedSource] = useState<string | null>(null);
    return <span className={`sx-asset-art sx-rarity-${asset.rarity}`}>
        {image && failedSource !== image ? <img src={image} alt="" loading="lazy" onError={() => setFailedSource(image)} /> : <span className="sx-asset-monogram">{asset.name.split(/\s+/).slice(0, 2).map(word => word[0]).join("")}</span>}
    </span>;
}

function AssetDetails({ asset }: { asset: ExchangeAsset }) {
    return <><div className="sx-detail-heading"><AssetPortrait asset={asset} /><div><span className={`sx-rarity sx-rarity-${asset.rarity}`}>{label(asset.rarity)} · {label(asset.category)}</span><h3>{asset.name}</h3>{asset.level != null && <small>{asset.kind === 'pet' ? 'Level' : 'Requires level'} {asset.level}</small>}</div></div>
        <p className="sx-description">{asset.description}</p>
        {asset.stats.length > 0 && <dl className="sx-stats">{asset.stats.map((stat, i) => <div key={`${stat.label}-${i}`}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>}
    </>;
}

type Props = { character: Character; onVersionedCharacter: VersionedCharacterCommit; setCreatorItems: Dispatch<SetStateAction<GameItem[]>>; onBack: () => void; onNavigate: (screen: Screen) => void };
type Tab = 'browse' | 'sell' | 'listings' | 'activity';
type ReadinessView = { kind: 'idle' | 'checking' | 'error'; message?: string } | { kind: 'result'; value: ExchangePurchaseReadiness };
export function SunscarExchange({ character, onVersionedCharacter, setCreatorItems, onBack, onNavigate }: Props) {
    const [returnContext] = useState(() => peekExchangeReturnContext(character.name));
    const [snapshot, setSnapshot] = useState<ExchangeSnapshot | null>(null);
    const [tab, setTab] = useState<Tab>('browse');
    const [category, setCategory] = useState<ExchangeCategory>(returnContext?.market.category ?? 'all');
    const [search, setSearch] = useState(returnContext?.market.search ?? '');
    const [rarity, setRarity] = useState(returnContext?.market.rarity ?? 'all');
    const [currencyFilter, setCurrencyFilter] = useState<ExchangeCurrency | 'all'>(returnContext?.market.currency ?? 'all');
    const [sort, setSort] = useState(returnContext?.market.sort ?? 'newest');
    const [affordable, setAffordable] = useState(returnContext?.market.affordable ?? false);
    const [page, setPage] = useState(returnContext?.market.page ?? 1);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const noticeRef = useRef<HTMLDivElement>(null);
    const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
    const [selected, setSelected] = useState<ExchangeListing | null>(null);
    const [returnListingId, setReturnListingId] = useState(returnContext?.listingId ?? '');
    const [readiness, setReadiness] = useState<ReadinessView>({ kind: 'idle' });
    const [readinessRetry, setReadinessRetry] = useState(0);
    const [sellAsset, setSellAsset] = useState<ExchangeOwnedAsset | null>(null);
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState('');
    const [saleCurrency, setSaleCurrency] = useState<ExchangeCurrency>('ryo');
    const [review, setReview] = useState(false);
    const [saleRevision, setSaleRevision] = useState(0);
    const refreshedSaleRevision = useRef(0);
    const [pendingRequest, setPendingRequest] = useState<ExchangeRequest | null>(() => pendingExchangeRequest(character.name));
    // The open market is filtered, sorted and paged by the server: one page
    // arrives instead of every live listing. `marketKey` is the query the page
    // in hand answers, so a reply for filters the player has already moved on
    // from is dropped instead of replacing what they are looking at.
    const [market, setMarket] = useState<ExchangeMarketPage | null>(null);
    const [marketKey, setMarketKey] = useState('');
    const [marketBusy, setMarketBusy] = useState(false);
    /** A server without market paging answered with every listing; filter locally. */
    const [legacyMarket, setLegacyMarket] = useState(false);
    const [searchTerm, setSearchTerm] = useState(returnContext?.market.search ?? '');
    const marketSeq = useRef(0);
    const marketFlight = useRef<AbortController | null>(null);
    const readinessFlight = useRef<AbortController | null>(null);
    const readinessSeq = useRef(0);
    // Targeted readiness is newer and more specific than a broad browse that
    // may already be in flight. Preserve that listing until inspection ends.
    const readinessListing = useRef<ExchangeListing | null>(null);
    const actionRef = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    const callbacks = useRef({ onVersionedCharacter, setCreatorItems });
    useEffect(() => { callbacks.current = { onVersionedCharacter, setCreatorItems }; }, [onVersionedCharacter, setCreatorItems]);
    const player = playerSlug(character.name);
    // A successful return replaces the saved id with the same selected id.
    // Keeping one derived target prevents that state handoff from checking the
    // same listing twice while still changing whenever the player chooses a
    // different listing.
    const readinessTargetId = selected?.seller === player ? '' : selected?.id ?? returnListingId;
    useEffect(() => {
        if (!notice) return;
        const frame = requestAnimationFrame(() => {
            noticeRef.current?.focus({ preventScroll: true });
            noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        });
        return () => cancelAnimationFrame(frame);
    }, [notice]);
    function changePage(nextPage: number) {
        setPage(nextPage);
        requestAnimationFrame(() => {
            resultsHeadingRef.current?.focus({ preventScroll: true });
            resultsHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        });
    }
    useEffect(() => {
        const onSale = (event: Event) => { if ((event as CustomEvent<{ seller?: string }>).detail?.seller === player) setSaleRevision(revision => revision + 1); };
        window.addEventListener(EXCHANGE_SALE_EVENT, onSale);
        return () => window.removeEventListener(EXCHANGE_SALE_EVENT, onSale);
    }, [player]);
    const balance = character.ryo;
    const shardBalance = character.fateShards ?? 0;
    const mine = useMemo(() => snapshot?.activity.filter(l => l.seller === player && ['active', 'preparing', 'buying', 'cancelling'].includes(l.state)) ?? [], [snapshot, player]);

    // Every field but the page decides the result set; the page then picks the
    // slice. Search is applied on a short delay so typing is not a request each
    // keystroke.
    const marketQuery: ExchangeMarketQuery = useMemo(() => ({
        v: 2, page, category, rarity, currency: currencyFilter,
        sort: (['newest', 'price-low', 'price-high', 'rarity'].includes(sort) ? sort : 'newest') as ExchangeMarketSort,
        search: searchTerm.slice(0, 80), affordable,
    }), [page, category, rarity, currencyFilter, sort, searchTerm, affordable]);
    const marketWanted = `${exchangeMarketFilterKey(marketQuery)}#${page}`;
    useEffect(() => {
        if (search === searchTerm) return;
        const timer = window.setTimeout(() => { setSearchTerm(search); setPage(1); }, 300);
        return () => window.clearTimeout(timer);
    }, [search, searchTerm]);

    const marketWantedRef = useRef(marketWanted);
    useEffect(() => { marketWantedRef.current = marketWanted; }, [marketWanted]);

    function acceptMarket(answered: ExchangeMarketPage, requestedKey: string) {
        // A reply for filters the player has already left is dropped; otherwise
        // adopt it, including the page the server clamped to when the one asked
        // for no longer exists.
        if (requestedKey !== marketWantedRef.current) return false;
        setMarket(answered);
        setMarketKey(`${exchangeMarketFilterKey(answered.query)}#${answered.page}`);
        setPage(current => (current === answered.page ? current : answered.page));
        return true;
    }

    /** Adopt a reply, or report that it is older than the character the app
     *  already holds — a save that committed while this request was in flight. */
    function accept(data: ExchangeSnapshot, requestedKey?: string) {
        if (!callbacks.current.onVersionedCharacter(data.character, data._saveVersion)) return false;
        callbacks.current.setCreatorItems(previous => {
            const items = new Map(previous.map(item => [item.id, item]));
            for (const item of data.creatorItems ?? []) items.set(item.id, item);
            return [...items.values()];
        });
        setSnapshot(data);
        if (data.market && requestedKey) acceptMarket(data.market, requestedKey);
        setLegacyMarket(!data.market && Array.isArray(data.listings));
        setSelected(previous => {
            if (!previous) return null;
            if (readinessListing.current?.id === previous.id) return readinessListing.current;
            return data.activity.find(listing => listing.id === previous.id)
                ?? data.market?.listings.find(listing => listing.id === previous.id)
                ?? data.listings?.find(listing => listing.id === previous.id) ?? null;
        });
        return true;
    }
    const staleReply = 'Your character changed while the Exchange was loading. Refresh to confirm the trade and latest balance.';

    async function run(action: ExchangeRequest) {
        const signal = lifetime.current?.signal;
        if (actionRef.current || !signal || signal.aborted) return;
        actionRef.current = true; setBusy(true); setError(''); setNotice('');
        const mutation = action.action !== 'browse';
        if (mutation) { setPendingRequest(action); savePendingExchangeRequest(character.name, action); }
        const requestedKey = marketWantedRef.current;
        try {
            const data = await requestExchange(character.name, action, signal, marketQuery);
            if (signal?.aborted) return;
            if (!accept(data, requestedKey)) {
                // A save committed while this was in flight, so the reply
                // describes an older character than the app holds. A trade has
                // to be confirmed by hand — its balance is the whole point. A
                // browse is only a read, and browsing no longer writes a save
                // of its own, so ask once more: that read sees the save this
                // one missed, instead of meeting the player with a refresh
                // prompt the screen can clear itself.
                if (mutation) throw new ExchangeRequestError(staleReply, true);
                const fresh = await requestExchange(character.name, action, signal, marketQuery);
                if (signal?.aborted) return;
                if (!accept(fresh, requestedKey)) throw new ExchangeRequestError(staleReply, false);
            }
            if (mutation) {
                setPendingRequest(null); savePendingExchangeRequest(character.name, null);
                readinessListing.current = null;
                setSelected(null); setSellAsset(null); setReview(false);
                setNotice(action.action === 'list' ? 'Listing published. Your goods are now held by the Exchange.' : action.action === 'buy' ? 'Purchase complete. Your goods have been delivered.' : 'Listing cancelled. Your goods have been returned.');
                if (action.action === 'list') setTab('listings');
            }
        } catch (caught) {
            if (signal?.aborted) return;
            setError(caught instanceof Error ? caught.message : 'Unable to reach the Exchange.');
            if (mutation && caught instanceof ExchangeRequestError && !caught.uncertain) { setPendingRequest(null); savePendingExchangeRequest(character.name, null); }
        } finally { actionRef.current = false; if (!signal?.aborted) setBusy(false); }
    }

    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        const timer = window.setTimeout(() => { void run(pendingExchangeRequest(character.name) ?? { action: 'browse' }); }, 0);
        return () => { window.clearTimeout(timer); controller.abort(); };
        // A player change remounts this screen; balances must not refetch on each commit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character.name]);

    useEffect(() => {
        const listingId = readinessTargetId;
        if (!listingId) return;
        const returnCheck = returnListingId === listingId;
        const lifetimeSignal = lifetime.current?.signal;
        if (!lifetimeSignal || lifetimeSignal.aborted) return;
        const controller = new AbortController();
        readinessFlight.current?.abort();
        readinessFlight.current = controller;
        const seq = ++readinessSeq.current;
        const requestedPlayer = player;
        const signal = AbortSignal.any([lifetimeSignal, controller.signal]);
        setReadiness({ kind: 'checking' });
        void requestExchangeReadiness(character.name, listingId, signal).then(answer => {
            if (signal.aborted || seq !== readinessSeq.current || requestedPlayer !== player || answer.listingId !== listingId) return;
            if (returnCheck) clearExchangeReturnContext(character.name);
            setReturnListingId('');
            readinessListing.current = answer.listing ?? null;
            if (answer.listing) setSelected(answer.listing);
            else {
                setSelected(null);
                setNotice(answer.message ?? 'That listing is no longer available. Your market view was restored.');
            }
            setReadiness({ kind: 'result', value: answer });
        }).catch(caught => {
            if (signal.aborted || seq !== readinessSeq.current || requestedPlayer !== player) return;
            const message = caught instanceof Error ? caught.message : 'Purchase readiness could not be checked.';
            setReadiness({ kind: 'error', message });
        });
        return () => controller.abort();
        // `readinessTargetId` deliberately owns the selected/return identity;
        // including each source separately would refetch during their handoff.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readinessTargetId, player, character.name, readinessRetry]);

    useEffect(() => {
        // Coalesce incoming sales, and never interrupt an unconfirmed trade.
        if (saleRevision === refreshedSaleRevision.current || busy || pendingRequest || actionRef.current) return;
        refreshedSaleRevision.current = saleRevision;
        void run({ action: 'browse' });
        // run uses this render's account and current callbacks; it is not a stable dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saleRevision, busy, pendingRequest]);

    // Fetch the market page whenever the browse tab wants filters or a page the
    // page in hand does not answer. Only the newest request is ever adopted, so
    // a slow reply cannot overwrite a newer filter or another account's market.
    useEffect(() => {
        const lifetimeSignal = lifetime.current?.signal;
        // `search !== searchTerm` means a keystroke is still settling. A keystroke
        // resets to page 1 immediately (the other tabs filter as you type), so on
        // page 2 that reset alone would ask the server for the page 1 the player
        // is already typing past. The settled term sets the page too, and fetches once.
        if (tab !== 'browse' || legacyMarket || !snapshot || busy || marketKey === marketWanted
            || search !== searchTerm || !lifetimeSignal || lifetimeSignal.aborted) return;
        const controller = new AbortController();
        marketFlight.current?.abort();
        marketFlight.current = controller;
        const seq = ++marketSeq.current;
        const requestedKey = marketWanted;
        const signal = AbortSignal.any([lifetimeSignal, controller.signal]);
        setMarketBusy(true);
        void (async () => {
            try {
                const answered = await requestExchangeMarket(character.name, marketQuery, signal);
                if (seq !== marketSeq.current || signal.aborted) return;
                acceptMarket(answered, requestedKey);
                setError('');
            } catch (caught) {
                if (seq !== marketSeq.current || signal.aborted) return;
                setError(caught instanceof Error ? caught.message : 'Unable to reach the Exchange.');
            } finally { if (seq === marketSeq.current) setMarketBusy(false); }
        })();
        return () => controller.abort();
        // acceptMarket/marketQuery follow marketWanted; the account remounts this screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, legacyMarket, snapshot, busy, marketKey, marketWanted, search, searchTerm, character.name]);
    useEffect(() => () => marketFlight.current?.abort(), []);

    // The open market arrives already filtered, sorted and paged (a server
    // without market paging still sends every listing, and those are filtered
    // here exactly as before). Your own collection, listings and history are
    // bounded per player and stay local.
    const serverPaged = tab === 'browse' && !legacyMarket && !!market;
    const rows = useMemo(() => {
        if (tab === 'browse' && !legacyMarket) return (market?.listings ?? []) as Array<ExchangeListing | ExchangeOwnedAsset>;
        const data: Array<ExchangeListing | ExchangeOwnedAsset> = tab === 'sell' ? snapshot?.inventory ?? [] : tab === 'listings' ? mine : tab === 'activity' ? snapshot?.activity.filter(l => ['sold', 'cancelled', 'failed'].includes(l.state)) ?? [] : snapshot?.listings ?? [];
        return data.filter(row => {
            const asset = 'asset' in row ? row.asset : row;
            return (category === 'all' || asset.category === category) && (rarity === 'all' || asset.rarity === rarity)
                && (currencyFilter === 'all' || !('price' in row) || exchangeCurrency(row) === currencyFilter)
                && `${asset.name} ${asset.description} ${'sellerName' in row ? row.sellerName : ''}`.toLowerCase().includes(search.toLowerCase().trim())
                && (!affordable || !('price' in row) || row.price <= (exchangeCurrency(row) === 'fateShards' ? shardBalance : balance));
        }).sort((a, b) => {
            if (sort.startsWith('price-') && 'price' in a && 'price' in b && exchangeCurrency(a) !== exchangeCurrency(b)) return exchangeCurrency(a) === 'ryo' ? -1 : 1;
            if (sort === 'price-low' && 'price' in a && 'price' in b) return a.price - b.price;
            if (sort === 'price-high' && 'price' in a && 'price' in b) return b.price - a.price;
            if (sort === 'rarity') return (rarityOrder[('asset' in b ? b.asset : b).rarity] ?? 0) - (rarityOrder[('asset' in a ? a.asset : a).rarity] ?? 0);
            return 'createdAt' in a && 'createdAt' in b ? b.createdAt - a.createdAt : ('asset' in a ? a.asset : a).name.localeCompare(('asset' in b ? b.asset : b).name);
        });
    }, [snapshot, tab, category, rarity, currencyFilter, search, affordable, balance, shardBalance, sort, mine, market, legacyMarket]);
    const resultCount = serverPaged ? market!.total : rows.length;
    const pages = serverPaged ? market!.pages : Math.max(1, Math.ceil(rows.length / EXCHANGE_MARKET_PAGE_SIZE));
    const currentPage = serverPaged ? market!.page : Math.min(page, pages);
    const visibleRows = serverPaged ? rows : rows.slice((currentPage - 1) * EXCHANGE_MARKET_PAGE_SIZE, currentPage * EXCHANGE_MARKET_PAGE_SIZE);
    const qty = Number(quantity), total = Number(price);
    const validSale = Number.isSafeInteger(qty) && qty >= 1 && qty <= Math.min(sellAsset?.quantity ?? 0, 9999) && (sellAsset?.kind !== 'pet' || qty === 1)
        && Number.isSafeInteger(total) && total >= 1 && total <= EXCHANGE_MAX_PRICE;
    const nothingToShowYet = !snapshot || (tab === 'browse' && !legacyMarket && !market);
    const resetFilters = () => { setCategory('all'); setSearch(''); setSearchTerm(''); setRarity('all'); setCurrencyFilter('all'); setAffordable(false); setPage(1); };
    const closeDetails = () => { readinessFlight.current?.abort(); readinessListing.current = null; setSelected(null); setSellAsset(null); setReview(false); setReadiness({ kind: 'idle' }); };
    const tradeDisabled = busy || !!pendingRequest;
    const selectedCurrency = selected ? exchangeCurrency(selected) : 'ryo';
    const selectedUnit = EXCHANGE_CURRENCIES[selectedCurrency];
    const selectedBalance = selectedCurrency === 'fateShards' ? shardBalance : balance;
    const balanceAfterPurchase = selected ? selectedBalance - selected.price + (selected.asset.kind === 'resource' && selected.asset.id === selectedCurrency ? selected.quantity : 0) : selectedBalance;
    const saleUnit = EXCHANGE_CURRENCIES[saleCurrency];
    const readinessResult = readiness.kind === 'result' ? readiness.value : null;
    const buyBlock = selected?.seller === player ? '' : readiness.kind === 'checking' ? 'Checking current purchase requirements…'
        : readiness.kind === 'error' ? readiness.message ?? 'Purchase readiness is unknown.'
        : readinessResult?.status === 'blocked' ? readinessResult.message ?? 'This purchase is currently blocked.'
        : readinessResult?.status === 'ready' ? '' : 'Purchase readiness has not been verified.';
    const buyReady = readinessResult?.status === 'ready' && readinessResult.listingId === selected?.id;
    const retryReadiness = () => setReadinessRetry(value => value + 1);
    const cancelReturnCheck = () => {
        readinessFlight.current?.abort();
        clearExchangeReturnContext(character.name);
        setReturnListingId('');
        readinessListing.current = null;
        setReadiness({ kind: 'idle' });
        setNotice('Your market view was restored.');
    };
    const inspectListing = (listing: ExchangeListing) => {
        setError('');
        readinessListing.current = null;
        if (returnListingId && returnListingId !== listing.id) {
            clearExchangeReturnContext(character.name);
            setReturnListingId('');
        }
        setSelected(listing);
        setReadiness({ kind: 'idle' });
    };
    function prepareForPurchase() {
        if (!selected || readinessResult?.status !== 'blocked' || !readinessResult.prepare) return;
        saveExchangeReturnContext(character.name, selected.id, marketQuery);
        if (readinessResult.prepare.screen === 'home' && readinessResult.prepare.section === 'sanctuary') setPetHomeTabHint('sanctuary');
        const destination = readinessResult.prepare.screen;
        closeDetails();
        onNavigate(destination);
    }

    return <div className="sx-hall sx-refined">
        <header className="sx-hero" style={{ backgroundImage: `linear-gradient(90deg, #090f16ef, #090f1660 60%, #090f1610), linear-gradient(0deg, #0c1115, transparent 70%), url(${exchangeArt})` }}>
            <button className="sx-back" onClick={onBack}>← Sunscar Festival</button>
            <div className="sx-hero-copy"><span className="sx-eyebrow">SUNSCAR / THE TRADING QUARTER</span><h1>Sunscar <em>Exchange</em></h1><p>A new chapter for every treasure.</p></div>
            <div className="sx-hero-footer"><span>Player marketplace</span><span>Free to list · {EXCHANGE_FEE_PERCENT}% fee on sales</span></div>
            <div className="sx-wallet" aria-label="Your balances"><span>YOUR PURSE</span><div><strong>{money(balance)} <small>ryo</small></strong><strong className="sx-shard-balance">{money(shardBalance)} <small>Fate Shards</small></strong></div></div>
        </header>
        <nav className="sx-tabs" aria-label="Exchange sections">{([['browse', 'Browse market'], ['sell', 'Sell an asset'], ['listings', `My listings (${mine.length})`], ['activity', 'Trade history']] as const).map(([id, name]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); resetFilters(); }}>{name}</button>)}<button className="sx-refresh" aria-label={busy ? 'Updating Exchange' : 'Refresh Exchange'} onClick={() => void run(pendingRequest ?? { action: 'browse' })} disabled={busy}>↻ <span>{busy ? 'Updating…' : 'Refresh'}</span></button></nav>
        {error && <div className="sx-message sx-error" role="alert">{error}<button onClick={() => void run(pendingRequest ?? { action: 'browse' })} disabled={busy}>{pendingRequest ? 'Retry saved trade' : 'Try again'}</button></div>}
        {pendingRequest && !error && !busy && <div className="sx-message" role="status">A saved trade is awaiting confirmation.<button onClick={() => void run(pendingRequest)}>Retry saved trade</button></div>}
        {notice && <div ref={noticeRef} tabIndex={-1} className="sx-message sx-success" role="status">{notice}</div>}
        {returnListingId && readiness.kind === 'error' && <div className="sx-message sx-error" role="status">{readiness.message ?? 'Purchase readiness could not be checked.'}<button type="button" onClick={retryReadiness}>Retry listing check</button><button type="button" onClick={cancelReturnCheck}>Keep browsing</button></div>}
        {snapshot?.recoveryErrors.map(message => <div className="sx-message sx-error" role="status" key={message}>{message}</div>)}
        <div className="sx-workspace"><aside className="sx-categories"><span className="sx-eyebrow">COLLECTIONS</span>{EXCHANGE_CATEGORIES.map(id => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setPage(1); }}><span>{id === 'all' ? 'All treasures' : label(id)}</span><span className="sx-category-mark" aria-hidden="true">{category === id ? '—' : '›'}</span></button>)}<div className="sx-trade-note"><strong>The Exchange ledger</strong><p>Goods are held until sold or cancelled.</p><small>{EXCHANGE_LISTING_LIMIT} open listings per player.</small></div></aside>
            <section className="sx-market" aria-label="Exchange inventory" aria-busy={busy || marketBusy}>
                <div className="sx-section-heading"><div><span className="sx-eyebrow">{tab === 'sell' ? 'FROM YOUR COLLECTION' : tab === 'activity' ? 'YOUR TRADE LEDGER' : 'THE OPEN MARKET'}</span><h2 ref={resultsHeadingRef} tabIndex={-1}>{tab === 'sell' ? 'Choose a treasure to sell' : tab === 'listings' ? 'Your listings' : tab === 'activity' ? 'Trade history' : category === 'all' ? 'Browse the Exchange' : label(category)}</h2></div><span className="sx-count">{resultCount} {tab === 'sell' ? 'assets' : 'listings'}</span></div>
                {tab === 'sell' && <p className="sx-help">Choose an asset, set a price in ryo or Fate Shards, then review your listing. Unequip gear and free busy companions first. Named gear keeps its forged attributes.</p>}
                <div className={`sx-filters${tab === 'sell' ? ' sx-filters-inventory' : ''}`}><label className="sx-search"><span className="sx-sr-only">Search the Exchange</span><input type="search" placeholder="Search treasures, companions, sellers…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label><label><span className="sx-sr-only">Rarity</span><select aria-label="Rarity" value={rarity} onChange={e => { setRarity(e.target.value); setPage(1); }}><option value="all">All rarities</option>{Object.keys(rarityOrder).filter(s => s !== 'standard').map(s => <option key={s} value={s}>{label(s)}</option>)}<option value="standard">Standard</option></select></label>{tab !== 'sell' && <label><span className="sx-sr-only">Listing currency</span><select aria-label="Listing currency" value={currencyFilter} onChange={e => { setCurrencyFilter(e.target.value as ExchangeCurrency | 'all'); setPage(1); }}><option value="all">All currencies</option><option value="ryo">Ryo</option><option value="fateShards">Fate Shards</option></select></label>}<label><span className="sx-sr-only">Sort listings</span><select aria-label="Sort listings" value={sort} onChange={e => setSort(e.target.value as ExchangeMarketSort)}><option value="newest">{tab === 'sell' ? 'Name A–Z' : 'Newest first'}</option>{tab !== 'sell' && <><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></>}<option value="rarity">Rarity: highest first</option></select></label></div>
                {tab !== 'sell' && currencyFilter === 'all' && sort.startsWith('price-') && <p className="sx-help sx-sort-note">Prices are sorted within each currency: ryo, then Fate Shards.</p>}
                {tab === 'browse' && <label className="sx-affordable"><input type="checkbox" checked={affordable} onChange={e => { setAffordable(e.target.checked); setPage(1); }} /> Within my budget</label>}
                {nothingToShowYet && (busy || marketBusy) ? <div className="sx-loading" role="status"><div className="sx-skeleton" /><div className="sx-skeleton" /><div className="sx-skeleton" /><p>Opening the trade ledger…</p></div> : !snapshot ? <div className="sx-empty"><h3>The trade ledger is unavailable</h3><p>Reconnect to browse the latest listings.</p><button onClick={() => void run({ action: 'browse' })} disabled={busy}>Reconnect</button></div> : resultCount === 0 ? <div className="sx-empty"><h3>{search || category !== 'all' || rarity !== 'all' || currencyFilter !== 'all' || affordable ? 'No treasures match these filters' : tab === 'sell' ? 'Your trading satchel is empty' : tab === 'activity' ? 'No trades recorded yet' : tab === 'listings' ? 'Your stall is ready' : 'The market is quiet'}</h3><p>{tab === 'sell' ? 'Bring items in your backpack, companions, cards, or resources to list here.' : tab === 'activity' ? 'Completed purchases, sales, and cancellations appear here.' : 'List a treasure from your collection or return for fresh arrivals.'}</p>{search || category !== 'all' || rarity !== 'all' || currencyFilter !== 'all' || affordable ? <button onClick={resetFilters}>Clear filters</button> : tab !== 'sell' && <button className="sx-primary" onClick={() => { setTab('sell'); resetFilters(); }}>Create your first listing</button>}</div> : <div className="sx-listings">{visibleRows.map(row => {
                    const isListing = 'asset' in row; const asset = isListing ? row.asset : row;
                    return <button key={isListing ? row.id : `${row.kind}:${row.id}`} className={`sx-listing sx-border-${asset.rarity}`} onClick={() => { setError(''); if (isListing) inspectListing(row); else { setSellAsset(row); setQuantity('1'); setPrice(''); setSaleCurrency('ryo'); setReview(false); } }}>
                        <AssetPortrait asset={asset} /><div className="sx-listing-name"><span className={`sx-rarity sx-rarity-${asset.rarity}`}>{label(asset.rarity)} · {label(asset.category)}</span><strong>{asset.name}</strong><small>{isListing ? `From ${row.sellerName}${row.seller === player ? ' · Your listing' : ''}` : row.unavailable ?? `${money(row.quantity)} available`}</small></div>
                        <div className="sx-listing-meta"><span>{isListing ? `×${money(row.quantity)}` : asset.level ? `Lv. ${asset.level}` : 'Owned'}</span>{isListing ? <><strong>{money(row.price)} <small>{EXCHANGE_CURRENCIES[exchangeCurrency(row)]}</small></strong><small>{tab === 'activity' || row.state !== 'active' ? label(row.state) : row.quantity > 1 ? `${money(Math.round(row.price / row.quantity))} ${EXCHANGE_CURRENCIES[exchangeCurrency(row)]} / unit` : 'View listing →'}</small></> : <strong>{row.unavailable ? 'View details' : 'List asset →'}</strong>}</div>
                    </button>;
                })}</div>}
                {pages > 1 && <nav className="sx-pagination" aria-label="Listing pages"><button disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>← Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>Next →</button></nav>}
                <footer className="sx-market-footer"><span>Fixed prices · Whole lots · Instant delivery</span><span>Ryo & Fate Shards</span></footer>
            </section>
        </div>
        <Modal open={!!selected || !!sellAsset} onClose={closeDetails} title={sellAsset ? review ? 'Review your listing' : 'Create a listing' : 'Inspect listing'} size="md" className="sx-dialog" disableBackdropClose={busy}>
            {selected && <><AssetDetails asset={selected.asset} /><dl className="sx-checkout"><div><dt>Seller</dt><dd>{selected.sellerName}</dd></div><div><dt>Quantity</dt><dd>{money(selected.quantity)}</dd></div><div><dt>Total price</dt><dd>{money(selected.price)} {selectedUnit}</dd></div>{selected.seller === player ? <><div><dt>Exchange fee ({EXCHANGE_FEE_PERCENT}%)</dt><dd>{money(selected.fee)} {selectedUnit}</dd></div><div className="sx-total"><dt>You receive when sold</dt><dd>{money(selected.proceeds)} {selectedUnit}</dd></div></> : <div className="sx-total"><dt>Balance after purchase</dt><dd>{selected.price > selectedBalance ? `Insufficient ${selectedUnit}` : `${money(balanceAfterPurchase)} ${selectedUnit}`}</dd></div>}</dl>
                {buyBlock && selected.seller !== player && <p id="sx-purchase-readiness" className="sx-help" role={readiness.kind === 'error' ? 'status' : undefined}>{buyBlock}</p>}
                {readinessResult?.status === 'blocked' && readinessResult.prepare && selected.seller !== player && <button type="button" onClick={prepareForPurchase}>{readinessResult.prepare.label}</button>}
                {readiness.kind === 'error' && selected.seller !== player && <button type="button" onClick={retryReadiness}>Retry purchase check</button>}
                {selected.state === 'active' && <div className="sx-dialog-actions"><button onClick={closeDetails}>Keep browsing</button>{selected.seller === player ? <button className="sx-primary" onClick={() => void run({ action: 'cancel', listingId: selected.id })} disabled={tradeDisabled}>Cancel listing & return goods</button> : <button className="sx-primary" aria-describedby={buyBlock ? "sx-purchase-readiness" : undefined} onClick={() => void run({ action: 'buy', listingId: selected.id, expectedPrice: selected.price, expectedCurrency: selectedCurrency })} disabled={tradeDisabled || !buyReady}>Buy for {money(selected.price)} {selectedUnit}</button>}</div>}
                {selected.state !== 'active' && <p className="sx-help">Status: {label(selected.state)}{selected.completedAt ? ` · ${new Date(selected.completedAt).toLocaleString()}` : ''}</p>}
            </>}
            {sellAsset && <><AssetDetails asset={sellAsset} />{sellAsset.unavailable ? <p className="sx-message sx-error">{sellAsset.unavailable}</p> : <form onSubmit={e => { e.preventDefault(); if (!validSale || tradeDisabled) return; if (!review) { setReview(true); return; } void run({ action: 'list', requestId: crypto.randomUUID(), kind: sellAsset.kind, assetId: sellAsset.id, quantity: qty, price: total, currency: saleCurrency }); }}>
                {!review ? <div className="sx-sell-fields"><label className="sx-sale-currency">Payment currency <small>Buyers pay and you receive this currency</small><select aria-label="Payment currency" value={saleCurrency} onChange={e => setSaleCurrency(e.target.value as ExchangeCurrency)} disabled={busy}><option value="ryo">Ryo</option><option value="fateShards">Fate Shards</option></select></label><label>Quantity <small>{money(sellAsset.quantity)} owned</small><input type="number" inputMode="numeric" min="1" max={sellAsset.kind === 'pet' ? 1 : Math.min(9999, sellAsset.quantity)} step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy || sellAsset.kind === 'pet'} /></label><label>Total asking price <small>For the entire lot, in {saleUnit}</small><input type="number" inputMode="numeric" min="1" max={EXCHANGE_MAX_PRICE} step="1" placeholder="Enter a price" required value={price} onChange={e => setPrice(e.target.value)} disabled={busy} /></label></div> : <p className="sx-description">List <strong>{money(qty)} × {sellAsset.name}</strong> for <strong>{money(total)} {saleUnit}</strong>? Your goods leave your inventory and stay at the Exchange until this listing sells or you cancel it.</p>}
                <dl className="sx-checkout"><div><dt>Listing charge</dt><dd>Free</dd></div><div><dt>Fee when sold ({EXCHANGE_FEE_PERCENT}%)</dt><dd>{validSale ? money(exchangeFee(total)) : '—'} {saleUnit}</dd></div><div className="sx-total"><dt>You receive when sold</dt><dd>{validSale ? money(total - exchangeFee(total)) : '—'} {saleUnit}</dd></div></dl>
                {mine.length >= EXCHANGE_LISTING_LIMIT && <p className="sx-help">All {EXCHANGE_LISTING_LIMIT} listing slots are in use. Cancel or sell a listing first.</p>}
                <div className="sx-dialog-actions"><button type="button" onClick={() => review ? setReview(false) : closeDetails()}>{review ? 'Edit listing' : 'Back'}</button><button className="sx-primary" type="submit" disabled={!validSale || tradeDisabled || mine.length >= EXCHANGE_LISTING_LIMIT}>{busy ? 'Publishing…' : review ? 'Publish listing' : 'Review listing →'}</button></div>
            </form>}</>}
            {error && <div className="sx-message sx-error" role="alert">{error}{pendingRequest && <button onClick={() => void run(pendingRequest)} disabled={busy}>Retry saved trade</button>}</div>}
        </Modal>
    </div>;
}
