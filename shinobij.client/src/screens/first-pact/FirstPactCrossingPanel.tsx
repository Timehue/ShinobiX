/** Entry presentation; the campaign retains load, retry and admission authority. */
export function FirstPactCrossingPanel({ onCross, onExit }: { onCross: () => void; onExit: () => void }) {
    return (<section className="fp-crossing" role="dialog" aria-modal="true" aria-label="Enter The First Pact">
                    <div className="fp-crossing-shade" />
                    <div className="fp-crossing-copy">
                        <span className="fp-eyebrow">Celestial Tower · Complete temporal crossing</span>
                        <h1>The First Pact</h1>
                        <p>The threshold opens on the Sunken Court during its last living hours. This is the past, not a reconstructed refuge. Its fall is fixed. You can still decide which testimony leaves with you.</p>
                        <div className="fp-party-rule"><strong>Premier format</strong><span>2 active pets · 2 reserves · single-player RPG</span></div>
                        <button type="button" onClick={onCross}>Cross into the Sunken Court</button>
                        <button type="button" className="fp-quiet-button" onClick={onExit}>Step away</button>
                    </div>
                </section>);
}
