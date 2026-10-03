import { createServer } from 'node:net';

/**
 * A TCP port the OS reports free right now, for a harness that starts a server
 * of its own.
 *
 * A fixed default port can already be held on a shared machine: 41988, the old
 * soak default, sits inside Linux's ephemeral range (32768-60999), where any
 * outbound connection on a CI runner may own it, and one did (EADDRINUSE).
 *
 * The probe binds every interface, as `server.listen(port)` does with no host,
 * so a port it hands back is free where the server will bind it. The OS may
 * still give that port to another process between this probe closing and the
 * server binding, so a caller that boots a server should retry on a fresh port
 * when the boot fails with EADDRINUSE.
 */
export function freePort() {
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.unref();
        probe.once('error', reject);
        probe.listen(0, () => {
            const address = probe.address();
            if (!address || typeof address === 'string') {
                probe.close();
                reject(new Error('The OS assigned no TCP port.'));
                return;
            }
            probe.close(() => resolve(address.port));
        });
    });
}
