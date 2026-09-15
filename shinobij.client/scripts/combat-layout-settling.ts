// Geometry sampling follows the harness's initial resize/React frame barrier.
// Keep its stability contract independent of the browser's repaint throughput.
export async function sampleStableGrid(
    sample: (attempt: number) => Promise<string>,
    wait: (attempt: number) => Promise<void>,
    observe?: (value: string, agreements: number) => void,
): Promise<{ agreements: number; attempts: number }> {
    let previous = await sample(-1);
    let agreements = 0;
    let attempts = 0;
    observe?.(previous, agreements);
    while (attempts < 24 && agreements < 4) {
        await wait(attempts);
        const current = await sample(attempts);
        agreements = current !== '' && current === previous ? agreements + 1 : 0;
        observe?.(current, agreements);
        previous = current;
        attempts += 1;
    }
    return { agreements, attempts };
}
