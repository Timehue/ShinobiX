import { FIRST_CONTRACT_ROUTES, type FirstContractRoute } from '../../../shared/first-contract';
import { FIRST_CONTRACT_COPY } from '../lib/first-contract';
import combatArt from '../assets/academy/onboarding/first-contract-combat-v2.webp';
import discoveryArt from '../assets/academy/onboarding/first-contract-discovery-v2.webp';
import companionArt from '../assets/academy/onboarding/first-contract-companion-v2.webp';
import './first-contract.css';

const ROUTE_ART = { combat: combatArt, discovery: discoveryArt, companion: companionArt };

export function FirstContractRoutes({ onChoose, busy = false, hasCompanion = true, selected }: {
    onChoose: (route: FirstContractRoute) => void; busy?: boolean; hasCompanion?: boolean; selected?: FirstContractRoute;
}) {
    return <div className="fc-routes" role="group" aria-label="Choose your first assignment">
        {FIRST_CONTRACT_ROUTES.map((route, index) => {
            const copy = FIRST_CONTRACT_COPY[route];
            const unavailable = route === 'companion' && !hasCompanion;
            return <button className={`fc-route fc-route--${route}${unavailable ? ' is-unavailable' : ''}`} key={route} type="button" disabled={busy || unavailable} onClick={() => onChoose(route)} aria-pressed={selected === route}>
                <img className="fc-route-art" src={ROUTE_ART[route]} alt="" aria-hidden="true" width={640} height={960} decoding="async" />
                <span className="fc-route-shade" aria-hidden="true" />
                <span className="fc-route-number" aria-hidden="true">0{index + 1}</span>
                <span className="fc-route-copy">
                    <span className="fc-eyebrow">{copy.label}{selected === route ? ' · Current route' : ''}</span>
                    <strong>{copy.title}</strong>
                    <span className="fc-route-description">{unavailable ? 'Available when you have a companion. The other routes are ready now.' : copy.line}</span>
                </span>
                <span className="fc-route-link">{unavailable ? 'Companion needed' : 'Choose this route'} <span aria-hidden="true">{unavailable ? '—' : '→'}</span></span>
            </button>;
        })}
    </div>;
}
