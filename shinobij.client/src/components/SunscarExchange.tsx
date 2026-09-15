import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { EXCHANGE_CATEGORIES, EXCHANGE_FEE_PERCENT, EXCHANGE_LISTING_LIMIT, EXCHANGE_MAX_PRICE, exchangeFee, type ExchangeAsset, type ExchangeCategory, type ExchangeListing, type ExchangeOwnedAsset } from '../../../shared/sunscar-exchange';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { GameItem } from '../types/combat';
import { Modal } from './ui/Modal';
import { getAllItems } from '../lib/items';
import { ExchangeRequestError, pendingExchangeRequest, requestExchange, savePendingExchangeRequest, type ExchangeRequest, type ExchangeSnapshot } from '../lib/sunscar-exchange';
import exchangeArt from '../assets/festival/sunscar-exchange-v1.webp';
import weaponArt from '../assets/clan-exchange/weaponCache.webp';
import armorArt from '../assets/clan-exchange/armorCache.webp';
import '../styles/sunscar-exchange.css';

const money = (n: number) => n.toLocaleString('en-US');
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const playerSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
const rarityOrder: Record<string, number> = { named: 7, mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1, standard: 1 };
const catalogArt = new Map(getAllItems([]).filter(item => item.image).map(item => [item.id, item.image!]));

export function ExchangeGlyph({ category = 'all' }: { category?: string }) {
    const paths: Record<string, string> = {
        all: 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
        weapons: 'm4 20 3-3m-3-2 5 5M7 17 19 5V2h-3L4 14m11-9 4 4',
        armor: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm0 4v10',
        pets: 'M8 13c-2 2-5 7-1 7 3 0 3-1 5-1s2 1 5 1c4 0 1-5-1-7-2-2-6-2-8 0ZM5 7a1 2 0 1 0 0 4 1 2 0 0 0 0-4ZM9 3a1 2 0 1 0 0 4 1 2 0 0 0 0-4Zm6 0a1 2 0 1 0 0 4 1 2 0 0 0 0-4Zm4 4a1 2 0 1 0 0 4 1 2 0 0 0 0-4',
        cards: 'M5 3h14v18H5zM12 7l4 5-4 5-4-5z',
        resources: 'M12 2 3 8l9 14 9-14-9-6ZM3 8h18M8 8l4 14 4-14',
        consumables: 'M9 2h6v5l5 8c2 4-1 7-4 7H8c-3 0-6-3-4-7l5-8V2Zm-2 12h10',
        materials: 'm4 8 8-5 8 5v10l-8 4-8-4V8Zm0 0 8 5 8-5M12 13v9',
        accessories: 'M12 3a9 9 0 1 0 9 9M12 3l4 4 5-5m-9 1 4 4 5 5',
    };
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[category] || paths.all} /></svg>;
}

export function SunscarExchangeEntrance({ onOpen }: { onOpen: () => void }) {
    return <section className="sunscar-card sunscar-exchange-entrance" style={{ backgroundImage: `linear-gradient(0deg, #161c1a 5%, rgba(18,24,22,.15) 100%), url(${exchangeArt})` }}>
        <div className="sx-entrance-seal"><ExchangeGlyph /></div>
        <div className="sx-entrance-copy"><span className="sx-eyebrow">THE CARAVAN’S TRADING HALL</span>
            <h2>Sunscar Exchange</h2>
            <p>Find your next legend. Give another traveler theirs.</p>
            <div className="sx-entrance-tags"><span>Pets</span><span>Named gear</span><span>Every treasure</span></div>
            <button className="sx-primary" onClick={onOpen}>Enter the Exchange <span aria-hidden="true">↗</span></button>
            <small>Player-to-player trading · Ryo</small>
        </div>
    </section>;
}

