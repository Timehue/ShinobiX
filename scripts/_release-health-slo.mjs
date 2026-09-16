/** Evaluate already-collected request metrics; never generate traffic or alter
 * the server's liveness response. Unknown/insufficient samples cannot pass. */
export function evaluateRequestSlo(metrics) {
    const slo = metrics?.slo;
    if (!slo || typeof slo.healthy !== 'boolean' || typeof slo.evaluable !== 'boolean'
        || !Number.isInteger(metrics.count) || metrics.count < 0
        || !Number.isInteger(slo.minimumRequests) || slo.minimumRequests < 1
        || !Array.isArray(slo.breaches) || !slo.breaches.every(value => typeof value === 'string')) {
        return { status: 'INSUFFICIENT_DATA', exitCode: 2, reason: 'Request SLO metrics are missing or malformed.' };
    }
    if (!slo.evaluable || metrics.count < slo.minimumRequests) {
        return { status: 'INSUFFICIENT_DATA', exitCode: 2,
            reason: `Observed ${metrics.count} requests; at least ${slo.minimumRequests} evaluable samples are required.` };
    }
    if (!slo.healthy || slo.breaches.length > 0) {
        return { status: 'FAIL', exitCode: 1, reason: slo.breaches.join('; ') || 'Request SLO reports unhealthy.' };
    }
    return { status: 'PASS', exitCode: 0, reason: `${metrics.count} requests satisfy the configured SLO.` };
}
