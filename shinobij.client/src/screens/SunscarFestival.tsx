import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { GameItem } from '../types/combat';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { CaravanCombatCatalogs } from '../features/sunscar/CaravanBattle';
import { SunscarExchange, SunscarExchangeEntrance } from '../components/SunscarExchange';
import { BlackMarketCrate } from '../components/BlackMarketCrate';
import { pullBlackMarket, describeReward, BLACK_MARKET_COST, BLACK_MARKET_DAILY_CAP, type BlackMarketReward } from '../lib/black-market';
import { rallyRank } from '../../../shared/sunscar/rally-championship';
import { caravanRank } from '../../../shared/sunscar/caravan-types';
import festBg from '../assets/festival/sunscar-festival-v2.webp';
import brokerArt from '../assets/festival/fest-broker.webp';
import '../styles/sunscar-modes.css';
import '../styles/sunscar-caravan.css';
import '../styles/sunscar-responsive.css';

const PetRally = lazy(() => import('../features/sunscar/PetRally'));
const CaravanRun = lazy(() => import('../features/sunscar/CaravanRun'));
export function SunscarFestival({ character, onVersionedCharacter, setCreatorItems, ...catalogs }: CaravanCombatCatalogs & {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; setCreatorItems: Dispatch<SetStateAction<GameItem[]>>;
}) {
    const [mode, setMode] = useState<'hub' | 'rally' | 'caravan' | 'exchange'>('hub');
    useLayoutEffect(() => {
        if (mode !== 'exchange') return;
        // The entrance sits far down the festival page. Return to the top when
        // its content replaces the hub so the fixed mobile HUD cannot cover it.
        document.scrollingElement?.scrollTo(0, 0);
        document.querySelector('.center-game.screen-sunscarFestival')?.scrollTo(0, 0);
    }, [mode]);
    const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
    useEffect(() => { const timer = window.setInterval(() => setToday(new Date().toISOString().slice(0, 10)), 60_000); return () => window.clearInterval(timer); }, []);
    const [bmBusy, setBmBusy] = useState(false);
    const bmBusyRef = useRef(false);
    const [bmUsed, setBmUsed] = useState<number | null>(null);
    const [bmReveal, setBmReveal] = useState<BlackMarketReward | null>(null);
    const [brokerLog, setBrokerLog] = useState('Seventy-five thousand buys one sealed crate. You may complain about the price after you open it.');
    async function buyCrate() {
        if (bmBusyRef.current) return;
        bmBusyRef.current = true; setBmBusy(true);
        try {
            const res = await pullBlackMarket(character.name);
            if (typeof res.dailyUsed === 'number') setBmUsed(res.dailyUsed);
            if (!res.ok || !res.reward || !res.character) { setBrokerLog(res.error ?? 'The Broker is unavailable.'); return; }
            if (!onVersionedCharacter(res.character, res._saveVersion)) return;
            setBmReveal(res.reward);
            setBrokerLog(res.reward.label + '. ' + describeReward(res.reward) + '.');
        } finally { bmBusyRef.current = false; setBmBusy(false); }
    }
    if (mode === 'exchange') return <SunscarExchange key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} setCreatorItems={setCreatorItems} onBack={() => setMode('hub')}/>;
    if (mode === 'rally' || mode === 'caravan') return <Suspense fallback={<div className="sunscar-mode sunscar-loading" role="status">Opening the festival grounds…</div>}>{mode === 'rally'
        ? <PetRally key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} onBack={() => setMode('hub')}/>
        : <CaravanRun {...catalogs} key={character.name} character={character} onVersionedCharacter={onVersionedCharacter} onBack={() => setMode('hub')}/>}</Suspense>;
    const rally = character.sunscarRally, caravan = character.sunscarCaravan;
    const rallyActive = rally?.current && rally.current.status !== 'complete';
    const caravanActive = caravan?.current && !caravan.current.result;
    const rallyUsed = rally?.lastEntryDay === today;
    const caravanUsed = caravan?.lastEntryDay === today;
    return <div className="sunscar-mode sunscar-festival-hub">
        {bmReveal && <BlackMarketCrate reward={bmReveal} onClose={() => setBmReveal(null)}/>}
        <header className="sunscar-new-hero" style={{ backgroundImage: 'linear-gradient(90deg, #1e1a18ed, #221b1670 65%), linear-gradient(0deg, #1e1a18, transparent 60%), url(' + festBg + ')' }}>
            <p className="sunscar-eyebrow">Cactus Flats · Sector 54</p><h1>Sunscar<br/>Festival</h1><p>Where the desert gathers.</p><span>Race beneath the pennants. Carry a story beyond the dunes.</span>
            <div className="sunscar-status-pills"><span>One daily Grand Prix</span><span>One daily caravan</span><span>Unlimited race practice</span></div>
        </header>
        <div className="sunscar-attractions">
            <section className="sunscar-attraction sunscar-attraction-rally"><div className="sunscar-attraction-art"><img src={festBg} className="sunscar-racing-art" alt="The racing court beneath Sunscar’s pennants"/></div><div className="sunscar-attraction-copy">
                <p className="sunscar-eyebrow">Kael’s race grounds</p><h2>Pet Rally</h2><p>Four courses. Four companions. Steer, leap and time your burst through a living desert circuit.</p>
                <div className="sunscar-attraction-status">{rallyActive ? 'Grand Prix in progress · ' + rally.current!.results.length + '/3 races' : rallyUsed ? 'Grand Prix complete · ' + (rally?.current?.reward?.ryo ?? 0).toLocaleString() + ' Ryo' : 'Entry available · ' + rallyRank(rally?.reputation ?? 0).name}<span>{rally?.reputation ?? 0} reputation</span></div>
                <button onClick={() => setMode('rally')}>{rallyActive ? 'Resume Grand Prix' : 'Visit the race grounds'} <span aria-hidden="true">↗</span></button><small>Bring your own companion · Skill-based racing</small>
            </div></section>
            <section className="sunscar-attraction sunscar-attraction-caravan"><div className="sunscar-attraction-art"><img src={festBg} className="sunscar-dispatch-art" alt="A caravan leaving the Sunscar gate"/></div><div className="sunscar-attraction-copy">
                <p className="sunscar-eyebrow">Miraa’s dispatch office</p><h2>Caravan Run</h2><p>Choose your contract and chart a crossing. Keep the crew together through ambushes, old ruins and chance meetings.</p>
                <div className="sunscar-attraction-status">{caravanActive ? 'On the road · ' + caravan.current!.visited.length + '/' + caravan.current!.contract.nodes + ' legs' : caravanUsed ? 'Manifest closed · ' + (caravan?.current?.result?.ryo ?? 0).toLocaleString() + ' Ryo' : 'Departure available · ' + caravanRank(caravan?.reputation ?? 0).name}<span>{caravan?.reputation ?? 0} reputation</span></div>
                <button onClick={() => setMode('caravan')}>{caravanActive ? 'Rejoin your caravan' : 'Read today’s contracts'} <span aria-hidden="true">↗</span></button><small>Branching expedition · Your real combat loadout</small>
            </div></section>
        </div>
        <div className="sunscar-market-row"><SunscarExchangeEntrance onOpen={() => setMode('exchange')}/><section className="sunscar-broker"><img src={brokerArt} alt="The Broker"/><div><p className="sunscar-eyebrow">The Black Market</p><h2>The Broker</h2><p role="status">{brokerLog}</p>
            <p><strong>{BLACK_MARKET_COST.toLocaleString()} Ryo</strong> per crate · Up to {BLACK_MARKET_DAILY_CAP}/day</p><small>Your purse: {character.ryo.toLocaleString()} Ryo{bmUsed !== null ? ' · ' + bmUsed + '/' + BLACK_MARKET_DAILY_CAP + ' crates today' : ''}</small>
            <button onClick={() => void buyCrate()} disabled={bmBusy || character.ryo < BLACK_MARKET_COST || bmUsed !== null && bmUsed >= BLACK_MARKET_DAILY_CAP}>{bmBusy ? 'Preparing crate…' : bmUsed !== null && bmUsed >= BLACK_MARKET_DAILY_CAP ? 'Daily crates claimed' : character.ryo < BLACK_MARKET_COST ? 'More Ryo required' : 'Buy a sealed crate'}</button>
        </div></section></div><footer className="sunscar-hub-footer">The lanterns stay lit. Daily entries renew at 00:00 UTC.</footer>
    </div>;
}
