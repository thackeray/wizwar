// Entry point: setup screen + AI battle bootstrap.

import type { School } from '../core/types';
import { Battle } from './battle';

const CHOOSABLE_SCHOOLS: School[] = [
  'alchemy',
  'conjuring',
  'elemental',
  'mentalism',
  'mutation',
  'thaumaturgy',
];

function showSetup(): void {
  const root = document.getElementById('app')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'setup';

  const title = document.createElement('h1');
  title.textContent = 'Wiz-War AI Battle Setup';
  box.appendChild(title);

  // Player count.
  const countRow = document.createElement('div');
  countRow.className = 'setup__row';
  countRow.innerHTML = '<label>Players: </label>';
  const countSel = document.createElement('select');
  for (const n of [2, 3, 4]) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = String(n);
    if (n === 4) opt.selected = true;
    countSel.appendChild(opt);
  }
  countRow.appendChild(countSel);
  box.appendChild(countRow);

  // Game mode.
  const modeRow = document.createElement('div');
  modeRow.className = 'setup__row';
  modeRow.innerHTML = '<label>Mode: </label>';
  const modeSel = document.createElement('select');
  const aiOpt = document.createElement('option');
  aiOpt.value = 'ai';
  aiOpt.textContent = 'AI vs AI (Spectate)';
  aiOpt.selected = true;
  modeSel.appendChild(aiOpt);
  const humanOpt = document.createElement('option');
  humanOpt.value = 'human';
  humanOpt.textContent = 'Human vs AI';
  modeSel.appendChild(humanOpt);
  modeRow.appendChild(modeSel);
  box.appendChild(modeRow);

  // Schools.
  const schoolRow = document.createElement('div');
  schoolRow.className = 'setup__row';
  schoolRow.innerHTML = '<label>Schools (pick 3): </label>';
  const schoolChecks: Record<string, HTMLInputElement> = {};
  const schoolWrap = document.createElement('span');
  for (const s of CHOOSABLE_SCHOOLS) {
    const label = document.createElement('label');
    label.className = 'setup__school';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s;
    schoolChecks[s] = cb;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + s));
    schoolWrap.appendChild(label);
  }
  schoolRow.appendChild(schoolWrap);
  box.appendChild(schoolRow);

  // Start button.
  const startBtn = document.createElement('button');
  startBtn.className = 'setup__start';
  startBtn.textContent = 'Start Game';
  startBtn.addEventListener('click', () => {
    const count = parseInt(countSel.value, 10);
    const mode = modeSel.value;
    const schools = CHOOSABLE_SCHOOLS.filter((s) => schoolChecks[s].checked);
    if (schools.length !== 3) {
      alert('Please select exactly 3 schools.');
      return;
    }
    
    // Determine bot types based on mode.
    let botTypes: ('random' | 'heuristic' | 'evolving' | 'human')[];
    if (mode === 'human') {
      // Human vs AI: first player is human, rest are AI.
      botTypes = Array(count).fill('heuristic');
      botTypes[0] = 'human';
    } else {
      // AI vs AI: all players are AI.
      botTypes = Array(count).fill('heuristic');
    }
    
    const battle = new Battle(root, {
      playerCount: count,
      botTypes,
      schools,
      speed: 'medium',
      seed: Math.floor(Math.random() * 0xffffffff),
    });
    battle.start();
  });
  box.appendChild(startBtn);

  root.appendChild(box);
}

