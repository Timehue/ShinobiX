/** Observers for disposable local QA pages. Never records headers or body data. */
export function createBrowserNetworkDiagnostics() {
    const started = performance.now();
    const events = [];
    const pages = new WeakMap();
    const requests = new WeakMap();
    let nextPage = 0, nextRequest = 0;
    let droppedEvents = 0;
    const record = (type, page, detail = {}) => {
        if (events.length >= 50_000) { droppedEvents++; return; }
        const info = pages.get(page);
        events.push({ ms: Math.round((performance.now() - started) * 1000) / 1000,
            type, ...(info ? { page: info.id, scenario: info.scenario, closing: info.closing } : {}), ...detail });
    };
    const describe = request => {
        let value = requests.get(request);
        if (!value) {
            const path = new URL(request.url()).pathname.replace(/\/api\/save\/[^/]+/, '/api/save/:fixture');
            let action;
            try { action = request.postDataJSON()?.action; } catch { /* No body retained. */ }
            value = { request: ++nextRequest, path, method: request.method(),
                action: /^(stronghold-(enter|state|step|leave|patrol-report)|state|start|report)$/.test(action ?? '') ? action : null };
            requests.set(request, value);
        }
        return value;
    };
    return {
        observe(page, scenario) {
            const info = { id: ++nextPage, scenario, pending: new Map(), closing: false };
            pages.set(page, info);
            record('page-created', page);
            page.on('request', request => {
                if (!new URL(request.url()).pathname.startsWith('/api/')) return;
                const detail = describe(request);
                info.pending.set(detail.request, detail);
                record('request', page, detail);
            });
            page.on('response', response => {
                if (requests.has(response.request())) record('response', page, { ...describe(response.request()), status: response.status() });
            });
            for (const event of ['requestfinished', 'requestfailed']) page.on(event, request => {
                if (!requests.has(request)) return;
                const detail = describe(request);
                record(event, page, { ...detail, ...(event === 'requestfailed' ? { failure: request.failure()?.errorText } : {}) });
                info.pending.delete(detail.request);
            });
            page.on('pageerror', error => record('pageerror', page, { message: String(error), stack: error.stack,
                pending: [...info.pending.values()] }));
            page.on('console', message => {
                if (message.type() === 'error') record('console-error', page, { message: message.text() });
            });
            page.on('framenavigated', frame => {
                if (frame === page.mainFrame()) record('navigation', page, { pending: [...info.pending.values()] });
            });
            page.on('close', () => record('page-closed', page, { pending: [...info.pending.values()] }));
            // Record explicit teardown before the browser starts canceling reads.
            const close = page.close.bind(page);
            page.close = async (...args) => {
                info.closing = true;
                record('page-close-begin', page, { pending: [...info.pending.values()] });
                return close(...args);
            };
        },
        async route(page, route, handle) {
            const detail = describe(route.request());
            record('route-begin', page, detail);
            try { return await handle(); }
            catch (error) { record('route-error', page, { ...detail, message: String(error) }); throw error; }
            finally { record('route-end', page, detail); }
        },
        report() { return { schema: 1, scope: 'Disposable local QA only; no headers or request/response bodies', droppedEvents, events }; },
    };
}
