import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const watchdogSource = readFileSync(new URL('../public/boot-watchdog.js', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

type Listener = (event?: Record<string, unknown>) => void

class FakeElement {
    tagName: string
    hidden = false
    disabled = false
    src = ''
    href = ''
    rel = ''
    type = ''
    textContent = ''
    focused = false
    attributes = new Map<string, string>()
    listeners = new Map<string, Listener[]>()

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase()
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value)
    }

    removeAttribute(name: string) {
        this.attributes.delete(name)
    }

    addEventListener(name: string, listener: Listener) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
    }

    dispatch(name: string) {
        for (const listener of this.listeners.get(name) ?? []) listener({ target: this })
    }

    focus() {
        this.focused = true
    }
}

function createHarness({ domReady = true, online = true }: { domReady?: boolean; online?: boolean } = {}) {
    const elements = new Map([
        ['boot-splash', new FakeElement('div')],
        ['boot-loading-state', new FakeElement('div')],
        ['boot-recovery', Object.assign(new FakeElement('div'), { hidden: true })],
        ['boot-recovery-title', new FakeElement('div')],
        ['boot-recovery-message', new FakeElement('p')],
        ['boot-reload', new FakeElement('button')],
        ['boot-network-status', new FakeElement('div')],
    ])
    const windowListeners = new Map<string, Listener[]>()
    const documentListeners = new Map<string, Listener[]>()
    const timers = new Map<number, Listener>()
    const scheduledDelays: number[] = []
    let nextTimer = 1
    let reloads = 0
    let markupAvailable = domReady

    const addListener = (store: Map<string, Listener[]>, name: string, listener: Listener) => {
        store.set(name, [...(store.get(name) ?? []), listener])
    }
    const removeListener = (store: Map<string, Listener[]>, name: string, listener: Listener) => {
        store.set(name, (store.get(name) ?? []).filter((candidate) => candidate !== listener))
    }
    const window = {
        location: { href: 'https://shinobijourney.com/', origin: 'https://shinobijourney.com', reload: () => { reloads += 1 } },
        navigator: { onLine: online },
        setTimeout: (listener: Listener, delay: number) => {
            const id = nextTimer++
            timers.set(id, listener)
            scheduledDelays.push(delay)
            return id
        },
        clearTimeout: (id: number) => { timers.delete(id) },
        addEventListener: (name: string, listener: Listener) => addListener(windowListeners, name, listener),
        removeEventListener: (name: string, listener: Listener) => removeListener(windowListeners, name, listener),
    } as Record<string, unknown>
    const document = {
        getElementById: (id: string) => markupAvailable ? elements.get(id) ?? null : null,
        addEventListener: (name: string, listener: Listener) => addListener(documentListeners, name, listener),
        removeEventListener: (name: string, listener: Listener) => removeListener(documentListeners, name, listener),
    }

    vm.runInNewContext(watchdogSource, { window, document, URL }, { filename: 'boot-watchdog.js' })

    const makeMarkupAvailable = () => {
        markupAvailable = true
    }
    const fireDomReady = () => {
        makeMarkupAvailable()
        for (const listener of [...(documentListeners.get('DOMContentLoaded') ?? [])]) listener()
    }
    if (domReady) fireDomReady()

    return {
        elements,
        window,
        reloads: () => reloads,
        makeMarkupAvailable,
        fireDomReady,
        dispatchWindow(name: string, event: Record<string, unknown> = {}) {
            for (const listener of windowListeners.get(name) ?? []) listener(event)
        },
        runTimers() {
            for (const [id, listener] of [...timers]) {
                timers.delete(id)
                listener()
            }
        },
        pendingTimers: () => timers.size,
        scheduledDelays,
        windowListenerCount: (name: string) => (windowListeners.get(name) ?? []).length,
    }
}

