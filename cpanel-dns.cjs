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

module.exports = {
    buildHardcodedDnsMap,
    cleanDnsHost,
    cleanIpv4,
};
