/**
 * Replay recording and playback.
 *
 * A replay is a seed plus a frame-indexed log of the input mask. It is never a
 * log of state — that is the whole point. Storing state would make replays
 * large and would hide divergence instead of exposing it.
 *
 * This works only because of the hard rules in CLAUDE.md: the tick is fixed at
 * 60Hz and no delta-time reaches the sim (rule 1), simulation randomness comes
 * from one seeded stream whose call *order* is part of the contract (rule 2),
 * and input is sampled once per tick as digital bits (rule 4). Given those,
 * same seed + same masks + same integer stepping ⇒ identical outcome.
 *
 * Which is why this module is the strongest regression oracle the project has.
 * A recorded run that no longer reproduces means something moved the
 * simulation: either a bug, or a divergence someone owes an explanation for.
 */

export const REPLAY_VERSION = 1;

/** One change in the button mask, at the tick it took effect. */
export interface ReplayInput {
  tick: number;
  buttons: number;
}

export interface Replay {
  version: number;
  seed: number;
  /** Ticks the run lasted. */
  length: number;
  /**
   * Sparse: one entry per CHANGE in the button mask, not per tick. The mask
   * holds until the next entry, and is 0 before the first. A run where the
   * player holds a direction for two seconds costs one entry, not 120.
   */
  inputs: readonly ReplayInput[];
  meta?: Record<string, string | number>;
}

export class ReplayRecorder {
  readonly #seed: number;
  readonly #inputs: ReplayInput[] = [];

  /**
   * The mask currently in force. Starts at 0 — the state before any input —
   * so a run that begins with no buttons held records nothing at tick 0.
   */
  #previous = 0;
  #lastTick = -1;

  constructor(seed: number) {
    this.#seed = seed;
  }

  /** Call once per tick with the sampled mask. */
  record(tick: number, buttons: number): void {
    if (!Number.isInteger(tick) || tick < 0) {
      throw new Error(`replay: tick must be a non-negative integer, got ${tick}`);
    }
    if (tick <= this.#lastTick) {
      throw new Error(
        `replay: tick ${tick} recorded after tick ${this.#lastTick} — ticks must increase`,
      );
    }
    this.#lastTick = tick;
    if (buttons === this.#previous) return;
    this.#inputs.push({ tick, buttons });
    this.#previous = buttons;
  }

  finish(length: number, meta?: Record<string, string | number>): Replay {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`replay: length must be a non-negative integer, got ${length}`);
    }
    if (length <= this.#lastTick) {
      throw new Error(
        `replay: length ${length} would drop input recorded at tick ${this.#lastTick}`,
      );
    }
    // Copy: the recorder may keep recording, and a returned replay that
    // mutates behind the caller's back is the opposite of an oracle.
    return {
      version: REPLAY_VERSION,
      seed: this.#seed,
      length,
      inputs: this.#inputs.map((entry) => ({ ...entry })),
      ...(meta === undefined ? {} : { meta: { ...meta } }),
    };
  }
}

export class ReplayPlayback {
  readonly #replay: Replay;

  /** Index of the entry in force, or -1 while before the first one. */
  #cursor = -1;

  /** Highest tick asked for. Drives `finished`. */
  #reached = -1;

  constructor(replay: Replay) {
    // Playing a replay of the wrong version would not fail, it would quietly
    // produce a different run — the one failure mode worth being loud about.
    if (replay.version !== REPLAY_VERSION) {
      throw new Error(
        `replay: version ${replay.version} is not supported (expected ${REPLAY_VERSION})`,
      );
    }
    this.#replay = replay;
  }

