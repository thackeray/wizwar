// Player panel: life / VP / MP / status badges / carried treasure / effects.
import type React from 'react';
import type { PlayerState } from '../../core/types';
import { MAX_LIFE } from '../../core/state';

const colorName: Record<string, string> = {
  blue: 'blue', red: 'red', yellow: 'yellow', green: 'green',
};

export default function PlayerPanel({
  player,
  isTurn,
  isCurrent,
}: {
  player: PlayerState;
  isTurn: boolean; // this player's turn (highlight)
  isCurrent: boolean; // current player for AI battle "turn" marker
}) {
  const lifePct = Math.max(0, Math.min(100, (player.life / MAX_LIFE) * 100));
  const mpDots = Array.from({ length: 5 }, (_, i) => i < player.mp);
  const badges: React.ReactNode[] = [];
  if (player.stunned) badges.push(<span key="stun" className="player-badge player-badge--stun">⚡ Stun</span>);
  if (player.transformed) badges.push(<span key="tr" className="player-badge player-badge--transform">🔄 Transform</span>);
  if (player.carriedTreasure !== null) badges.push(<span key="trs" className="player-badge player-badge--treasure">◆ Treasure</span>);
  if (player.speedBoosted) badges.push(<span key="sp" className="player-badge player-badge--boost">» Boost</span>);

  const classes = [
    'player-panel',
    `${colorName[player.color]}-border`,
    player.alive ? '' : 'player-panel--dead',
    isTurn ? 'player-panel--turn' : '',
    isCurrent ? 'player-panel--active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="player-row">
        <span className={`player-dot bg-${colorName[player.color]}-500`} style={{ background: TOKEN_COLOR[player.color] }} />
        <span className="player-name">{player.color} Wizard</span>
        {badges}
      </div>
      <div className="player-life-bar">
        <div className="player-life-fill" style={{ width: `${lifePct}%` }} />
      </div>
      <div className="player-meta">
        <div className="player-mp-dots">
          {mpDots.map((on, i) => (
            <span key={i} className={`mp-dot${on ? ' mp-dot--on' : ''}`} />
          ))}
        </div>
        <span className="player-vp">{'★'.repeat(player.vp)}{'☆'.repeat(Math.max(0, 2 - player.vp))}</span>
        <span>{player.life}/{MAX_LIFE}</span>
      </div>
      {player.maintainedSpells.length > 0 && (
        <div className="player-effects">
          {player.maintainedSpells.map((s) => `${s.cardId}(${s.energy})`).join(', ')}
        </div>
      )}
    </div>
  );
}

export const TOKEN_COLOR: Record<string, string> = {
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
};
