/**
 * The v4 edition's authored narrative.
 *
 * This is the one source of truth for words the edition speaks. Boss exchanges
 * are compiled into `campaign.json` by `tools/make-v4-content.ts`; the ending is
 * handed to the generic game shell as plain data by the v4 composition root.
 * Keeping both here prevents an edition-specific voice from leaking into
 * `src/game`, while the generated campaign remains a deterministic artefact
 * rather than a second authoring surface.
 *
 * The language is deliberately concrete. It names crossing, holding, recording,
 * filing and wear — behaviours that make negative space visible — without
 * naming the theory behind them. The ending likewise leaves the strata in place:
 * the record stops, but no perfect order replaces it.
 */

import type { CampaignEndings } from '../../game/states';

interface DialogueLine {
  readonly speaker: string;
  readonly text: string;
}

interface BossDialogue {
  readonly dialogue: readonly DialogueLine[];
  readonly dialogueFor?: Readonly<Record<string, readonly DialogueLine[]>>;
}

type V4BossName = 'sentinel' | 'warden' | 'magistrate' | 'chancellor' | 'regent';

/**
 * Pre-fight exchanges, keyed by the boss object that consumes them.
 *
 * `dialogueFor` mirrors the runtime's character-specific override exactly. A
 * variant replaces the default exchange and may have a different line count;
 * every shipped variant still preserves a player reply.
 */
export const V4_BOSS_DIALOGUE = {
  sentinel: {
    dialogue: [
      { speaker: 'sentinel', text: 'Far enough.' },
      { speaker: 'player', text: 'The gate is behind me.' },
      { speaker: 'sentinel', text: 'I was watching how you crossed.' },
    ],
    dialogueFor: {
      spire: [
        { speaker: 'sentinel', text: 'You climb without a summit.' },
        { speaker: 'player', text: 'Then watch what the climb leaves behind.' },
      ],
    },
  },
  warden: {
    dialogue: [
      { speaker: 'warden', text: 'This corridor is closed.' },
      { speaker: 'player', text: 'Then why are you still holding it?' },
      { speaker: 'warden', text: 'Nothing stays closed by itself.' },
    ],
  },
  magistrate: {
    dialogue: [
      { speaker: 'magistrate', text: 'Every step is in the record.' },
      { speaker: 'player', text: 'Then read what I did.' },
      { speaker: 'magistrate', text: 'Trespass. Evasion. Persistence.' },
      { speaker: 'player', text: 'Call my next step an appeal.' },
    ],
  },
  chancellor: {
    dialogue: [
      { speaker: 'chancellor', text: 'Every crossing is filed here.' },
      { speaker: 'player', text: 'You filed the trace, not the crossing.' },
      { speaker: 'chancellor', text: 'The trace is enough.' },
      { speaker: 'player', text: 'Only if I stop moving.' },
    ],
    dialogueFor: {
      spire: [
        { speaker: 'chancellor', text: 'You held one line all the way here.' },
        { speaker: 'player', text: 'I held a path. You named it law.' },
      ],
    },
  },
  regent: {
    dialogue: [
      { speaker: 'regent', text: 'No order was issued here. It was worn into place.' },
      { speaker: 'player', text: 'By whom?' },
      { speaker: 'regent', text: 'By everyone who passed through.' },
      { speaker: 'player', text: 'Then we can wear it open.' },
      { speaker: 'regent', text: 'Or deepen the groove.' },
    ],
    dialogueFor: {
      spire: [
        { speaker: 'regent', text: 'The steps behind you are worn deep.' },
        { speaker: 'player', text: 'The next one need not be.' },
        { speaker: 'regent', text: 'Then stop here.' },
      ],
    },
  },
} as const satisfies Record<V4BossName, BossDialogue>;

/**
 * The v4 campaign ending, keyed by its actual terminal stage.
 *
 * A guest ship flying v4 receives the fallback middle page; a guest campaign
 * does not receive any of these pages because its terminal stage has a different
 * qualified name. The empty string on the closing page is authored vertical
 * punctuation and is rendered as a visible pause by `drawViewLines`.
 */
export const V4_ENDINGS = {
  'stage-4': {
    music: 'adjourn',
    scene: 'wear-field',
    pages: [
      {
        lines: [
          'You have reached the bottom of the descent.',
          'The seat at the centre is empty.',
          'The floor around it is worn smooth.',
        ],
      },
      {
        lines: [
          'You reached the centre. What comes next is not on record.',
        ],
        linesFor: {
          scout: [
            'You were passing through. The field still carries your wake.',
          ],
          lance: [
            'You cut a passage. It has not closed yet.',
          ],
          hound: [
            'You found no source, only tracks crossing yours.',
          ],
          spire: [
            'You reached no summit. You still choose where to stand.',
          ],
          maw: [
            'What you swallowed left a space. You leave it unfilled.',
          ],
        },
      },
      {
        lines: [
          'The strata remain. Your passage remains open.',
          '',
          'The record ends here. You keep moving.',
          'Adjourned sine die.',
        ],
      },
    ],
  },
} as const satisfies CampaignEndings;