  /** The mask that was live at this tick. */
  buttonsAt(tick: number): number {
    if (tick > this.#reached) this.#reached = tick;

    const entries = this.#replay.inputs;
    const current = this.#cursor >= 0 ? entries[this.#cursor] : undefined;

    if (current !== undefined && current.tick > tick) {
      // Random access backwards. Binary search rather than rewinding to the
      // start, so seeking is not quadratic when a tool scrubs a timeline.
      this.#cursor = this.#seek(tick);
    } else {
      // Forward: playback walks tick by tick, so this advances zero or one
      // step almost every call and never revisits an entry.
      while (this.#cursor + 1 < entries.length) {
        const next = entries[this.#cursor + 1];
        if (next === undefined || next.tick > tick) break;
        this.#cursor++;
      }
    }

    const entry = this.#cursor >= 0 ? entries[this.#cursor] : undefined;
    return entry?.buttons ?? 0;
  }

  /** Index of the last entry at or before `tick`, or -1 if there is none. */
  #seek(tick: number): number {
    const entries = this.#replay.inputs;
    let lo = 0;
    let hi = entries.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = entries[mid];
      if (entry === undefined) break;
      if (entry.tick <= tick) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  get length(): number {
    return this.#replay.length;
  }

  /**
   * True once the last tick of the run has been handed out, so the driving
   * loop is `for (let t = 0; !playback.finished; t++)`. A zero-length replay
   * is finished before it starts.
   */
  get finished(): boolean {
    return this.#reached >= this.#replay.length - 1;
  }
}

export function serialize(replay: Replay): string {
  return JSON.stringify(replay);
}

/**
 * Parse and fully validate. A replay that silently plays back wrong is worse
 * than one that refuses, so every field is checked rather than trusted — these
 * files are written by tools, edited by hand, and outlive the code that made
 * them.
 */
export function deserialize(text: string): Replay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`replay: not valid JSON (${(error as Error).message})`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('replay: expected a JSON object');
  }
  const raw = parsed as Record<string, unknown>;

  if (raw['version'] !== REPLAY_VERSION) {
    throw new Error(
      `replay: version ${JSON.stringify(raw['version'])} is not supported (expected ${REPLAY_VERSION})`,
    );
  }

  const seed = raw['seed'];
  if (!Number.isInteger(seed)) {
    throw new Error(`replay: seed must be an integer, got ${JSON.stringify(seed)}`);
  }

  const length = raw['length'];
  if (!Number.isInteger(length) || (length as number) < 0) {
    throw new Error(
      `replay: length must be a non-negative integer, got ${JSON.stringify(length)}`,
    );
  }

  const rawInputs = raw['inputs'];
  if (!Array.isArray(rawInputs)) {
    throw new Error('replay: inputs must be an array');
  }

  const inputs: ReplayInput[] = [];
  let previousTick = -1;
  for (let i = 0; i < rawInputs.length; i++) {
    const entry = rawInputs[i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`replay: inputs[${i}] must be an object`);
    }
    const { tick, buttons } = entry as Record<string, unknown>;
    if (!Number.isInteger(tick) || (tick as number) < 0) {
      throw new Error(
        `replay: inputs[${i}].tick must be a non-negative integer, got ${JSON.stringify(tick)}`,
      );
    }
    if (!Number.isInteger(buttons) || (buttons as number) < 0) {
      throw new Error(
        `replay: inputs[${i}].buttons must be a non-negative integer, got ${JSON.stringify(buttons)}`,
      );
    }
    // Out-of-order entries would make `buttonsAt` return whichever one the
    // cursor happened to land on, which is a wrong run, not an error.
    if ((tick as number) <= previousTick) {
      throw new Error(
        `replay: inputs[${i}].tick ${tick} does not follow ${previousTick} — ticks must increase`,
      );
    }
    if ((tick as number) >= (length as number)) {
      throw new Error(
        `replay: inputs[${i}].tick ${tick} is past the run length ${length}`,
      );
    }
    previousTick = tick as number;
    inputs.push({ tick: tick as number, buttons: buttons as number });
  }

  const replay: Replay = {
    version: REPLAY_VERSION,
    seed: seed as number,
    length: length as number,
    inputs,
  };

  const rawMeta = raw['meta'];
  if (rawMeta !== undefined) {
    if (typeof rawMeta !== 'object' || rawMeta === null || Array.isArray(rawMeta)) {
      throw new Error('replay: meta must be an object');
    }
    const meta: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(rawMeta as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new Error(
          `replay: meta.${key} must be a string or number, got ${JSON.stringify(value)}`,
        );
      }
      meta[key] = value;
    }
    replay.meta = meta;
  }

  return replay;
}
