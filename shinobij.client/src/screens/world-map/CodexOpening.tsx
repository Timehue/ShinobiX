import { CardPackOpening } from '../../components/CardPackOpening';
import { getAllTileCards } from '../../data/tile-cards';
import { displayCardsById } from '../../lib/chronicle-duel';
import { CODEX_FLIP_LIMIT } from '../../lib/chronicle-scribe';
import '../../styles/chronicle-duel.css';
import '../../styles/card-pack-opening.css';

// The scribe grants builtin cards. Build the display catalog once, when the first pack is opened.
const cardsById = displayCardsById(getAllTileCards([]));

export function CodexOpening({ cards, ownedBefore, grantedCount, onClose }: {
    cards: string[]; ownedBefore: Map<string, number>; grantedCount: number; onClose: () => void;
}) {
    return <CardPackOpening packType="standard" cards={cards} cardsById={cardsById} ownedBefore={ownedBefore}
        title="The Traveler's Codex" countLabel={`${grantedCount} card${grantedCount === 1 ? '' : 's'} from Ihara`}
        flipLimit={CODEX_FLIP_LIMIT} onClose={onClose} />;
}
