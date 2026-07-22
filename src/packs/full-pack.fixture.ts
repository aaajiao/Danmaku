/**
 * Complete format-1 pack fixture used by validator, injector and playthrough
 * tests. It deliberately lives in memory: the shipped `packs/` directory is
 * product art, not a test dependency or a permanent home for sample packs.
 *
 * Keep this raw (rather than asserting `satisfies PackManifest`) so the real
 * manifest validator remains the authority for its shape.
 */

export const FULL_PACK_NAME = 'test-pack-fixture';

export const fullPackQualified = (local: string): string => `${FULL_PACK_NAME}/${local}`;

export function fullPackFixture(): unknown {
  return {
    format: 1,
    name: FULL_PACK_NAME,
    version: '1.0.0',
    author: 'Danmaku tests',
    license: 'CC0-1.0',
    description: 'In-memory fixture exercising every implemented pack surface.',
    assets: {
      bullets: 'bullets.png',
      ship: 'ship.png',
      filter: 'nearest',
    },
    sounds: {
      shot: 'shot.wav',
      pickup: 'pickup.wav',
    },
    music: {
      pulse: {
        file: 'pulse.wav',
        loopStart: 0.5,
        loopEnd: 2,
        volume: 0.5,
      },
    },
    hud: {
      life: 'life.png',
      bomb: 'bomb.png',
    },
    portraits: {
      keeper: 'portrait.png',
    },
    requires: [
      'content.enemies',
      'content.stages',
      'content.bosses',
      'content.shots',
      'content.characters',
      'content.options',
      'content.bombs',
      'content.effects',
      'content.items',
    ],
    content: {
      enemies: {
        emitter: {
          sprite: 'star',
          hp: 3,
          radius: 10,
          motion: { r: 0 },
          patterns: [
            {
              pattern: 'aimed-fan',
              options: {
                spec: {
                  style: { sprite: 'orb.small', r: 1, g: 0.65, b: 0.3 },
                  radius: 3,
                  motion: { r: 2.2, theta: 90 },
                },
                count: 3,
                spread: 28,
                period: 55,
              },
              difficulty: {
                easy: { count: 2, spread: 22, period: 60 },
                hard: { count: 4, spread: 34, period: 48 },
                lunatic: { count: 6, spread: 42, period: 40 },
              },
            },
          ],
          spoils: [['token', 1]],
          onDeath: 'spark',
        },
        drone: {
          sprite: 'shard',
          hp: 2,
          radius: 8,
          motion: { r: 0 },
        },
      },
      effects: {
        spark: {
          sprite: 'mote',
          count: 8,
          speed: { min: 1, max: 2 },
          life: { min: 18, max: 24 },
          drag: 0.9,
          scale: { from: 0.8, to: 0.1 },
          alpha: { from: 1, to: 0 },
          additive: true,
        },
      },
      items: {
        token: {
          sprite: 'orb.large',
          radius: 15,
          value: 2000,
          kind: 'score',
          magnetSpeed: 7,
        },
      },
      shots: {
        lance: {
          description: 'Fast fixture shot.',
          levels: [
            {
              spec: {
                style: {
                  sprite: 'kunai',
                  r: 1,
                  g: 0.7,
                  b: 0.35,
                  orientToHeading: true,
                },
                radius: 4,
                motion: { r: 12, theta: 270 },
                damage: 4,
              },
              offsets: [{ x: 0, y: -12, angle: 270 }],
              period: 3,
            },
          ],
        },
      },
      options: {
        orbit: {
          sprite: 'orb.medium',
          shot: {
            style: { sprite: 'orb.small', r: 1, g: 0.65, b: 0.3 },
            radius: 3,
            motion: { r: 10, theta: 270 },
            damage: 1,
          },
          period: 6,
          followSpeed: 1.6,
          levels: [
            [{ x: 0, y: -20, focusX: 0, focusY: -26, angle: 270 }],
          ],
        },
      },
      bombs: {
        flare: {
          duration: 60,
          invulnTicks: 120,
          damagePerTick: 2,
          convertBullets: true,
          effect: 'spark',
        },
      },
      characters: {
        voyager: {
          label: 'VOYAGER',
          sprite: 'ship',
          blurb: 'Pack identity fixture.',
          shot: 'lance',
          options: 'orbit',
          bomb: 'flare',
          player: {
            x: 240,
            y: 568,
            speed: 3.4,
            focusSpeed: 1.5,
            radius: 2.5,
            grazeRadius: 20,
            lives: 3,
            bombs: 3,
            invulnTicks: 90,
          },
        },
      },
      stages: {
        trial: {
          entry: true,
          seed: 7,
          background: 'expanse',
          music: 'pulse',
          outro: 30,
          next: 'finale',
          waves: [
            { at: 0, enemy: 'drone', x: 160, y: 100 },
            { at: 30, enemy: 'emitter', x: 320, y: 120 },
          ],
        },
        finale: {
          seed: 11,
          background: 'undertow',
          outro: 30,
          next: null,
          boss: 'keeper',
          waves: [
            { at: 0, enemy: 'emitter', x: 240, y: 100 },
          ],
        },
      },
      bosses: {
        keeper: {
          sprite: 'ring',
          radius: 18,
          width: 52,
          height: 52,
          entry: { x: 240, y: 140, ticks: 30 },
          onDeath: 'death.big',
          spoils: [['token', 2]],
          dialogue: [
            { speaker: 'keeper', text: 'The fixture path is closed.' },
            { speaker: 'player', text: 'Then the validator opens it.' },
          ],
          phases: [
            {
              name: 'Opening',
              hpSeconds: 2,
              isSpell: false,
              patterns: [
                {
                  pattern: 'aimed-fan',
                  options: {
                    spec: {
                      style: { sprite: 'scale', orientToHeading: true },
                      radius: 4,
                      motion: { r: 2.2, theta: 90 },
                    },
                    count: 3,
                    spread: 30,
                    period: 48,
                  },
                },
              ],
            },
            {
              name: 'Fixture Sign',
              hpSeconds: 2,
              isSpell: true,
              bonus: 1000,
              background: 'drift',
              patterns: [
                {
                  pattern: 'ring',
                  options: {
                    spec: {
                      style: { sprite: 'petal' },
                      radius: 4,
                      motion: { r: 3, theta: 90 },
                    },
                    count: 12,
                    period: 45,
                  },
                },
              ],
            },
            {
              name: 'Lunatic Fixture',
              hpSeconds: 2,
              isSpell: true,
              difficulties: ['lunatic'],
              bonus: 2000,
              background: 'drift',
              patterns: [
                {
                  pattern: 'ring',
                  options: {
                    spec: {
                      style: { sprite: 'petal' },
                      radius: 4,
                      motion: { r: 3, theta: 90 },
                    },
                    count: 18,
                    period: 36,
                  },
                },
              ],
            },
          ],
        },
      },
    },
  };
}
