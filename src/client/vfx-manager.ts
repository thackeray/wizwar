// VFX manager: consumes game events and triggers animations
import { VisualEffects } from './vfx';
import type { GameEvent } from '../core/types';

export class VFXManager {
  private vfx: VisualEffects;
  private boardRef: React.RefObject<HTMLDivElement>;
  private playerRefs: Map<number, React.RefObject<HTMLDivElement>>;
  
  constructor(container: HTMLElement) {
    this.vfx = new VisualEffects(container);
    this.boardRef = React.createRef();
    this.playerRefs = new Map();
  }
  
  // Process game events and trigger appropriate VFX
  processEvents(events: GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'move':
          this.handleMove(event);
          break;
        case 'damage':
          this.handleDamage(event);
          break;
        case 'cast':
          this.handleCast(event);
          break;
        case 'death':
          this.handleDeath(event);
          break;
        case 'vp':
          this.handleVP(event);
          break;
        case 'turn-start':
          this.handleTurnStart(event);
          break;
      }
    }
  }
  
  private handleMove(event: any): void {
    // Animate token movement
    const tokenEl = this.findTokenByPlayer(event.playerId);
    if (tokenEl) {
      const fromCell = this.findCell(event.from);
      const toCell = this.findCell(event.to);
      if (fromCell && toCell) {
        // Use gsap to animate token from old position to new position
        const fromRect = fromCell.getBoundingClientRect();
        const toRect = toCell.getBoundingClientRect();
        
        gsap.to(tokenEl, {
          left: toRect.left - fromRect.left + fromCell.offsetLeft,
          top: toRect.top - fromRect.top + fromCell.offsetTop,
          duration: 0.3,
          ease: 'power2.inOut',
        });
      }
    }
  }
  
  private handleDamage(event: any): void {
    // Flash damage on target cell
    const targetPlayer = this.findPlayerById(event.target);
    if (targetPlayer) {
      const cell = this.findCell(targetPlayer.pos);
      if (cell) {
        this.vfx.flashDamage(cell, '#ef4444');
        this.vfx.shakeAttack(cell);
      }
    }
  }
  
  private handleCast(event: any): void {
    // Glow effect on caster
    const casterPlayer = this.findPlayerById(event.caster);
    if (casterPlayer) {
      const cell = this.findCell(casterPlayer.pos);
      if (cell) {
        this.vfx.glowSpell(cell, '#22d3ee');
      }
    }
  }
  
  private handleDeath(event: any): void {
    // Particle effect on death
    const deadPlayer = this.findPlayerById(event.playerId);
    if (deadPlayer) {
      const cell = this.findCell(deadPlayer.pos);
      if (cell) {
        this.vfx.createParticles(cell, '#ef4444', 20);
      }
    }
  }
  
  private handleVP(event: any): void {
    // Flash player panel
    const playerPanel = this.playerRefs.get(event.playerId);
    if (playerPanel?.current) {
      this.vfx.glowSpell(playerPanel.current, '#facc15');
    }
  }
  
  private handleTurnStart(event: any): void {
    // Highlight current player
    const playerPanel = this.playerRefs.get(event.playerId);
    if (playerPanel?.current) {
      gsap.to(playerPanel.current, {
        boxShadow: '0 0 20px #facc15',
        duration: 0.3,
        yoyo: true,
        repeat: 1,
      });
    }
  }
  
  // Helper methods to find DOM elements
  private findTokenByPlayer(playerId: number): HTMLElement | null {
    return document.querySelector(`[data-player="${playerId}"]`);
  }
  
  private findCell(ref: { sector: string; r: number; c: number }): HTMLElement | null {
    // Find cell by sector, row, col
    const globalRow = ref.sector === 'blue' || ref.sector === 'red' ? ref.r : ref.r + 5;
    const globalCol = ref.sector === 'blue' || ref.sector === 'yellow' ? ref.c : ref.c + 5;
    return document.querySelector(`[data-row="${globalRow}"][data-col="${globalCol}"]`);
  }
  
  private findPlayerById(playerId: number): any {
    // This would need access to game state
    return null;
  }
}