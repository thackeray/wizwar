// Hand: the current player's cards, rendered as small cards with a CSS fallback
// when the card image is missing.
import { useState } from 'react';
import { getCard } from '../../core/cards/registry';
import type { CardDef } from '../../core/types';

const SCHOOL_COLOR: Record<string, string> = {
  cantrip: '#38bdf8',
  alchemy: '#a3e635',
  conjuring: '#34d399',
  elemental: '#fb923c',
  mentalism: '#a78bfa',
  mutation: '#f472b6',
  thaumaturgy: '#facc15',
};

function cardImage(card: CardDef): string | null {
  const dir = card.school.charAt(0).toUpperCase() + card.school.slice(1);
  const name = card.name.replace(/ /g, '%20');
  return `/images/cards/${dir}/${name}.png`;
}

function HandCard({ cardId, selected, onClick }: { cardId: string; selected: boolean; onClick: () => void }) {
  const card = getCard(cardId);
  const [imgFailed, setImgFailed] = useState(false);
  if (!card) return null;

  const src = cardImage(card);
  const showImg = src && !imgFailed;
  const schoolColor = SCHOOL_COLOR[card.school] ?? '#64748b';

  return (
    <div
      className={`card${selected ? ' card-selected' : ''}`}
      onClick={onClick}
      title={card.text}
    >
      {showImg ? (
        <>
          <img
            src={src!}
            alt={card.name}
            className="card-img"
            onError={() => setImgFailed(true)}
          />
          {card.energyValue > 0 && <div className="card-energy">{card.energyValue}</div>}
          <div className="card-name-overlay">{card.name}</div>
        </>
      ) : (
        <>
          <div className="card-school-bar" style={{ background: schoolColor }} />
          {card.energyValue > 0 && <div className="card-energy">{card.energyValue}</div>}
          <div className="card-name">{card.name}</div>
          <div className="card-school">{card.school}</div>
          <div className="card-text">{card.text}</div>
          <div className="card-type">{card.type}</div>
        </>
      )}
    </div>
  );
}

export default function Hand({ cards, selected, onCardClick, label = 'Hand' }: {
  cards: string[];
  selected: string | null;
  onCardClick: (cardId: string) => void;
  label?: string;
}) {
  return (
    <div className="hand">
      <div className="hand-label">{label}</div>
      <div className="hand-cards">
        {cards.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No cards</span>}
        {cards.map((id) => (
          <HandCard
            key={id}
            cardId={id}
            selected={selected === id}
            onClick={() => onCardClick(id)}
          />
        ))}
      </div>
    </div>
  );
}