// Inject base styles.
function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #1e293b; color: #e2e8f0; }
  #app { max-width: 1400px; margin: 0 auto; padding: 12px; }
  
  /* Battle UI styles */
  .battle__header { display: flex; justify-content: space-between; padding: 8px 0; font-size: 18px; }
  .battle__title { font-weight: bold; }
  .battle__meta { opacity: 0.7; }
  .battle__main { display: flex; gap: 16px; align-items: flex-start; }
  .battle__board { flex: 0 0 500px; }
  .battle__sidebar { flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .battle__players { display: flex; flex-direction: column; gap: 8px; }
  .battle__hands { display: flex; flex-direction: column; gap: 8px; }
  .battle__hand { background: #0f172a; border-radius: 6px; padding: 8px; }
  .battle__hand-label { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
  .battle__cards { display: flex; gap: 6px; flex-wrap: wrap; }
  .battle__effects { background: #0f172a; border-radius: 6px; padding: 8px; }
  .battle__effects-title { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
  .battle__player-effects { margin-bottom: 8px; }
  .battle__effects-player { font-size: 11px; font-weight: bold; }
  .battle__effects-list { display: flex; flex-direction: column; gap: 2px; }
  .battle__effect { font-size: 10px; opacity: 0.8; }
  .battle__log { margin-top: 12px; height: 120px; overflow-y: auto; background: #0f172a; border-radius: 6px; padding: 8px; font-size: 12px; }
  .battle__logline { padding: 1px 0; }
  
  /* Board styles */
  .board { display: grid; gap: 1px; background: #0f172a; border: 2px solid #475569; aspect-ratio: 1; }
  .board__cell { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 8px; background-size: cover; background-position: center; }
  .board__cell--home { outline: 2px solid rgba(0,0,0,0.3); outline-offset: -2px; }
  .board__cell--highlight { box-shadow: inset 0 0 0 2px #22d3ee; }
  .board__cell--current { box-shadow: inset 0 0 0 3px #facc15; }
  .board__cell--wall-n::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #333; }
  .board__cell--wall-s::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #333; }
  .board__cell--wall-e::before { content: ''; position: absolute; top: 0; right: 0; bottom: 0; width: 3px; background: #333; }
  .board__cell--wall-w::after { content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 3px; background: #333; }
  .board__cell--door-n::before { content: ''; position: absolute; top: 0; left: 20%; right: 20%; height: 3px; background: #8b5a2b; }
  .board__cell--door-s::after { content: ''; position: absolute; bottom: 0; left: 20%; right: 20%; height: 3px; background: #8b5a2b; }
  .board__cell--door-e::before { content: ''; position: absolute; top: 20%; right: 0; bottom: 20%; width: 3px; background: #8b5a2b; }
  .board__cell--door-w::after { content: ''; position: absolute; top: 20%; left: 0; bottom: 20%; width: 3px; background: #8b5a2b; }
  .board__token { width: 70%; height: 70%; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 9px; border: 1px solid #fff; }
  .board__token--stunned { opacity: 0.6; }
  .board__tokens { display: flex; gap: 1px; }
  .board__treasure { position: absolute; top: 0; color: #b91c1c; font-size: 8px; }
  .board__object { position: absolute; bottom: 0; color: #555; font-size: 8px; }
  
  /* Card styles */
  .card { width: 140px; height: 190px; border-radius: 10px; padding: 8px; font-size: 12px; position: relative; cursor: pointer; border: 2px solid transparent; overflow: hidden; }
  .card--small { width: 120px; height: 165px; }
  .card--selected { border-color: #facc15; transform: translateY(-8px); }
  .card__overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 8px; background: linear-gradient(transparent 50%, rgba(0,0,0,0.8) 100%); }
  .card__name { font-weight: bold; font-size: 14px; color: #fff; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); }
  .card__school { font-size: 11px; opacity: 0.9; text-transform: uppercase; }
  .card__text { font-size: 10px; margin-top: 6px; line-height: 1.3; }
  .card__energy { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; z-index: 10; }
  
  /* Player styles */
  .player { border: 2px solid; border-radius: 6px; padding: 6px; }
  .player--active { background: rgba(255,255,255,0.08); }
  .player__name { font-weight: bold; text-transform: capitalize; }
  .player__status { font-size: 12px; margin-top: 2px; }
  .player__extra { font-size: 10px; opacity: 0.7; margin-top: 2px; }
  
  /* Setup styles */
  .setup { max-width: 500px; margin: 40px auto; background: #0f172a; padding: 24px; border-radius: 8px; }
  .setup h1 { text-align: center; }
  .setup__row { margin: 16px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .setup__school { margin-right: 10px; font-size: 13px; }
  .setup__start { display: block; width: 100%; padding: 12px; font-size: 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; margin-top: 16px; }
  
  /* Visual effects styles */
  .vfx__overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .vfx__overlay-box { text-align: center; padding: 40px; }
  .vfx__overlay-box h1 { font-size: 32px; margin-bottom: 16px; }
  .vfx__overlay-box h2 { font-size: 24px; }
  .vfx__particle { position: fixed; width: 8px; height: 8px; border-radius: 50%; pointer-events: none; z-index: 999; }
`;

injectStyles();
showSetup();