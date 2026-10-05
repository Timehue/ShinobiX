import { FIRST_CONTRACT_ROUTES, type FirstContractRoute } from '../../../shared/first-contract';
import { FIRST_CONTRACT_COPY } from '../lib/first-contract';
import combatArt from '../assets/academy/onboarding/first-contract-combat-v2.webp';
import discoveryArt from '../assets/academy/onboarding/first-contract-discovery-v2.webp';
import companionArt from '../assets/academy/onboarding/first-contract-companion-v2.webp';
import './first-contract.css';

const ROUTE_ART = { combat: combatArt, discovery: discoveryArt, companion: companionArt };

export function FirstContractRoutes({ onChoose, busy = false, hasCompanion = true, selected, completedRoutes = [] }: {
    onChoose: (route: FirstContractRoute) => void; busy?: boolean; hasCompanion?: boolean; selected?: FirstContractRoute; completedRoutes?: FirstContractRoute[];
}) {
    const completed = new Set(completedRoutes);
    const activeRoute = FIRST_CONTRACT_ROUTES.find((route) => !completed.has(route));
    return <div className="fc-routes" role="group" aria-label="Choose your first assignment">
        {FIRST_CONTRACT_ROUTES.map((route, index) => {
            const copy = FIRST_CONTRACT_COPY[route];
            const unavailable = route === 'companion' && !hasCompanion;
            const isComplete = completed.has(route);
            const isLocked = !isComplete && route !== activeRoute;
            return <button className={`fc-route fc-route--${route}${unavailable ? ' is-unavailable' : ''}${isComplete ? ' is-complete' : ''}${isLocked ? ' is-locked' : ''}`} key={route} type="button" disabled={busy || unavailable || isComplete || isLocked} onClick={() => onChoose(route)} aria-pressed={selected === route}>
                <img className="fc-route-art" src={ROUTE_ART[route]} alt="" aria-hidden="true" width={640} height={960} decoding="async" />
                <span className="fc-route-shade" aria-hidden="true" />
                <span className="fc-route-number" aria-hidden="true">0{index + 1}</span>
                <span className="fc-route-copy">
                    <span className="fc-eyebrow">{isComplete ? `Step ${index + 1} complete · ${copy.label}` : isLocked ? `Locked · ${copy.label}` : `Step ${index + 1} of 3 · ${copy.label}`}{selected === route ? ' · Current route' : ''}</span>
                    <strong>{copy.title}</strong>
                    <span className="fc-route-description">{unavailable ? 'Add a companion to your roster before this final assignment.' : copy.line}</span>
                </span>
                <span className="fc-route-link">{isComplete ? 'Assignment complete' : unavailable ? 'Companion needed' : isLocked ? 'Complete the step before this one' : 'Begin this assignment'} <span aria-hidden="true">{isComplete ? '✓' : unavailable || isLocked ? '—' : '→'}</span></span>
            </button>;
        })}
    </div>;
}
