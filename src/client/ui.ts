// Game UI controller: renders state, handles interaction, drives hot-seat loop.

import type { GameState, CellRef, TargetRef } from '../core/types';
import { applyAction } from '../core/actions';
import { startTurn } from '../core/turn';
import { getLegalActions, type AIPlayer } from '../core/ai/bots';
import { moveDestination } from '../core/board';
import { getCard } from '../core/cards/registry';
import { renderBoard } from './board-view';
import { renderCard, PLAYER_COLORS } from './card-view';
import { showTurnPrompt, showGameOver } from './hotseat';

export interface GameUIOptions {
  bots: (AIPlayer | null)[]; // per seat; null = human
}

export class GameUI {
  private state: GameState;
  private container: HTMLElement;
  private bots: (AIPlayer | null)[];
  private selectedCard: string | null = null;
  private busy = false;

  constructor(container: HTMLElement, state: GameState, opts: GameUIOptions) {
    this.container = container;
    this.state = state;
    this.bots = opts.bots;
    this.render();
    this.advanceIfNeeded();
  }

  private isBotTurn(): boolean {
    const p = this.state.players[this.state.currentPlayer];
    return p.isBot && this.bots[this.state.currentPlayer] !== null;
  }

  // If it's a bot's turn, auto-play; otherwise prompt for human.
  private async advanceIfNeeded(): Promise<void> {
    if (this.state.winner !== null) {
      this.renderGameOver();
      return;
    }
    if (this.isBotTurn()) {
      await this.playBotTurn();
    } else {
      const p = this.state.players[this.state.currentPlayer];
      // Only show turn prompt if there are multiple human players
      const humanPlayers = this.state.players.filter((pl) => !pl.isBot);
      if (humanPlayers.length > 1) {
        showTurnPrompt(p.color, PLAYER_COLORS[p.color], () => {
          startTurn(this.state);
          this.render();
        });
      } else {
        // Single player or vs bots: start turn immediately
        startTurn(this.state);
        this.render();
      }
    }
  }

  private async playBotTurn(): Promise<void> {
    this.busy = true;
    const bot = this.bots[this.state.currentPlayer]!;
    const botId = this.state.players[this.state.currentPlayer].id;
    startTurn(this.state);
    this.render();

    let guard = 0;
    while (
      this.state.winner === null &&
      (this.state.phase === 'move-cast' || this.state.phase === 'discard-draw') &&
      guard++ < 40
    ) {
      if (this.state.players[this.state.currentPlayer].id !== botId) break;
      const p = this.state.players[this.state.currentPlayer];
      const legal = getLegalActions(this.state, p.id);
      if (legal.length === 0) break;
      const action = await bot.chooseAction(this.state, legal);
      applyAction(this.state, action);
      this.render();
      await new Promise((r) => setTimeout(r, 120));
    }

    this.busy = false;
    this.render();
    await this.advanceIfNeeded();
  }

  private renderGameOver(): void {
    const w = this.state.winner!;
    const p = this.state.players[w];
    showGameOver(p.color, PLAYER_COLORS[p.color]);
  }

  render(): void {
    const s = this.state;
    this.container.innerHTML = '';

    // Header.
    const header = document.createElement('div');
    header.className = 'ui__header';
    header.innerHTML = `<span class="ui__title">Wiz-War</span>
      <span class="ui__meta">Turn ${s.turnNumber} · ${s.phase}</span>`;
    this.container.appendChild(header);

    // Main area: board + sidebar (with hand).
    const main = document.createElement('div');
    main.className = 'ui__main';

    const boardWrap = document.createElement('div');
    boardWrap.className = 'ui__board';
    const highlight = this.computeHighlights();
    renderBoard(s, boardWrap, {
      onCellClick: (ref) => this.handleCellClick(ref),
      highlight,
      selectedCard: this.selectedCard,
    });
    main.appendChild(boardWrap);

    const sidebar = document.createElement('div');
    sidebar.className = 'ui__sidebar';
    sidebar.appendChild(this.renderPlayerPanels());
    
    // Hand + controls in sidebar
    const controls = document.createElement('div');
    controls.className = 'ui__controls';
    controls.appendChild(this.renderHand());
    controls.appendChild(this.renderPhaseControls());
    sidebar.appendChild(controls);
    
    main.appendChild(sidebar);

    this.container.appendChild(main);

    // Log.
    const log = document.createElement('div');
    log.className = 'ui__log';
    const entries = s.log.slice(-8);
    for (const e of entries) {
      const line = document.createElement('div');
      line.className = 'ui__logline';
      line.textContent = `[T${e.turn}] ${e.text}`;
      log.appendChild(line);
    }
    this.container.appendChild(log);
  }

