// AI Battle UI: Clean interface for watching AI battles with real-time updates.

import type { GameState, CellRef } from '../core/types';
import { getLegalActions } from '../core/ai/bots';
import { moveDestination } from '../core/board';
import { getCard } from '../core/cards/registry';
import { renderBoard } from './board-view';
import { renderCard, PLAYER_COLORS } from './card-view';
import { VisualEffects } from './vfx';

export interface BattleUIOptions {
  showHands: boolean; // Show all players' hands
  showEffects: boolean; // Show active effects
}

export class BattleUI {
  private state: GameState;
  private container: HTMLElement;
  private options: BattleUIOptions;
  private vfx: VisualEffects;

  constructor(container: HTMLElement, state: GameState, options?: Partial<BattleUIOptions>) {
    this.container = container;
    this.state = state;
    this.options = {
      showHands: options?.showHands ?? true,
      showEffects: options?.showEffects ?? true,
    };
    this.vfx = new VisualEffects(container);
    this.render();
  }

  render(): void {
    const s = this.state;
    this.container.innerHTML = '';

    // Header with controls.
    const header = document.createElement('div');
    header.className = 'battle__header';
    header.innerHTML = `
      <span class="battle__title">Wiz-War AI Battle</span>
      <span class="battle__meta">Turn ${s.turnNumber} · ${s.phase}</span>
    `;
    this.container.appendChild(header);

    // Apply visual effects after rendering.
    this.applyVisualEffects();

    // Main area: board + sidebar.
    const main = document.createElement('div');
    main.className = 'battle__main';

    // Board.
    const boardWrap = document.createElement('div');
    boardWrap.className = 'battle__board';
    const highlight = this.computeHighlights();
    renderBoard(s, boardWrap, {
      onCellClick: (ref) => this.handleCellClick(ref),
      highlight,
      selectedCard: null,
    });
    main.appendChild(boardWrap);

    // Sidebar.
    const sidebar = document.createElement('div');
    sidebar.className = 'battle__sidebar';
    sidebar.appendChild(this.renderPlayerPanels());
    if (this.options.showHands) {
      sidebar.appendChild(this.renderAllHands());
    }
    if (this.options.showEffects) {
      sidebar.appendChild(this.renderActiveEffects());
    }
    main.appendChild(sidebar);

    this.container.appendChild(main);

    // Log.
    const log = document.createElement('div');
    log.className = 'battle__log';
    const entries = s.log.slice(-10);
    for (const e of entries) {
      const line = document.createElement('div');
      line.className = 'battle__logline';
      line.textContent = `[T${e.turn}] ${e.text}`;
      log.appendChild(line);
    }
    this.container.appendChild(log);
  }

  private computeHighlights(): CellRef[] {
    const p = this.state.players[this.state.currentPlayer];
    const out: CellRef[] = [];
    
    // Highlight current player's position.
    out.push(p.pos);
    
    // Highlight move destinations.
    const legal = getLegalActions(this.state, p.id);
    for (const a of legal) {
      if (a.type === 'move') {
        const dest = moveDestination(this.state.board, p.pos, a.dir, p.color);
        if (dest) out.push(dest);
      }
    }
    return out;
  }

  private handleCellClick(_ref: CellRef): void {
    // Cell click handler (can be extended for future interactions).
  }

  private applyVisualEffects(): void {
    // Apply stun effects to stunned players.
    for (const p of this.state.players) {
      if (!p.alive || !p.stunned) continue;
      
      const tokenEl = this.container.querySelector(
        `.board__token[data-player="${p.id}"]`
      ) as HTMLElement;
      if (tokenEl) {
        this.vfx.pulseStunned(tokenEl);
      }
    }

    // Apply glow effects to cells with maintained spells.
    for (const p of this.state.players) {
      if (!p.alive || p.maintainedSpells.length === 0) continue;
      
      const cellEl = this.container.querySelector(
        `.board__cell[data-ref="${p.pos.sector}-${p.pos.r}-${p.pos.c}"]`
      ) as HTMLElement;
      if (cellEl) {
        this.vfx.glowSpell(cellEl, PLAYER_COLORS[p.color]);
      }
    }
  }

  private renderPlayerPanels(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'battle__players';
    for (const p of this.state.players) {
      const panel = document.createElement('div');
      panel.className = 'player' + (p.id === this.state.currentPlayer ? ' player--active' : '');
      panel.style.borderColor = PLAYER_COLORS[p.color];
      const status = p.alive
        ? `Life ${p.life} · VP ${p.vp} · MP ${p.mp}`
        : 'Eliminated';
      panel.innerHTML = `
        <div class="player__name" style="color:${PLAYER_COLORS[p.color]}">
          ${p.color}
        </div>
        <div class="player__status">${status}</div>
        <div class="player__extra">
          ${p.stunned ? 'Stunned ' : ''}${p.transformed ? 'Transformed' : ''}
          Items:${p.carriedItems.length} Spells:${p.maintainedSpells.length}
        </div>`;
      wrap.appendChild(panel);
    }
    return wrap;
  }

  private renderAllHands(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'battle__hands';
    for (const p of this.state.players) {
      if (!p.alive) continue;
      const handWrap = document.createElement('div');
      handWrap.className = 'battle__hand';
      handWrap.innerHTML = `<div class="battle__hand-label" style="color:${PLAYER_COLORS[p.color]}">${p.color}'s hand (${p.hand.length})</div>`;
      const cards = document.createElement('div');
      cards.className = 'battle__cards';
      for (const cardId of p.hand) {
        const cardEl = renderCard(cardId, { small: true });
        cards.appendChild(cardEl);
      }
      handWrap.appendChild(cards);
      wrap.appendChild(handWrap);
    }
    return wrap;
  }

  private renderActiveEffects(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'battle__effects';
    wrap.innerHTML = '<div class="battle__effects-title">Active Effects</div>';
    
    for (const p of this.state.players) {
      if (!p.alive || p.maintainedSpells.length === 0) continue;
      const playerEffects = document.createElement('div');
      playerEffects.className = 'battle__player-effects';
      playerEffects.innerHTML = `<div class="battle__effects-player" style="color:${PLAYER_COLORS[p.color]}">${p.color}</div>`;
      const effectsList = document.createElement('div');
      effectsList.className = 'battle__effects-list';
      for (const spell of p.maintainedSpells) {
        const card = getCard(spell.cardId);
        if (card) {
          const effectEl = document.createElement('div');
          effectEl.className = 'battle__effect';
          effectEl.textContent = `${card.name} (${spell.energy} energy)`;
          effectsList.appendChild(effectEl);
        }
      }
      playerEffects.appendChild(effectsList);
      wrap.appendChild(playerEffects);
    }
    return wrap;
  }
}