import { useState } from 'react';
import { clearExchangeReturnContext, peekExchangeReturnContext } from '../lib/exchange-return';

export function ExchangeReturnPrompt({ account, onReturn }: { account: string; onReturn: () => void }) {
    const [available, setAvailable] = useState(() => !!peekExchangeReturnContext(account));
    if (!available) return null;
    return <aside className="summary-box" aria-label="Exchange return">
        <span>Your inspected Exchange listing is saved for a deliberate return.</span>
        <button type="button" onClick={onReturn}>Return to Exchange</button>
        <button type="button" onClick={() => { clearExchangeReturnContext(account); setAvailable(false); }}>Cancel return</button>
    </aside>;
}
