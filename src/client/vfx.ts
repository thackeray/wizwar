// Visual effects using GSAP for animations.

import gsap from 'gsap';

export class VisualEffects {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  // Flash a cell when damage is dealt.
  flashDamage(cellEl: HTMLElement, color: string = '#ef4444'): void {
    gsap.fromTo(
      cellEl,
      { backgroundColor: color, opacity: 0.8 },
      { backgroundColor: 'transparent', opacity: 0, duration: 0.5, ease: 'power2.out' }
    );
  }

  // Pulse effect for stunned wizards.
  pulseStunned(tokenEl: HTMLElement): void {
    gsap.to(tokenEl, {
      opacity: 0.5,
      duration: 0.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
    });
  }

  // Glow effect for active spells.
  glowSpell(cellEl: HTMLElement, color: string = '#22d3ee'): void {
    gsap.to(cellEl, {
      boxShadow: `0 0 20px ${color}`,
      duration: 0.3,
      yoyo: true,
      repeat: 1,
      ease: 'power2.inOut',
    });
  }

  // Shake effect for attacks.
  shakeAttack(cellEl: HTMLElement): void {
    gsap.to(cellEl, {
      x: 5,
      duration: 0.05,
      yoyo: true,
      repeat: 5,
      ease: 'none',
      onComplete: () => gsap.set(cellEl, { x: 0 }),
    });
  }

  // Fade in/out for game over.
  showGameOverOverlay(winnerColor: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'vfx__overlay';
    overlay.innerHTML = `
      <div class="vfx__overlay-box">
        <h1>Game Over</h1>
        <h2 style="color: ${winnerColor}">Winner!</h2>
      </div>
    `;
    this.container.appendChild(overlay);
    
    gsap.fromTo(
      overlay,
      { opacity: 0 },
      { opacity: 1, duration: 0.5, ease: 'power2.out' }
    );
    
    return overlay;
  }

  // Highlight valid targets.
  highlightTargets(cells: HTMLElement[]): void {
    cells.forEach((cell, i) => {
      gsap.fromTo(
        cell,
        { boxShadow: 'inset 0 0 0 2px #22d3ee' },
        {
          boxShadow: 'inset 0 0 0 4px #22d3ee',
          duration: 0.3,
          yoyo: true,
          repeat: -1,
          delay: i * 0.1,
          ease: 'power2.inOut',
        }
      );
    });
  }

  // Animate card play.
  animateCardPlay(cardEl: HTMLElement, targetCell: HTMLElement): void {
    const rect = cardEl.getBoundingClientRect();
    const targetRect = targetCell.getBoundingClientRect();
    
    const clone = cardEl.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.zIndex = '1000';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    
    gsap.to(clone, {
      left: targetRect.left + targetRect.width / 2 - rect.width / 2,
      top: targetRect.top + targetRect.height / 2 - rect.height / 2,
      scale: 0.5,
      opacity: 0,
      duration: 0.5,
      ease: 'power2.inOut',
      onComplete: () => clone.remove(),
    });
  }

  // Particle effect for special abilities.
  createParticles(cellEl: HTMLElement, color: string = '#facc15', count: number = 10): void {
    const rect = cellEl.getBoundingClientRect();
    
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'vfx__particle';
      particle.style.left = `${rect.left + rect.width / 2}px`;
      particle.style.top = `${rect.top + rect.height / 2}px`;
      particle.style.backgroundColor = color;
      document.body.appendChild(particle);
      
      const angle = (Math.PI * 2 * i) / count;
      const distance = 30 + Math.random() * 20;
      
      gsap.to(particle, {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out',
        onComplete: () => particle.remove(),
      });
    }
  }

  // Smooth scroll to log.
  scrollToLog(logEl: HTMLElement): void {
    gsap.to(logEl, {
      scrollTop: logEl.scrollHeight,
      duration: 0.3,
      ease: 'power2.out',
    });
  }
}