function AssetPortrait({ asset }: { asset: ExchangeAsset }) {
    const fallback = catalogArt.get(asset.id) ?? (asset.category === 'weapons' ? weaponArt : asset.category === 'armor' ? armorArt : undefined);
    const image = asset.image && /^(https?:\/\/|\/|data:image\/)/.test(asset.image) ? asset.image : fallback;
    const [failed, setFailed] = useState(false);
    return <span className={`sx-asset-art sx-rarity-${asset.rarity}`}>
        {image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /> : <ExchangeGlyph category={asset.category} />}
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
    const [sort, setSort] = useState('newest');
    const [affordable, setAffordable] = useState(false);
    const [page, setPage] = useState(1);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [selected, setSelected] = useState<ExchangeListing | null>(null);
    const [sellAsset, setSellAsset] = useState<ExchangeOwnedAsset | null>(null);
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState('');
    const [review, setReview] = useState(false);
    const [pendingRequest, setPendingRequest] = useState<ExchangeRequest | null>(() => pendingExchangeRequest(character.name));
    const actionRef = useRef(false);
    const lifetime = useRef<AbortController | null>(null);
    const callbacks = useRef({ onVersionedCharacter, setCreatorItems });
    useEffect(() => { callbacks.current = { onVersionedCharacter, setCreatorItems }; }, [onVersionedCharacter, setCreatorItems]);
    const player = playerSlug(character.name);
    const balance = character.ryo;
    const mine = useMemo(() => snapshot?.activity.filter(l => l.seller === player && ['active', 'preparing', 'buying', 'cancelling'].includes(l.state)) ?? [], [snapshot, player]);

    function accept(data: ExchangeSnapshot) {
        if (!callbacks.current.onVersionedCharacter(data.character, data._saveVersion)) throw new ExchangeRequestError('Your character changed while the Exchange was loading. Refresh to confirm the trade and latest balance.', true);
        callbacks.current.setCreatorItems(previous => {
            const items = new Map(previous.map(item => [item.id, item]));
            for (const item of data.creatorItems ?? []) items.set(item.id, item);
            return [...items.values()];
        });
        setSnapshot(data);
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

    const rows = useMemo(() => {
        const data: Array<ExchangeListing | ExchangeOwnedAsset> = tab === 'sell' ? snapshot?.inventory ?? [] : tab === 'listings' ? mine : tab === 'activity' ? snapshot?.activity.filter(l => ['sold', 'cancelled', 'failed'].includes(l.state)) ?? [] : snapshot?.listings ?? [];
        return data.filter(row => {
            const asset = 'asset' in row ? row.asset : row;
            return (category === 'all' || asset.category === category) && (rarity === 'all' || asset.rarity === rarity)
                && `${asset.name} ${asset.description} ${'sellerName' in row ? row.sellerName : ''}`.toLowerCase().includes(search.toLowerCase().trim())
                && (!affordable || !('price' in row) || row.price <= balance);
        }).sort((a, b) => {
            if (sort === 'price-low' && 'price' in a && 'price' in b) return a.price - b.price;
            if (sort === 'price-high' && 'price' in a && 'price' in b) return b.price - a.price;
            if (sort === 'rarity') return (rarityOrder[('asset' in b ? b.asset : b).rarity] ?? 0) - (rarityOrder[('asset' in a ? a.asset : a).rarity] ?? 0);
            return 'createdAt' in a && 'createdAt' in b ? b.createdAt - a.createdAt : ('asset' in a ? a.asset : a).name.localeCompare(('asset' in b ? b.asset : b).name);
        });
    }, [snapshot, tab, category, rarity, search, affordable, balance, sort, mine]);
    const pages = Math.max(1, Math.ceil(rows.length / 12));
    const currentPage = Math.min(page, pages);
    const qty = Number(quantity), total = Number(price);
    const validSale = Number.isSafeInteger(qty) && qty >= 1 && qty <= Math.min(sellAsset?.quantity ?? 0, 9999) && (sellAsset?.kind !== 'pet' || qty === 1)
        && Number.isSafeInteger(total) && total >= 1 && total <= EXCHANGE_MAX_PRICE;
    const resetFilters = () => { setCategory('all'); setSearch(''); setRarity('all'); setAffordable(false); setPage(1); };
    const closeDetails = () => { setSelected(null); setSellAsset(null); setReview(false); };
    const tradeDisabled = busy || !!pendingRequest;
    const buyBlock = selected && (selected.state !== 'active' ? 'This listing is no longer available.' : selected.price > balance ? 'You need more ryo to buy this listing.' : selected.asset.kind === 'item' && (selected.asset.level ?? 1) > character.level ? `Requires level ${selected.asset.level}.` : '');

    return <div className="sx-hall">
        <header className="sx-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(13,22,20,.97), rgba(13,22,20,.72) 47%, rgba(13,22,20,.05)), url(${exchangeArt})` }}>
            <button className="sx-back" onClick={onBack}>← Sunscar Festival</button>
            <div className="sx-hero-copy"><span className="sx-eyebrow">A TREASURE FOR EVERY TRAVELER</span><h1>Sunscar <em>Exchange</em></h1><p>Companions. Legendary steel. The one piece you’ve been looking for.</p></div>
            <div className="sx-hero-footer"><span><i /> Player marketplace</span><span>Free to list · {EXCHANGE_FEE_PERCENT}% fee on sales</span><span>Instant delivery</span></div>
            <div className="sx-wallet"><span>YOUR PURSE</span><strong>{money(balance)} <small>ryo</small></strong></div>
        </header>
        <nav className="sx-tabs" aria-label="Exchange sections">{([['browse', 'Browse market'], ['sell', 'Sell an asset'], ['listings', `My listings (${mine.length})`], ['activity', 'Trade history']] as const).map(([id, name]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); resetFilters(); }}>{name}</button>)}<button className="sx-refresh" aria-label={busy ? 'Updating Exchange' : 'Refresh Exchange'} onClick={() => void run(pendingRequest ?? { action: 'browse' })} disabled={busy}>↻ <span>{busy ? 'Updating…' : 'Refresh'}</span></button></nav>
        {error && <div className="sx-message sx-error" role="alert">{error}<button onClick={() => void run(pendingRequest ?? { action: 'browse' })} disabled={busy}>{pendingRequest ? 'Retry saved trade' : 'Try again'}</button></div>}
        {pendingRequest && !error && !busy && <div className="sx-message" role="status">A saved trade is awaiting confirmation.<button onClick={() => void run(pendingRequest)}>Retry saved trade</button></div>}
        {notice && <div className="sx-message sx-success" role="status">{notice}</div>}
        {snapshot?.recoveryErrors.map(message => <div className="sx-message sx-error" role="status" key={message}>{message}</div>)}
        <div className="sx-workspace"><aside className="sx-categories"><span className="sx-eyebrow">EXPLORE THE EXCHANGE</span>{EXCHANGE_CATEGORIES.map(id => <button key={id} aria-pressed={category === id} onClick={() => { setCategory(id); setPage(1); }}><ExchangeGlyph category={id} />{id === 'all' ? 'All treasures' : label(id)}</button>)}<div className="sx-trade-note"><ExchangeGlyph /><strong>Your price. Your trade.</strong><p>Goods stay with the Exchange until sold. Cancel an open listing anytime.</p><small>{EXCHANGE_LISTING_LIMIT} open listings per player.</small></div></aside>
            <section className="sx-market" aria-label="Exchange inventory" aria-busy={busy}>
                <div className="sx-section-heading"><div><span className="sx-eyebrow">{tab === 'sell' ? 'FROM YOUR COLLECTION' : tab === 'activity' ? 'YOUR TRADE LEDGER' : 'THE OPEN MARKET'}</span><h2>{tab === 'sell' ? 'Put a treasure on the table' : tab === 'listings' ? 'Your wares, on display' : tab === 'activity' ? 'Every trade, accounted for' : 'Discover something exceptional'}</h2></div><span className="sx-count">{rows.length} {tab === 'sell' ? 'assets' : 'listings'}</span></div>
                {tab === 'sell' && <p className="sx-help">Choose an asset, set a total asking price, then review your listing. Unequip gear and free busy companions first. Named gear keeps its forged attributes.</p>}
                <div className="sx-filters"><label className="sx-search"><span className="sx-sr-only">Search the Exchange</span><input type="search" placeholder="Search treasures, companions, sellers…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label><label><span className="sx-sr-only">Rarity</span><select aria-label="Rarity" value={rarity} onChange={e => { setRarity(e.target.value); setPage(1); }}><option value="all">All rarities</option>{Object.keys(rarityOrder).filter(s => s !== 'standard').map(s => <option key={s} value={s}>{label(s)}</option>)}<option value="standard">Standard</option></select></label><label><span className="sx-sr-only">Sort listings</span><select aria-label="Sort listings" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">{tab === 'sell' ? 'Name A–Z' : 'Newest first'}</option>{tab !== 'sell' && <><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></>}<option value="rarity">Rarity: highest first</option></select></label></div>
                {tab === 'browse' && <label className="sx-affordable"><input type="checkbox" checked={affordable} onChange={e => { setAffordable(e.target.checked); setPage(1); }} /> Within my budget</label>}
                {!snapshot && busy ? <div className="sx-loading" role="status"><div className="sx-skeleton" /><div className="sx-skeleton" /><div className="sx-skeleton" /><p>Opening the trade ledger…</p></div> : !snapshot ? <div className="sx-empty"><ExchangeGlyph /><h3>The trade ledger is unavailable</h3><p>Reconnect to browse the latest listings.</p><button onClick={() => void run({ action: 'browse' })} disabled={busy}>Reconnect</button></div> : rows.length === 0 ? <div className="sx-empty"><ExchangeGlyph category={category} /><span className="sx-eyebrow">THERE’S ROOM FOR SOMETHING GREAT</span><h3>{search || category !== 'all' || rarity !== 'all' || affordable ? 'No treasures match these filters' : tab === 'sell' ? 'Your trading satchel is empty' : tab === 'activity' ? 'Your story here is just beginning' : tab === 'listings' ? 'Your stall is ready' : 'The next great find starts with you'}</h3><p>{tab === 'sell' ? 'Bring items in your backpack, companions, cards, or resources to list here.' : tab === 'activity' ? 'Completed purchases, sales, and cancellations appear here.' : 'List a treasure from your collection or return for fresh arrivals.'}</p>{search || category !== 'all' || rarity !== 'all' || affordable ? <button onClick={resetFilters}>Clear filters</button> : tab !== 'sell' && <button className="sx-primary" onClick={() => { setTab('sell'); resetFilters(); }}>Create your first listing</button>}</div> : <div className="sx-listings">{rows.slice((currentPage - 1) * 12, currentPage * 12).map(row => {
                    const isListing = 'asset' in row; const asset = isListing ? row.asset : row;
                    return <button key={isListing ? row.id : `${row.kind}:${row.id}`} className={`sx-listing sx-border-${asset.rarity}`} onClick={() => { setError(''); if (isListing) setSelected(row); else { setSellAsset(row); setQuantity('1'); setPrice(''); setReview(false); } }}>
                        <AssetPortrait asset={asset} /><div className="sx-listing-name"><span className={`sx-rarity sx-rarity-${asset.rarity}`}>{label(asset.rarity)} · {label(asset.category)}</span><strong>{asset.name}</strong><small>{isListing ? `From ${row.sellerName}${row.seller === player ? ' · Your listing' : ''}` : row.unavailable ?? `${money(row.quantity)} available`}</small></div>
                        <div className="sx-listing-meta"><span>{isListing ? `×${money(row.quantity)}` : asset.level ? `Lv. ${asset.level}` : 'Owned'}</span>{isListing ? <><strong>{money(row.price)} <small>ryo</small></strong><small>{tab === 'activity' || row.state !== 'active' ? label(row.state) : row.quantity > 1 ? `${money(Math.round(row.price / row.quantity))} ryo / unit` : 'View listing →'}</small></> : <strong>{row.unavailable ? 'View details' : 'List asset →'}</strong>}</div>
                    </button>;
                })}</div>}
                {pages > 1 && <nav className="sx-pagination" aria-label="Listing pages"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>← Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next →</button></nav>}
                <footer className="sx-market-footer"><span>Fixed prices. Whole lots. No listing charge.</span><span>Seller receives {100 - EXCHANGE_FEE_PERCENT}% · No fee on cancellation</span></footer>
            </section>
        </div>
        <Modal open={!!selected || !!sellAsset} onClose={closeDetails} title={sellAsset ? review ? 'Review your listing' : 'Create a listing' : 'Inspect listing'} size="md" className="sx-dialog" disableBackdropClose={busy}>
            {selected && <><AssetDetails asset={selected.asset} /><dl className="sx-checkout"><div><dt>Seller</dt><dd>{selected.sellerName}</dd></div><div><dt>Quantity</dt><dd>{money(selected.quantity)}</dd></div><div><dt>Total price</dt><dd>{money(selected.price)} ryo</dd></div>{selected.seller === player ? <><div><dt>Exchange fee ({EXCHANGE_FEE_PERCENT}%)</dt><dd>{money(selected.fee)} ryo</dd></div><div className="sx-total"><dt>You receive when sold</dt><dd>{money(selected.proceeds)} ryo</dd></div></> : <div className="sx-total"><dt>Balance after purchase</dt><dd>{selected.price > balance ? 'Insufficient ryo' : `${money(balance - selected.price)} ryo`}</dd></div>}</dl>
                {buyBlock && selected.seller !== player && <p className="sx-help">{buyBlock}</p>}
                {selected.state === 'active' && <div className="sx-dialog-actions"><button onClick={closeDetails}>Keep browsing</button>{selected.seller === player ? <button className="sx-primary" onClick={() => void run({ action: 'cancel', listingId: selected.id })} disabled={tradeDisabled}>Cancel listing & return goods</button> : <button className="sx-primary" onClick={() => void run({ action: 'buy', listingId: selected.id, expectedPrice: selected.price })} disabled={tradeDisabled || !!buyBlock}>Buy for {money(selected.price)} ryo</button>}</div>}
                {selected.state !== 'active' && <p className="sx-help">Status: {label(selected.state)}{selected.completedAt ? ` · ${new Date(selected.completedAt).toLocaleString()}` : ''}</p>}
            </>}
            {sellAsset && <><AssetDetails asset={sellAsset} />{sellAsset.unavailable ? <p className="sx-message sx-error">{sellAsset.unavailable}</p> : <form onSubmit={e => { e.preventDefault(); if (!validSale || tradeDisabled) return; if (!review) { setReview(true); return; } void run({ action: 'list', requestId: crypto.randomUUID(), kind: sellAsset.kind, assetId: sellAsset.id, quantity: qty, price: total }); }}>
                {!review ? <div className="sx-sell-fields"><label>Quantity <small>{money(sellAsset.quantity)} owned</small><input type="number" inputMode="numeric" min="1" max={sellAsset.kind === 'pet' ? 1 : Math.min(9999, sellAsset.quantity)} step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy || sellAsset.kind === 'pet'} /></label><label>Total asking price <small>For the entire lot, in ryo</small><input type="number" inputMode="numeric" min="1" max={EXCHANGE_MAX_PRICE} step="1" placeholder="Enter a price" required value={price} onChange={e => setPrice(e.target.value)} disabled={busy} /></label></div> : <p className="sx-description">List <strong>{money(qty)} × {sellAsset.name}</strong> for <strong>{money(total)} ryo</strong>? Your goods leave your inventory and stay at the Exchange until this listing sells or you cancel it.</p>}
                <dl className="sx-checkout"><div><dt>Listing charge</dt><dd>Free</dd></div><div><dt>Fee when sold ({EXCHANGE_FEE_PERCENT}%)</dt><dd>{validSale ? money(exchangeFee(total)) : '—'} ryo</dd></div><div className="sx-total"><dt>You receive when sold</dt><dd>{validSale ? money(total - exchangeFee(total)) : '—'} ryo</dd></div></dl>
                {mine.length >= EXCHANGE_LISTING_LIMIT && <p className="sx-help">All {EXCHANGE_LISTING_LIMIT} listing slots are in use. Cancel or sell a listing first.</p>}
                <div className="sx-dialog-actions"><button type="button" onClick={() => review ? setReview(false) : closeDetails()}>{review ? 'Edit listing' : 'Back'}</button><button className="sx-primary" type="submit" disabled={!validSale || tradeDisabled || mine.length >= EXCHANGE_LISTING_LIMIT}>{busy ? 'Publishing…' : review ? 'Publish listing' : 'Review listing →'}</button></div>
            </form>}</>}
            {error && <div className="sx-message sx-error" role="alert">{error}{pendingRequest && <button onClick={() => void run(pendingRequest)} disabled={busy}>Retry saved trade</button>}</div>}
        </Modal>
    </div>;
}
