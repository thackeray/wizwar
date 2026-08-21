// Entry point: setup screen + game bootstrap.

import { createBoard } from '../core/board';
import { createGameState } from '../core/state';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { HeuristicBot } from '../core/ai/bots';
import type { Color, School } from '../core/types';
import { GameUI } from './ui';

const ALL_COLORS: Color[] = ['blue', 'red', 'yellow', 'green'];
const CHOOSABLE_SCHOOLS: School[] = [
  'alchemy',
  'conjuring',
  'elemental',
  'mentalism',
  'mutation',
  'thaumaturgy',
];

function showSetup(onStart: (cfg: SetupConfig) => void): void {
  const root = document.getElementById('app')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'setup';

  const title = document.createElement('h1');
  title.textContent = 'Wiz-War Setup';
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

  // Seat type (human/bot) - rebuilt on count change.
  const seatsRow = document.createElement('div');
  seatsRow.className = 'setup__row';
  box.appendChild(seatsRow);

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
    const seatTypes: ('human' | 'bot')[] = Array.from(
      seatsRow.querySelectorAll<HTMLInputElement>('input[name=seat]'),
    ).map((el) => (el.value === 'bot' ? 'bot' : 'human'));
    const schools = CHOOSABLE_SCHOOLS.filter((s) => schoolChecks[s].checked);
    if (schools.length !== 3) {
      alert('Please select exactly 3 schools.');
      return;
    }
    onStart({
      seed: Math.floor(Math.random() * 0xffffffff),
      playerColors: ALL_COLORS.slice(0, count),
      seatTypes,
      schools,
    });
  });
  box.appendChild(startBtn);

  function rebuildSeats(): void {
    const count = parseInt(countSel.value, 10);
    seatsRow.innerHTML = '<label>Seats: </label>';
    for (let i = 0; i < count; i++) {
      const label = document.createElement('label');
      label.className = 'setup__seat';
      const human = document.createElement('input');
      human.type = 'radio';
      human.name = `seat${i}`;
      human.value = 'human';
      human.checked = i === 0;
      const bot = document.createElement('input');
      bot.type = 'radio';
      bot.name = `seat${i}`;
      bot.value = 'bot';
      label.appendChild(human);
      label.appendChild(document.createTextNode(' H'));
      label.appendChild(bot);
      label.appendChild(document.createTextNode(' B '));
      seatsRow.appendChild(label);
    }
  }

  countSel.addEventListener('change', rebuildSeats);
  rebuildSeats();

  root.appendChild(box);
}

interface SetupConfig {
  seed: number;
  playerColors: Color[];
  seatTypes: ('human' | 'bot')[];
  schools: School[];
}

function startGame(cfg: SetupConfig): void {
  loadBuiltInCards();
  const board = createBoard();
  const deckSchools: School[] = ['cantrip', ...cfg.schools];
  const deck = buildDeck(deckSchools);

  const state = createGameState(
    {
      seed: cfg.seed,
      playerColors: cfg.playerColors,
      botSeats: cfg.seatTypes.map((t) => t === 'bot'),
      schools: deckSchools,
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );

  const bots = cfg.seatTypes.map(
    (t) => (t === 'bot' ? new HeuristicBot() : null),
  );

  const root = document.getElementById('app')!;
  root.innerHTML = '';
  new GameUI(root, state, { bots });
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
  #app { max-width: 1100px; margin: 0 auto; padding: 12px; }
  .ui__header { display: flex; justify-content: space-between; padding: 8px 0; font-size: 18px; }
  .ui__title { font-weight: bold; }
  .ui__main { display: flex; gap: 12px; }
  .ui__board { flex: 1; }
  .ui__sidebar { width: 200px; display: flex; flex-direction: column; gap: 8px; }
  .board { display: grid; gap: 1px; background: #0f172a; border: 2px solid #475569; aspect-ratio: 1; }
  .board__cell { position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 8px; }
  .board__cell--home { outline: 2px solid rgba(0,0,0,0.3); outline-offset: -2px; }
  .board__cell--highlight { box-shadow: inset 0 0 0 2px #22d3ee; }
  .board__cell--current { box-shadow: inset 0 0 0 3px #facc15; }
  .board__token { width: 70%; height: 70%; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 9px; border: 1px solid #fff; }
  .board__token--stunned { opacity: 0.6; }
  .board__tokens { display: flex; gap: 1px; }
  .board__treasure { position: absolute; top: 0; color: #b91c1c; font-size: 8px; }
  .board__object { position: absolute; bottom: 0; color: #555; font-size: 8px; }
  .ui__controls { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ui__hand { display: flex; gap: 6px; flex-wrap: wrap; min-height: 90px; padding: 6px; background: #0f172a; border-radius: 6px; }
  .card { width: 90px; height: 120px; border-radius: 6px; padding: 6px; font-size: 10px; position: relative; cursor: pointer; border: 2px solid transparent; overflow: hidden; }
  .card--small { width: 80px; height: 110px; }
  .card--selected { border-color: #facc15; transform: translateY(-6px); }
  .card__name { font-weight: bold; font-size: 11px; }
  .card__school { font-size: 9px; opacity: 0.8; text-transform: uppercase; }
  .card__text { font-size: 8px; margin-top: 4px; line-height: 1.2; }
  .card__energy { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; }
  .ui__endturn { align-self: flex-end; padding: 8px 16px; font-size: 14px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  .ui__endturn:disabled { background: #475569; cursor: not-allowed; }
  .ui__log { margin-top: 12px; height: 120px; overflow-y: auto; background: #0f172a; border-radius: 6px; padding: 8px; font-size: 12px; }
  .ui__logline { padding: 1px 0; }
  .player { border: 2px solid; border-radius: 6px; padding: 6px; }
  .player--active { background: rgba(255,255,255,0.08); }
  .player__name { font-weight: bold; text-transform: capitalize; }
  .player__status { font-size: 12px; margin-top: 2px; }
  .player__extra { font-size: 10px; opacity: 0.7; margin-top: 2px; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; cursor: pointer; }
  .overlay__box { text-align: center; padding: 40px; }
  .overlay__title { font-size: 28px; margin-bottom: 12px; }
  .overlay__name { font-size: 22px; text-transform: capitalize; }
  .overlay__hint { font-size: 14px; opacity: 0.7; margin-top: 16px; }
  .ui__flash { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #dc2626; color: #fff; padding: 8px 16px; border-radius: 6px; z-index: 200; }
  .setup { max-width: 500px; margin: 40px auto; background: #0f172a; padding: 24px; border-radius: 8px; }
  .setup h1 { text-align: center; }
  .setup__row { margin: 16px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .setup__school { margin-right: 10px; font-size: 13px; }
  .setup__seat { margin-right: 12px; font-size: 13px; }
  .setup__start { display: block; width: 100%; padding: 12px; font-size: 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; margin-top: 16px; }
`;

injectStyles();
showSetup(startGame);