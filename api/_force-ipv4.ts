/**
 * Force IPv4 for all outbound undici / global-fetch connections when
 * FORCE_IPV4=1.
 *
 * Why: some hosts (Railway) default to an IPv6 route that can't actually reach
 * Supabase's REST endpoint, so undici (which @supabase/supabase-js uses for
 * fetch) hangs/fails and KV reads throw — e.g. world-state returns 503 and
 * login reports "could not reach server". `--dns-result-order=ipv4first` does
 * NOT fix this because undici ignores it. Pinning `family: 4` at the dispatcher
 * level does, and it mirrors exactly what cPanel's app.js already does (which is
 * why cPanel reaches this same Supabase project fine).
 *
 * Gated on FORCE_IPV4 so this NEVER runs on cPanel: there, app.js installs its
 * own global dispatcher (with CageFS-specific hardcoded DNS) BEFORE loading the
 * compiled server, and clobbering it would break DNS resolution on CloudLinux.
 * Set FORCE_IPV4=1 on Railway (and any normal host that prefers an unreachable
 * IPv6 route); leave it unset on cPanel.
 *
 * Imported first in server.ts so the dispatcher is set before any handler can
 * issue a Supabase request.
 */
import { setGlobalDispatcher, Agent } from 'undici';

if (process.env.FORCE_IPV4 === '1') {
    try {
        // undici's `connect` option type wrongly requires a `port` field (it's
        // supplied per-request at runtime), so cast past the overly-strict type.
        // app.js does the equivalent in plain JS (no type checking).
        setGlobalDispatcher(new Agent({ connect: { family: 4 } as never }));
        console.log('[ipv4] outbound connections pinned to IPv4 (FORCE_IPV4=1)');
    } catch (err) {
        console.warn('[ipv4] could not set IPv4 dispatcher:', (err as Error).message);
    }
}
