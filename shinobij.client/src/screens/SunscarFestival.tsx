import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { GameItem } from '../types/combat';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { CaravanCombatCatalogs } from '../features/sunscar/CaravanBattle';
import { SunscarExchange, SunscarExchangeEntrance } from '../components/SunscarExchange';
import { BlackMarketCrate } from '../components/BlackMarketCrate';
import { pullBlackMarket, describeReward, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP, type BlackMarketReward } from '../lib/black-market';
import { rallyRank } from '../../../shared/sunscar/rally-championship';
import { caravanRank } from '../../../shared/sunscar/caravan-types';
import { serverNow } from '../lib/server-clock';
import festBg from '../assets/festival/sunscar-festival-v2.webp';
import brokerArt from '../assets/festival/fest-broker.webp';
import crateArt from '../assets/festival/bm-crate-closed.webp';
import '../styles/sunscar-modes.css';
import '../styles/sunscar-caravan.css';
import '../styles/sunscar-responsive.css';
import '../styles/sunscar-hub.css';

const PetRally = lazy(() => import('../features/sunscar/PetRally'));
const CaravanRun = lazy(() => import('../features/sunscar/CaravanRun'));
// Mount inside Suspense so navigation waits for the destination, not its loader.
function FestivalDestination({ children }: { children: ReactNode }) {
    useLayoutEffect(() => {
        const center = document.querySelector('.center-game.screen-sunscarFestival');
        const heading = center?.querySelector<HTMLElement>('h1');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus({ preventScroll: true });
        document.scrollingElement?.scrollTo({ top: 0, behavior: 'instant' });
        center?.scrollTo({ top: 0, behavior: 'instant' });
    }, []);
    return children;
}
export function SunscarFestival({ character, onVersionedCharacter, setCreatorItems, ...catalogs }: CaravanCombatCatalogs & {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; setCreatorItems: Dispatch<SetStateAction<GameItem[]>>;
}) {
    const [mode, setMode] = useState<'hub' | 'rally' | 'caravan' | 'exchange'>('hub');
    const hubPosition = useRef<{ document: number; center: number; selector: string } | null>(null);
    function openDestination(destination: 'rally' | 'caravan' | 'exchange') {
        hubPosition.current = {
            document: document.scrollingElement?.scrollTop ?? 0,
            center: document.querySelector('.center-game.screen-sunscarFestival')?.scrollTop ?? 0,
            selector: destination === 'exchange' ? '.sunscar-exchange-entrance button' : `.sunscar-attraction-${destination} button`,
        };
        setMode(destination);
    }
    useLayoutEffect(() => {
        const position = hubPosition.current;
        if (mode !== 'hub' || !position) return;
        document.scrollingElement?.scrollTo({ top: position.document, behavior: 'instant' });
        document.querySelector('.center-game.screen-sunscarFestival')?.scrollTo({ top: position.center, behavior: 'instant' });
        document.querySelector<HTMLElement>(position.selector)?.focus({ preventScroll: true });
    }, [mode]);
    const [today, setToday] = useState(() => new Date(serverNow()).toISOString().slice(0, 10));
    useEffect(() => { const timer = window.setInterval(() => setToday(new Date(serverNow()).toISOString().slice(0, 10)), 60_000); return () => window.clearInterval(timer); }, []);
    const [bmBusy, setBmBusy] = useState(false);
    const bmBusyRef = useRef(false);
    const brokerButtonRef = useRef<HTMLButtonElement>(null);
    const [bmUsage, setBmUsage] = useState<{ day: string; used: number } | null>(null);
    const bmUsed = bmUsage?.day === today ? bmUsage.used : null;
    const [bmReveal, setBmReveal] = useState<BlackMarketReward | null>(null);
    const [brokerLog, setBrokerLog] = useState('A sealed crate. A closely guarded secret. Take your chances with the Broker’s collection.');
    async function buyCrate() {
        if (bmBusyRef.current) return;
        bmBusyRef.current = true; setBmBusy(true);
        try {
            const res = await pullBlackMarket(character.name);
            if (typeof res.dailyUsed === 'number') setBmUsage({ day: new Date(serverNow()).toISOString().slice(0, 10), used: res.dailyUsed });
            if (!res.ok || !res.reward || !res.character) { setBrokerLog(res.error ?? 'The Broker is unavailable.'); return; }
            if (!onVersionedCharacter(res.character, res._saveVersion)) return;
            setBmReveal(res.reward);
            setBrokerLog(res.reward.label + '. ' + describeReward(res.reward) + '.');
        } finally { bmBusyRef.current = false; setBmBusy(false); }
    }
    if (mode === 'exchange') return <FestivalDestination key="exchange"><SunscarExchange key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} setCreatorItems={setCreatorItems} onBack={() => setMode('hub')}/></FestivalDestination>;
    if (mode === 'rally' || mode === 'caravan') return <Suspense fallback={<div className="sunscar-mode sunscar-loading" role="status">Opening the festival grounds…</div>}><FestivalDestination key={mode}>{mode === 'rally'
        ? <PetRally key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} onBack={() => setMode('hub')}/>
        : <CaravanRun {...catalogs} key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} onBack={() => setMode('hub')}/>}</FestivalDestination></Suspense>;
    const rally = character.sunscarRally, caravan = character.sunscarCaravan;
    const rallyActive = rally?.current && rally.current.status !== 'complete';
    const caravanActive = caravan?.current && !caravan.current.result;
    const rallyUsed = rally?.lastEntryDay === today;
    const caravanUsed = caravan?.lastEntryDay === today;
    return <div className="sunscar-mode sunscar-festival-hub sunscar-hub-refined">
        <BlackMarketCrate reward={bmReveal} onClose={() => setBmReveal(null)} returnFocusRef={brokerButtonRef}/>
        <header className="sunscar-new-hero" style={{ backgroundImage: 'linear-gradient(90deg, #090f16e8, #090f1620 85%), linear-gradient(0deg, #0c1115, transparent 65%), url(' + festBg + ')' }}>
            <span className="sunscar-location">The Land of Wind / Sector 54</span>
            <div className="sunscar-hero-copy"><p className="sunscar-eyebrow">Cactus Flats</p><h1>Sunscar Festival</h1><p>Where the desert gathers.</p><span>Race beneath the pennants. Find your fortune beyond the dunes.</span></div>
        </header>
        <div className="sunscar-daily-ledger" aria-label="Today at Sunscar"><span><small>Grand Prix</small><strong>{rallyActive ? 'In progress' : rallyUsed ? 'Complete for today' : 'Entry available'}</strong></span><span><small>Caravan</small><strong>{caravanActive ? 'On the road' : caravanUsed ? 'Complete for today' : 'Departure available'}</strong></span><span><small>Race practice</small><strong>Always open</strong></span></div>
        <div className="sunscar-hub-heading"><p className="sunscar-eyebrow">Beyond the gates</p><h2>Choose your adventure</h2></div>
        <div className="sunscar-attractions">
            <section className="sunscar-attraction sunscar-attraction-rally"><div className="sunscar-attraction-art"><img src={festBg} className="sunscar-racing-art" alt="The racing court beneath Sunscar’s pennants"/></div><div className="sunscar-attraction-copy">
                <p className="sunscar-eyebrow">01 / Kael’s race grounds</p><h2>Pet Rally</h2><p>Race your companion through desert circuits. Master every leap, turn and burst.</p>
                <div className="sunscar-attraction-status">{rallyActive ? 'Grand Prix in progress · ' + rally.current!.results.length + '/3 races' : rallyUsed ? 'Grand Prix complete · ' + (rally?.current?.reward?.ryo ?? 0).toLocaleString() + ' Ryo' : 'Entry available · ' + rallyRank(rally?.reputation ?? 0).name}<span>{rally?.reputation ?? 0} reputation</span></div>
                <button onClick={() => openDestination('rally')}>{rallyActive ? 'Resume Grand Prix' : 'Visit the race grounds'} <span aria-hidden="true">↗</span></button><small>Bring your own companion · Skill-based racing</small>
            </div></section>
            <section className="sunscar-attraction sunscar-attraction-caravan"><div className="sunscar-attraction-art"><img src={festBg} className="sunscar-dispatch-art" alt="A caravan leaving the Sunscar gate"/></div><div className="sunscar-attraction-copy">
                <p className="sunscar-eyebrow">02 / Miraa’s shinobi dispatch</p><h2>Caravan Run</h2><p>Take point on a shinobi escort mission. Scout the dunes, guard sealed cargo, and face rogue ninja beyond the village gates.</p>
                <div className="sunscar-attraction-status">{caravanActive ? 'On the road · ' + caravan.current!.visited.length + '/' + caravan.current!.contract.nodes + ' legs' : caravanUsed ? 'Manifest closed · ' + (caravan?.current?.result?.ryo ?? 0).toLocaleString() + ' Ryo' : 'Departure available · ' + caravanRank(caravan?.reputation ?? 0).name}<span>{caravan?.reputation ?? 0} reputation</span></div>
                <button onClick={() => openDestination('caravan')}>{caravanActive ? 'Rejoin your caravan' : 'Read today’s contracts'} <span aria-hidden="true">↗</span></button><small>Shinobi escort missions · Your real combat loadout</small>
            </div></section>
        </div>
        <div className="sunscar-hub-heading"><p className="sunscar-eyebrow">Under the lanterns</p><h2>The trading quarter</h2></div>
        <div className="sunscar-market-row"><SunscarExchangeEntrance onOpen={() => openDestination('exchange')}/><section className="sunscar-broker"><div className="sunscar-broker-art"><img className="sunscar-broker-crate" src={crateArt} alt="The Broker’s sealed treasure crate"/><img className="sunscar-broker-portrait" src={brokerArt} alt="The Broker"/></div><div className="sunscar-broker-copy"><p className="sunscar-eyebrow">The Black Market</p><h2>The Broker</h2><p role="status">{brokerLog}</p>
            <div className="sunscar-crate-price"><strong>{BLACK_MARKET_COST.toLocaleString()} <small>Ryo / crate</small></strong><span>{bmUsed !== null ? `${bmUsed}/${BLACK_MARKET_DAILY_CAP} claimed today` : `${BLACK_MARKET_DAILY_CAP} crates per day`}</span></div><small>Your purse: {character.ryo.toLocaleString()} Ryo</small>
            <button ref={brokerButtonRef} onClick={() => void buyCrate()} disabled={bmBusy || character.ryo < BLACK_MARKET_COST || bmUsed !== null && bmUsed >= BLACK_MARKET_DAILY_CAP}>{bmBusy ? 'Preparing crate…' : bmUsed !== null && bmUsed >= BLACK_MARKET_DAILY_CAP ? 'Daily crates claimed' : character.ryo < BLACK_MARKET_COST ? 'More Ryo required' : 'Buy a sealed crate'}</button>
        </div></section></div><footer className="sunscar-hub-footer">The lanterns stay lit. Daily entries renew at 00:00 UTC.</footer>
    </div>;
}
