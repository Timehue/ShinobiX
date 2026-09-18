import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { EXCHANGE_CATEGORIES, EXCHANGE_CURRENCIES, EXCHANGE_FEE_PERCENT, EXCHANGE_LISTING_LIMIT, EXCHANGE_MAX_PRICE, EXCHANGE_SALE_EVENT, exchangeCurrency, exchangeFee, type ExchangeAsset, type ExchangeCategory, type ExchangeCurrency, type ExchangeListing, type ExchangeOwnedAsset } from '../../../shared/sunscar-exchange';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { GameItem } from '../types/combat';
import { Modal } from './ui/Modal';
import { getAllItems } from '../lib/items';
import { ExchangeRequestError, pendingExchangeRequest, requestExchange, savePendingExchangeRequest, type ExchangeRequest, type ExchangeSnapshot } from '../lib/sunscar-exchange';
import exchangeArt from '../assets/festival/sunscar-exchange-v1.webp';
import weaponArt from '../assets/clan-exchange/weaponCache.webp';
import armorArt from '../assets/clan-exchange/armorCache.webp';
import '../styles/sunscar-exchange.css';
import '../styles/sunscar-market-refined.css';

const money = (n: number) => n.toLocaleString('en-US');
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const playerSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
const rarityOrder: Record<string, number> = { named: 7, mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1, standard: 1 };
const catalogArt = new Map(getAllItems([]).filter(item => item.image).map(item => [item.id, item.image!]));

