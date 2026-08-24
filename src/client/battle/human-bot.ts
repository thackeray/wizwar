// HumanBot: an AIPlayer whose chooseAction/chooseCounter wait for real human
// input from the UI. runBattle treats it like any bot, so phases/advance/counter
// windows all keep working; we just pause on the human.
import type { GameState, Action } from '../../core/types';
import type { AIPlayer } from '../../core/ai/bots';

export interface PendingAction {
  state: GameState;
  legal: Action[];
  resolve: (a: Action) => void;
}
export interface PendingCounter {
  state: GameState;
  pending: { cardId: string; caster: number };
  myHand: string[];
  resolve: (c: { cardId: string } | null) => void;
}

export class HumanBot implements AIPlayer {
  name = 'Human';
  private act: PendingAction | null = null;
  private cnt: PendingCounter | null = null;
  onChange?: () => void;

  get pendingAction(): PendingAction | null {
    return this.act;
  }
  get pendingCounter(): PendingCounter | null {
    return this.cnt;
  }

  async chooseAction(state: GameState, legal: Action[]): Promise<Action> {

    return new Promise<Action>((resolve) => {
      this.act = {
        state,
        legal,
        resolve: (a) => {
          this.act = null;
          this.onChange?.();
          resolve(a);
        },
      };
      this.onChange?.();
    });
  }

  async chooseCounter(state: GameState, pending: { cardId: string; caster: number }, myHand: string[]): Promise<{ cardId: string } | null> {
    return new Promise((resolve) => {
      this.cnt = {
        state,
        pending,
        myHand,
        resolve: (c) => {
          this.cnt = null;
          this.onChange?.();
          resolve(c);
        },
      };
      this.onChange?.();
    });
  }

  submitAction(action: Action): void {
    if (this.act) this.act.resolve(action);
  }
  submitCounter(cardId: string | null): void {
    if (this.cnt) this.cnt.resolve(cardId ? { cardId } : null);
  }
}