test('boot recovery is CSP-safe, accessible, and installed before the app module', () => {
    const watchdogTag = '<script src="/boot-watchdog.js"></script>'
    const appTag = '<script type="module" src="/src/main.tsx"></script>'
    assert.ok(indexSource.includes(watchdogTag))
    assert.ok(indexSource.indexOf(watchdogTag) < indexSource.indexOf(appTag))
    // No inline EXECUTABLE script may precede the app module, so production's
    // script-src 'self' stays strict. `application/ld+json` is exempt: browsers
    // never execute it, CSP script-src does not gate it, and the SEO graph has
    // to be inline in the document to be crawled.
    assert.doesNotMatch(
        indexSource,
        /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/i,
    )
    assert.match(indexSource, /id="boot-splash" role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
    assert.match(indexSource, /id="boot-splash"[^>]*overflow:auto/)
    assert.match(indexSource, /id="boot-recovery" hidden/)
    assert.match(indexSource, /id="boot-reload" type="button"[^>]*>Reload latest game<\/button>/)
})

test('watchdog ignores unrelated failures and exposes recovery for a failed same-origin entry asset', () => {
    const harness = createHarness()
    harness.dispatchWindow('error', { target: { tagName: 'IMG', src: 'https://shinobijourney.com/art.webp' } })
    harness.dispatchWindow('error', { target: { tagName: 'LINK', rel: 'stylesheet', href: 'https://shinobijourney.com/assets/app.css' } })
    harness.dispatchWindow('error', { target: { tagName: 'SCRIPT', type: '', src: 'https://shinobijourney.com/analytics.js' } })
    harness.dispatchWindow('error', { target: { tagName: 'SCRIPT', type: 'module', src: 'https://cdn.example.com/app.js' } })
    harness.dispatchWindow('error', { target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://cdn.example.com/game.js' } })
    assert.equal(harness.elements.get('boot-recovery')?.hidden, true)

    harness.dispatchWindow('error', {
        target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://shinobijourney.com/assets/game-12345678.js' },
    })
    assert.equal(harness.elements.get('boot-recovery')?.hidden, false)
    assert.equal(harness.elements.get('boot-splash')?.attributes.get('data-boot-failure'), 'asset')
    assert.equal(harness.elements.get('boot-splash')?.attributes.get('role'), 'alertdialog')
    assert.equal(harness.elements.get('boot-splash')?.attributes.get('aria-labelledby'), 'boot-recovery-title')
    assert.equal(harness.elements.get('boot-splash')?.attributes.get('aria-describedby'), 'boot-recovery-message boot-network-status')
    assert.equal(harness.elements.get('boot-splash')?.attributes.has('aria-label'), false)
    assert.equal(
        harness.elements.get('boot-recovery-message')?.textContent,
        'A game file was interrupted. Any progress already saved is safe.',
    )
    assert.equal(harness.elements.get('boot-reload')?.focused, true)
    assert.equal(harness.reloads(), 0, 'asset failure must never auto-reload')

    const entryScript = createHarness()
    entryScript.dispatchWindow('error', {
        target: { tagName: 'SCRIPT', type: 'module', src: 'https://shinobijourney.com/assets/index-12345678.js' },
    })
    assert.equal(entryScript.elements.get('boot-recovery')?.hidden, false)
    assert.equal(entryScript.reloads(), 0)
})

test('an asset failure before body markup is preserved and revealed when the DOM becomes ready', () => {
    const harness = createHarness({ domReady: false })
    harness.dispatchWindow('error', {
        target: { tagName: 'LINK', rel: 'modulepreload', href: 'https://shinobijourney.com/assets/game-12345678.js' },
    })
    assert.equal(harness.elements.get('boot-recovery')?.hidden, true)
    assert.equal(harness.reloads(), 0)

    harness.fireDomReady()
    assert.equal(harness.elements.get('boot-recovery')?.hidden, false)
    assert.equal(harness.elements.get('boot-splash')?.attributes.get('data-boot-failure'), 'asset')
    assert.equal(harness.reloads(), 0)
})

test('recovery gives accurate offline guidance and updates when connectivity changes', () => {
    const harness = createHarness({ online: false })
    harness.runTimers()
    assert.equal(
        harness.elements.get('boot-network-status')?.textContent,
        'Your device appears offline. Reconnect, then reload.',
    )

    ;(harness.window.navigator as { onLine: boolean }).onLine = true
    harness.dispatchWindow('online')
    assert.equal(harness.elements.get('boot-network-status')?.textContent, 'Check your connection, then try again.')
})

test('bounded timeout offers only an explicit reload, while the React-ready signal cancels it', () => {
    const timedOut = createHarness()
    assert.deepEqual(timedOut.scheduledDelays, [30_000])
    timedOut.runTimers()
    assert.equal(timedOut.elements.get('boot-recovery')?.hidden, false)
    assert.equal(timedOut.elements.get('boot-splash')?.attributes.get('data-boot-failure'), 'timeout')
    assert.equal(
        timedOut.elements.get('boot-recovery-message')?.textContent,
        'The game is taking longer than expected to start. Any progress already saved is safe.',
    )
    assert.equal(timedOut.reloads(), 0)
    timedOut.elements.get('boot-reload')?.dispatch('click')
    assert.equal(timedOut.reloads(), 1)

    const healthy = createHarness()
    const ready = healthy.window.__shinobiBootReady
    assert.equal(typeof ready, 'function')
    ;(ready as () => void)()
    assert.equal(healthy.pendingTimers(), 0)
    assert.equal(healthy.windowListenerCount('error'), 0)
    assert.equal(healthy.windowListenerCount('online'), 0)
    assert.equal(healthy.windowListenerCount('offline'), 0)
    healthy.runTimers()
    healthy.dispatchWindow('error', {
        target: { tagName: 'SCRIPT', type: 'module', src: 'https://shinobijourney.com/assets/index-12345678.js' },
    })
    assert.equal(healthy.elements.get('boot-recovery')?.hidden, true)
    assert.equal(healthy.reloads(), 0)
})

test('recovery binds its action even when a module delays DOMContentLoaded', () => {
    const harness = createHarness({ domReady: false })
    harness.makeMarkupAvailable()
    harness.runTimers()
    assert.equal(harness.elements.get('boot-recovery')?.hidden, false)
    harness.elements.get('boot-reload')?.dispatch('click')
    assert.equal(harness.reloads(), 1)
})

test('React entry synchronously clears the watchdog only after accepting its first render', () => {
    const renderIndex = mainSource.indexOf('root.render(')
    const readyIndex = mainSource.indexOf('__shinobiBootReady?.()')
    assert.ok(renderIndex >= 0)
    assert.ok(readyIndex > renderIndex)
})
