import { expect, test } from 'bun:test';
import { StateMachine } from './state';
import { TitleState, type GameContext } from './states';

test('menu view age is a resettable fixed-tick presentation clock', () => {
  const machine = new StateMachine();
  const context: GameContext = { machine, nextSeed: () => 1 };
  const title = new TitleState(context);
  machine.push(title);
  expect(title.view().age).toBe(0);
  machine.tick(0);
  machine.tick(0);
  expect(title.view().age).toBe(2);

  // Re-entering the same screen re-arms both input edges and presentation age.
  title.enter();
  expect(title.view().age).toBe(0);
});
