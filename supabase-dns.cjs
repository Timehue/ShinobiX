function cleanDnsHost(value) {
    const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!host) return '';
    if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
        throw new Error('SUPABASE_DNS_HOST must be a hostname, not a URL or IP literal.');
    }
    return host;
}

function cleanIpv4(value) {
    const ip = typeof value === 'string' ? value.trim() : '';
    if (!ip) return '';
    const parts = ip.split('.');
    if (parts.length !== 4) throw new Error('SUPABASE_HARDCODED_IP must be an IPv4 address.');
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) throw new Error('SUPABASE_HARDCODED_IP must be an IPv4 address.');
        const n = Number(part);
        if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('SUPABASE_HARDCODED_IP must be an IPv4 address.');
    }
    return ip;
}

function buildHardcodedDnsMap(env = process.env) {
    const host = cleanDnsHost(env.SUPABASE_DNS_HOST);
    const ip = cleanIpv4(env.SUPABASE_HARDCODED_IP);
    const explicitlyEnabled = env.SUPABASE_DNS_BYPASS === '1';
    if (!explicitlyEnabled && !host && !ip) return {};
    if (!host || !ip) {
        throw new Error('cPanel Supabase DNS bypass requires both SUPABASE_DNS_HOST and SUPABASE_HARDCODED_IP.');
    }
    return { [host]: ip };
}

// Build the custom DNS lookup used to patch `dns.lookup` and to seed the undici
// Agent. The dns primitives are INJECTED so the fallback can never re-enter the
// patched global lookup:
//
//   deps.originalLookup  — the ORIGINAL dns.lookup, captured by the caller
//                          BEFORE it overwrites dns.lookup with this function.
//   deps.resolve4        — dns.resolve4 (c-ares path).
//   deps.setServers      — dns.setServers (point c-ares at public resolvers).
//
// The recursion bug this fixes: app.js used to overwrite `dns.lookup` with
// customLookup and then, on a resolve4 failure, call `require('dns').lookup(...)`
// — which by then WAS customLookup, so a failed resolve4 recursed forever.
// Binding the captured original here makes the fallback terminate in Node's real
// resolver. A `settled` guard ensures the caller's callback fires exactly once.
function makeCustomLookup(hardcodedMap, deps) {
    const {
        resolve4,
        setServers,
        originalLookup,
        publicDnsServers = ['8.8.8.8', '1.1.1.1'],
        log = () => {},
    } = deps || {};
    if (typeof originalLookup !== 'function') {
        throw new Error('makeCustomLookup requires deps.originalLookup (the pre-patch dns.lookup).');
    }
    const map = hardcodedMap || {};
    let serversConfigured = false;

    return function customLookup(hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }

        if (map[hostname]) {
            log('[app] DNS hardcode hit:', hostname, '->', map[hostname]);
            return callback(null, map[hostname], 4);
        }

        // Guard so the callback is invoked exactly once even if a defensive
        // fallback and a resolve4 callback ever both fire.
        let settled = false;
        const fallback = () => {
            if (settled) return;
            settled = true;
            // ORIGINAL lookup — never `this`/the patched global — so no recursion.
            originalLookup(hostname, options, callback);
        };

        try {
            if (!serversConfigured && typeof setServers === 'function') {
                setServers(publicDnsServers);
                serversConfigured = true;
            }
            resolve4(hostname, (err, addresses) => {
                if (settled) return;
                if (err || !addresses || !addresses.length) return fallback();
                settled = true;
                callback(null, addresses[0], 4);
            });
        } catch (_) {
            fallback();
        }
    };
}

module.exports = {
    buildHardcodedDnsMap,
    cleanDnsHost,
    cleanIpv4,
    makeCustomLookup,
};