  private computeHighlights(): CellRef[] {
    if (this.busy || this.isBotTurn()) return [];
    const p = this.state.players[this.state.currentPlayer];
    const out: CellRef[] = [];
    
    // If a card is selected, highlight valid targets
    if (this.selectedCard) {
      const card = getCard(this.selectedCard);
      if (card) {
        // Highlight all cells with players (for wizard targets)
        for (const pl of this.state.players) {
          if (pl.alive && pl.id !== p.id) {
            out.push(pl.pos);
          }
        }
        // Also highlight the current cell for self-targeting
        out.push(p.pos);
      }
      return out;
    }
    
    // Otherwise, highlight move destinations
    const legal = getLegalActions(this.state, p.id);
    for (const a of legal) {
      if (a.type === 'move') {
        const dest = this.moveDest(p.pos, a.dir);
        if (dest) out.push(dest);
      }
    }
    return out;
  }

  private moveDest(from: CellRef, dir: 'N' | 'S' | 'E' | 'W'): CellRef | null {
    const color = this.state.players[this.state.currentPlayer].color;
    return moveDestination(this.state.board, from, dir, color);
  }

  private renderPlayerPanels(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui__players';
    for (const p of this.state.players) {
      const panel = document.createElement('div');
      panel.className = 'player' + (p.id === this.state.currentPlayer ? ' player--active' : '');
      panel.style.borderColor = PLAYER_COLORS[p.color];
      const status = p.alive
        ? `Life ${p.life} · VP ${p.vp} · MP ${p.mp}`
        : 'Eliminated';
      panel.innerHTML = `
        <div class="player__name" style="color:${PLAYER_COLORS[p.color]}">
          ${p.color}${p.isBot ? ' (bot)' : ''}
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

  private renderHand(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui__hand';
    const p = this.state.players[this.state.currentPlayer];
    if (this.isBotTurn()) {
      wrap.textContent = `${p.color} bot is thinking...`;
      return wrap;
    }
    if (p.hand.length === 0) {
      wrap.textContent = 'No cards in hand';
      return wrap;
    }
    for (const cardId of p.hand) {
      const cardEl = renderCard(cardId, { small: true });
      if (this.selectedCard === cardId) cardEl.classList.add('card--selected');
      cardEl.addEventListener('click', () => this.handleCardClick(cardId));
      wrap.appendChild(cardEl);
    }
    return wrap;
  }

  private renderPhaseControls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ui__phasecontrols';
    const disabled = this.busy || this.isBotTurn();
    const phase = this.state.phase;
    const p = this.state.players[this.state.currentPlayer];

    const mkBtn = (text: string, onClick: () => void, disabledOverride = false): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'ui__endturn';
      b.textContent = text;
      b.disabled = disabled || disabledOverride;
      b.addEventListener('click', onClick);
      return b;
    };

    if (phase === 'move-cast') {
      // Punch button (if adjacent enemy exists)
      const adjacentEnemy = this.state.players.find(
        (t) => t.id !== p.id && t.alive && this.isAdjacent(p.pos, t.pos)
      );
      if (adjacentEnemy && !p.attacked && this.state.turnNumber > 1) {
        wrap.appendChild(mkBtn('Punch', () => this.handlePunch(adjacentEnemy.id)));
      }
      
      // Pick up treasure (if on treasure cell)
      const cell = this.state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
      if (cell.treasures.length > 0 && p.carriedTreasure === null) {
        wrap.appendChild(mkBtn('Pick Treasure', () => this.handlePickTreasure(cell.treasures[0])));
      }
      
      // Pick up object (if on object cell)
      if (cell.objects.length > 0) {
        wrap.appendChild(mkBtn('Pick Object', () => this.handlePickObject(cell.objects[0].id)));
      }
      
      // Drop item (if carrying items)
      if (p.carriedItems.length > 0) {
        wrap.appendChild(mkBtn('Drop Item', () => this.handleDropItem(p.carriedItems[0])));
      }
      
      // Boost speed (if have energy card and not already boosted)
      const energyCard = p.hand.find((id) => {
        const card = getCard(id);
        return card && card.energyValue > 0 && card.type === 'energy';
      });
      if (energyCard && !p.speedBoosted) {
        wrap.appendChild(mkBtn('Boost Speed', () => this.handleBoostSpeed(energyCard)));
      }
      
      wrap.appendChild(mkBtn('End Turn', () => this.handleEndTurn()));
    } else if (phase === 'discard-draw') {
      wrap.appendChild(mkBtn('Draw 1', () => this.handleDraw(1)));
      wrap.appendChild(mkBtn('Draw 2', () => this.handleDraw(2)));
      wrap.appendChild(mkBtn('Done', () => this.handleEndTurn()));
    }
    return wrap;
  }

  private isAdjacent(a: CellRef, b: CellRef): boolean {
    if (a.sector !== b.sector) return false;
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  }

  private handlePunch(targetId: number): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'punch', target: targetId });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot punch');
    }
  }

  private handlePickTreasure(treasureId: number): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'pick-up-treasure', treasureId });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot pick up treasure');
    }
  }

  private handlePickObject(objectId: number): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'pick-up-object', objectId });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot pick up object');
    }
  }

  private handleDropItem(cardId: string): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'drop-item', cardId });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot drop item');
    }
  }

  private handleBoostSpeed(cardId: string): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'boost-speed', cardId });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot boost speed');
    }
  }

  private handleCardClick(cardId: string): void {
    if (this.busy || this.isBotTurn()) return;
    this.selectedCard = this.selectedCard === cardId ? null : cardId;
    this.render();
  }

  private handleCellClick(ref: CellRef): void {
    if (this.busy || this.isBotTurn()) return;
    const p = this.state.players[this.state.currentPlayer];
    const prev = p.id;

    // If a card is selected, try to cast at this target.
    if (this.selectedCard) {
      // Check if there's a player on this cell to target them
      const targetPlayer = this.state.players.find(
        (pl) => pl.alive && pl.pos.sector === ref.sector && pl.pos.r === ref.r && pl.pos.c === ref.c
      );
      
      let target: TargetRef;
      if (targetPlayer) {
        target = { kind: 'wizard', id: targetPlayer.id };
      } else {
        target = { kind: 'cell', ref };
      }
      
      const res = applyAction(this.state, {
        type: 'cast',
        cardId: this.selectedCard,
        target,
      });
      this.selectedCard = null;
      if (res.ok) {
        this.afterAction(prev);
      } else {
        this.flash(res.reason ?? 'Cannot cast there');
        this.render();
      }
      return;
    }

    // Otherwise, try to move to an adjacent cell.
    const dir = this.dirTo(p.pos, ref);
    if (!dir) {
      this.flash('Not an adjacent cell');
      return;
    }
    const res = applyAction(this.state, { type: 'move', dir });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot move');
    }
  }

  private dirTo(from: CellRef, to: CellRef): 'N' | 'S' | 'E' | 'W' | null {
    if (from.sector !== to.sector) return null;
    const dr = to.r - from.r;
    const dc = to.c - from.c;
    if (dr === -1 && dc === 0) return 'N';
    if (dr === 1 && dc === 0) return 'S';
    if (dr === 0 && dc === 1) return 'E';
    if (dr === 0 && dc === -1) return 'W';
    return null;
  }

  private handleEndTurn(): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    applyAction(this.state, { type: 'end-turn' });
    this.afterAction(prev);
  }

  private handleDraw(count: number): void {
    if (this.busy || this.isBotTurn()) return;
    const prev = this.state.players[this.state.currentPlayer].id;
    const res = applyAction(this.state, { type: 'draw', count });
    if (res.ok) {
      this.afterAction(prev);
    } else {
      this.flash(res.reason ?? 'Cannot draw');
    }
  }

  private afterAction(prevPlayerId: number): void {
    this.render();
    if (this.state.winner !== null) {
      this.renderGameOver();
      return;
    }
    const curId = this.state.players[this.state.currentPlayer].id;
    if (curId !== prevPlayerId) {
      // Turn advanced to a new player.
      this.advanceIfNeeded();
    }
  }

  private flash(msg: string): void {
    const el = document.createElement('div');
    el.className = 'ui__flash';
    el.textContent = msg;
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
}