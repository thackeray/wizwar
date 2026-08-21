// Hot-seat flow: turn-switch and game-over overlays.

export function showTurnPrompt(
  playerName: string,
  color: string,
  onContinue: () => void,
): void {
  removeOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'hotseat-overlay';

  const box = document.createElement('div');
  box.className = 'overlay__box';

  const title = document.createElement('div');
  title.className = 'overlay__title';
  title.textContent = 'Pass the device';
  box.appendChild(title);

  const name = document.createElement('div');
  name.className = 'overlay__name';
  name.style.color = color;
  name.textContent = `${playerName}'s turn`;
  box.appendChild(name);

  const hint = document.createElement('div');
  hint.className = 'overlay__hint';
  hint.textContent = 'Click to continue';
  box.appendChild(hint);

  overlay.appendChild(box);
  overlay.addEventListener('click', () => {
    removeOverlay();
    onContinue();
  });
  document.body.appendChild(overlay);
}

export function showGameOver(winnerName: string, color: string): void {
  removeOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'hotseat-overlay';

  const box = document.createElement('div');
  box.className = 'overlay__box';

  const title = document.createElement('div');
  title.className = 'overlay__title';
  title.textContent = 'Game Over';
  box.appendChild(title);

  const winner = document.createElement('div');
  winner.className = 'overlay__name';
  winner.style.color = color;
  winner.textContent = `${winnerName} wins!`;
  box.appendChild(winner);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

export function removeOverlay(): void {
  const existing = document.getElementById('hotseat-overlay');
  if (existing) existing.remove();
}