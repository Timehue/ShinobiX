/*
 * Clans hold land on the Unmapped Coast, and nowhere else.
 *
 * Owner ruling, 2026-11-21: "clans can only claim territories on this new map
 * not the old one". Until then a clan of ten could spend 75 Territory Control
 * Scrolls to capture one sector of the home map (api/clan/territory/). That is
 * closed:
 *   - capturing and reinforcing a home sector is refused (assign-scrolls.ts);
 *   - the sectors clans already hold there are released by the next lifecycle
 *     sweep (api/_territory-lifecycle-store.ts), reason `coast-only`;
 *   - War Supply, which a held home sector produced, is produced by the sector
 *     a clan holds on the coast instead, at the same rate (collect-supply.ts,
 *     api/coast/_land.ts collectCoastClaimSupply);
 *   - the +10% a clan's members had with one chosen school on their home sector
 *     is chosen and applied on the coast sector instead, in player fights and
 *     AI fights alike (api/coast/_land.ts setCoastClaimSchool, coastHomeSchool);
 *   - the weather a clan fixed over its home sector is fixed over its coast
 *     sector instead, and the coast has the scheduled weather the home map has
 *     (api/_sector-weather-seal.ts, api/coast/_land.ts setCoastClaimWeather);
 *   - a clan's Landing on that sector is its town, and inside it its members are
 *     in a safe zone, as in a village (api/coast/_town-presence.ts).
 *
 * Village sector wars are untouched: a VILLAGE still owns home sectors.
 *
 * The home code is left in place behind this one switch so that nothing else
 * had to be rewritten. It is off, and there is no setting that turns it on:
 * the switch exists so the tests that pin how the old rules behaved can still
 * run them.
 */
import { COAST_MIN_LEVEL } from '../shared/world-maps.js';

let open = false;

/** What a player is told when they try to claim or reinforce a home sector for a clan. */
export const HOME_CLAN_TERRITORY_CLOSED = `Clans hold land on the Unmapped Coast now. Take a sector there by contest, at level ${COAST_MIN_LEVEL} or higher.`;

export const homeClanTerritoryOpen = (): boolean => open;

/** Tests of the old home rules only. `null` puts the switch back. */
export function setHomeClanTerritoryOpenForTest(value: boolean | null): void {
    open = value === true;
}