export function SunscarExchangeEntrance({ onOpen }: { onOpen: () => void }) {
    return <section className="sunscar-card sunscar-exchange-entrance" style={{ backgroundImage: `linear-gradient(0deg, #161c1a 5%, rgba(18,24,22,.15) 100%), url(${exchangeArt})` }}>
        <div className="sx-entrance-copy"><span className="sx-eyebrow">THE CARAVAN’S TRADING HALL</span>
            <h2>Sunscar Exchange</h2>
            <p>Find your next legend. Give another traveler theirs.</p>
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

type Props = { character: Character; onVersionedCharacter: VersionedCharacterCommit; setCreatorItems: Dispatch<SetStateAction<GameItem[]>>; onBack: () => void };
type Tab = 'browse' | 'sell' | 'listings' | 'activity';
export function SunscarExchange({ character, onVersionedCharacter, setCreatorItems, onBack }: Props) {
    const [snapshot, setSnapshot] = useState<ExchangeSnapshot | null>(null);
    const [tab, setTab] = useState<Tab>('browse');
    const [category, setCategory] = useState<ExchangeCategory>('all');
    const [search, setSearch] = useState('');
    const [rarity, setRarity] = useState('all');
    const [currencyFilter, setCurrencyFilter] = useState<ExchangeCurrency | 'all'>('all');
    const [sort, setSort] = useState('newest');
    const [affordable, setAffordable] = useState(false);
    const [page, setPage] = useState(1);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const noticeRef = useRef<HTMLDivElement>(null);
    const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
    const [selected, setSelected] = useState<ExchangeListing | null>(null);
    const [sellAsset, setSellAsset] = useState<ExchangeOwnedAsset | null>(null);
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState('');
    const [saleCurrency, setSaleCurrency] = useState<ExchangeCurrency>('ryo');
    const [review, setReview] = useState(false);
    const [saleRevision, setSaleRevision] = useState(0);
    const refreshedSaleRevision = useRef(0);
    const [pendingRequest, setPendingRequest] = useState<ExchangeRequest | null>(() => pendingExchangeRequest(character.name));
    const actionRef = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    const callbacks = useRef({ onVersionedCharacter, setCreatorItems });
    useEffect(() => { callbacks.current = { onVersionedCharacter, setCreatorItems }; }, [onVersionedCharacter, setCreatorItems]);
    const player = playerSlug(character.name);
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

    function accept(data: ExchangeSnapshot) {
        if (!callbacks.current.onVersionedCharacter(data.character, data._saveVersion)) throw new ExchangeRequestError('Your character changed while the Exchange was loading. Refresh to confirm the trade and latest balance.', true);
        callbacks.current.setCreatorItems(previous => {
            const items = new Map(previous.map(item => [item.id, item]));
            for (const item of data.creatorItems ?? []) items.set(item.id, item);
            return [...items.values()];
        });
        setSnapshot(data);
        setSelected(previous => previous ? data.activity.find(listing => listing.id === previous.id) ?? data.listings.find(listing => listing.id === previous.id) ?? null : null);
    }

    async function run(action: ExchangeRequest) {
        const signal = lifetime.current?.signal;
        if (actionRef.current || !signal || signal.aborted) return;
        actionRef.current = true; setBusy(true); setError(''); setNotice('');
        const mutation = action.action !== 'browse';
        if (mutation) { setPendingRequest(action); savePendingExchangeRequest(character.name, action); }
        try {
            const data = await requestExchange(character.name, action, signal);
            if (signal?.aborted) return;
            accept(data);
            if (mutation) {
                setPendingRequest(null); savePendingExchangeRequest(character.name, null);
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
        // Coalesce incoming sales, and never interrupt an unconfirmed trade.
        if (saleRevision === refreshedSaleRevision.current || busy || pendingRequest || actionRef.current) return;
        refreshedSaleRevision.current = saleRevision;
        void run({ action: 'browse' });
        // run uses this render's account and current callbacks; it is not a stable dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saleRevision, busy, pendingRequest]);

    const rows = useMemo(() => {
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
    }, [snapshot, tab, category, rarity, currencyFilter, search, affordable, balance, shardBalance, sort, mine]);
    const pages = Math.max(1, Math.ceil(rows.length / 12));
    const currentPage = Math.min(page, pages);
    const qty = Number(quantity), total = Number(price);
    const validSale = Number.isSafeInteger(qty) && qty >= 1 && qty <= Math.min(sellAsset?.quantity ?? 0, 9999) && (sellAsset?.kind !== 'pet' || qty === 1)
        && Number.isSafeInteger(total) && total >= 1 && total <= EXCHANGE_MAX_PRICE;
    const resetFilters = () => { setCategory('all'); setSearch(''); setRarity('all'); setCurrencyFilter('all'); setAffordable(false); setPage(1); };
    const closeDetails = () => { setSelected(null); setSellAsset(null); setReview(false); };
    const tradeDisabled = busy || !!pendingRequest;
    const selectedCurrency = selected ? exchangeCurrency(selected) : 'ryo';
    const selectedUnit = EXCHANGE_CURRENCIES[selectedCurrency];
    const selectedBalance = selectedCurrency === 'fateShards' ? shardBalance : balance;
    const balanceAfterPurchase = selected ? selectedBalance - selected.price + (selected.asset.kind === 'resource' && selected.asset.id === selectedCurrency ? selected.quantity : 0) : selectedBalance;
    const saleUnit = EXCHANGE_CURRENCIES[saleCurrency];
    const buyBlock = selected && (selected.state !== 'active' ? 'This listing is no longer available.' : selected.price > selectedBalance ? `You need more ${selectedUnit} to buy this listing.` : selected.asset.kind === 'item' && (selected.asset.level ?? 1) > character.level ? `Requires level ${selected.asset.level}.` : '');

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
        {snapshot?.recoveryErrors.map(message => <div className="sx-message sx-error" role="status" key={message}>{message}</div>)}
        <div className="sx-workspace"><aside className="sx-categories"><span className="sx-eyebrow">COLLECTIONS</span>{EXCHANGE_CATEGORIES.map(id => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setPage(1); }}><span>{id === 'all' ? 'All treasures' : label(id)}</span><span className="sx-category-mark" aria-hidden="true">{category === id ? '—' : '›'}</span></button>)}<div className="sx-trade-note"><strong>The Exchange ledger</strong><p>Goods are held until sold or cancelled.</p><small>{EXCHANGE_LISTING_LIMIT} open listings per player.</small></div></aside>
            <section className="sx-market" aria-label="Exchange inventory" aria-busy={busy}>
                <div className="sx-section-heading"><div><span className="sx-eyebrow">{tab === 'sell' ? 'FROM YOUR COLLECTION' : tab === 'activity' ? 'YOUR TRADE LEDGER' : 'THE OPEN MARKET'}</span><h2 ref={resultsHeadingRef} tabIndex={-1}>{tab === 'sell' ? 'Choose a treasure to sell' : tab === 'listings' ? 'Your listings' : tab === 'activity' ? 'Trade history' : category === 'all' ? 'Browse the Exchange' : label(category)}</h2></div><span className="sx-count">{rows.length} {tab === 'sell' ? 'assets' : 'listings'}</span></div>
                {tab === 'sell' && <p className="sx-help">Choose an asset, set a price in ryo or Fate Shards, then review your listing. Unequip gear and free busy companions first. Named gear keeps its forged attributes.</p>}
                <div className={`sx-filters${tab === 'sell' ? ' sx-filters-inventory' : ''}`}><label className="sx-search"><span className="sx-sr-only">Search the Exchange</span><input type="search" placeholder="Search treasures, companions, sellers…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label><label><span className="sx-sr-only">Rarity</span><select aria-label="Rarity" value={rarity} onChange={e => { setRarity(e.target.value); setPage(1); }}><option value="all">All rarities</option>{Object.keys(rarityOrder).filter(s => s !== 'standard').map(s => <option key={s} value={s}>{label(s)}</option>)}<option value="standard">Standard</option></select></label>{tab !== 'sell' && <label><span className="sx-sr-only">Listing currency</span><select aria-label="Listing currency" value={currencyFilter} onChange={e => { setCurrencyFilter(e.target.value as ExchangeCurrency | 'all'); setPage(1); }}><option value="all">All currencies</option><option value="ryo">Ryo</option><option value="fateShards">Fate Shards</option></select></label>}<label><span className="sx-sr-only">Sort listings</span><select aria-label="Sort listings" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">{tab === 'sell' ? 'Name A–Z' : 'Newest first'}</option>{tab !== 'sell' && <><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></>}<option value="rarity">Rarity: highest first</option></select></label></div>
                {tab !== 'sell' && currencyFilter === 'all' && sort.startsWith('price-') && <p className="sx-help sx-sort-note">Prices are sorted within each currency: ryo, then Fate Shards.</p>}
                {tab === 'browse' && <label className="sx-affordable"><input type="checkbox" checked={affordable} onChange={e => { setAffordable(e.target.checked); setPage(1); }} /> Within my budget</label>}
                {!snapshot && busy ? <div className="sx-loading" role="status"><div className="sx-skeleton" /><div className="sx-skeleton" /><div className="sx-skeleton" /><p>Opening the trade ledger…</p></div> : !snapshot ? <div className="sx-empty"><h3>The trade ledger is unavailable</h3><p>Reconnect to browse the latest listings.</p><button onClick={() => void run({ action: 'browse' })} disabled={busy}>Reconnect</button></div> : rows.length === 0 ? <div className="sx-empty"><h3>{search || category !== 'all' || rarity !== 'all' || currencyFilter !== 'all' || affordable ? 'No treasures match these filters' : tab === 'sell' ? 'Your trading satchel is empty' : tab === 'activity' ? 'No trades recorded yet' : tab === 'listings' ? 'Your stall is ready' : 'The market is quiet'}</h3><p>{tab === 'sell' ? 'Bring items in your backpack, companions, cards, or resources to list here.' : tab === 'activity' ? 'Completed purchases, sales, and cancellations appear here.' : 'List a treasure from your collection or return for fresh arrivals.'}</p>{search || category !== 'all' || rarity !== 'all' || currencyFilter !== 'all' || affordable ? <button onClick={resetFilters}>Clear filters</button> : tab !== 'sell' && <button className="sx-primary" onClick={() => { setTab('sell'); resetFilters(); }}>Create your first listing</button>}</div> : <div className="sx-listings">{rows.slice((currentPage - 1) * 12, currentPage * 12).map(row => {
                    const isListing = 'asset' in row; const asset = isListing ? row.asset : row;
                    return <button key={isListing ? row.id : `${row.kind}:${row.id}`} className={`sx-listing sx-border-${asset.rarity}`} onClick={() => { setError(''); if (isListing) setSelected(row); else { setSellAsset(row); setQuantity('1'); setPrice(''); setSaleCurrency('ryo'); setReview(false); } }}>
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
                {buyBlock && selected.seller !== player && <p className="sx-help">{buyBlock}</p>}
                {selected.state === 'active' && <div className="sx-dialog-actions"><button onClick={closeDetails}>Keep browsing</button>{selected.seller === player ? <button className="sx-primary" onClick={() => void run({ action: 'cancel', listingId: selected.id })} disabled={tradeDisabled}>Cancel listing & return goods</button> : <button className="sx-primary" onClick={() => void run({ action: 'buy', listingId: selected.id, expectedPrice: selected.price, expectedCurrency: selectedCurrency })} disabled={tradeDisabled || !!buyBlock}>Buy for {money(selected.price)} {selectedUnit}</button>}</div>}
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
