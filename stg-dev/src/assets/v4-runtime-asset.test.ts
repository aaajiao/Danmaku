import {describe, expect, it} from "vitest";
import {assertV4SchemaVersion, bindV4RuntimeAssets} from "./v4-runtime-asset";

interface Entry {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const entryA: Entry = {id: "one", path: "audio/assets/sfx/one.wav", sha256: SHA_A};
const entryB: Entry = {id: "two", path: "audio/assets/sfx/two.wav", sha256: SHA_B};

function bind(
  entries: readonly Entry[],
  urls: Readonly<Record<string, string>>,
): ReturnType<typeof bindV4RuntimeAssets<Entry>> {
  return bindV4RuntimeAssets<Entry>({
    catalog: "test catalog",
    entries,
    urlsBySourcePath: urls,
    keyOf: (entry) => entry.id,
    idOf: (entry) => entry.id,
    sourcePathOf: (entry) => entry.path,
    sha256Of: (entry) => entry.sha256,
  });
}

describe("bindV4RuntimeAssets", () => {
  it("binds a closed manifest/URL set", () => {
    const bound = bind([entryA, entryB], {
      [entryA.path]: "/@fs/one.wav",
      [entryB.path]: "/@fs/two.wav",
    });
    expect(Object.keys(bound)).toEqual(["one", "two"]);
    expect(bound.one).toEqual({
      id: "one",
      sourcePath: entryA.path,
      sha256: SHA_A,
      url: "/@fs/one.wav",
      size: null,
    });
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(bound.one)).toBe(true);
  });

  it("fails closed when a manifest entry has no browser URL", () => {
    expect(() => bind([entryA, entryB], {[entryA.path]: "/@fs/one.wav"}))
      .toThrow(/no browser URL for audio\/assets\/sfx\/two\.wav/u);
  });

  it("fails closed when a browser URL has no manifest entry", () => {
    expect(() => bind([entryA], {
      [entryA.path]: "/@fs/one.wav",
      [entryB.path]: "/@fs/two.wav",
    })).toThrow(/unbound browser URL for audio\/assets\/sfx\/two\.wav/u);
  });

  it("rejects a drifted SHA-256", () => {
    expect(() => bind([{...entryA, sha256: "nope"}], {[entryA.path]: "/@fs/one.wav"}))
      .toThrow(/invalid SHA-256 for one/u);
  });

  it("rejects duplicate keys, ids and paths", () => {
    expect(() => bind([entryA, entryA], {[entryA.path]: "/@fs/one.wav"}))
      .toThrow(/duplicate runtime key one/u);
    expect(() => bind([entryA, {...entryA, id: "two"}], {[entryA.path]: "/@fs/one.wav"}))
      .toThrow(/duplicate source path/u);
  });

  it("rejects escaping or absolute source paths", () => {
    for (const path of ["/audio/one.wav", "../outside/one.wav", " audio/one.wav"]) {
      expect(() => bind([{...entryA, path}], {[path]: "/@fs/one.wav"}))
        .toThrow(/invalid source path/u);
    }
  });

  it("rejects an empty or blank identity", () => {
    expect(() => bind([{...entryA, id: ""}], {[entryA.path]: "/@fs/one.wav"}))
      .toThrow(/invalid runtime identity/u);
  });

  it("rejects a non-integer size", () => {
    expect(() => bindV4RuntimeAssets<Entry>({
      catalog: "test catalog",
      entries: [entryA],
      urlsBySourcePath: {[entryA.path]: "/@fs/one.wav"},
      keyOf: (entry) => entry.id,
      idOf: (entry) => entry.id,
      sourcePathOf: (entry) => entry.path,
      sha256Of: (entry) => entry.sha256,
      sizeOf: () => [512.5, 512],
    })).toThrow(/invalid size for one/u);
  });
});

describe("assertV4SchemaVersion", () => {
  it("passes on an exact match and fails closed otherwise", () => {
    expect(() => assertV4SchemaVersion("catalog", "4.0.0", "4.0.0")).not.toThrow();
    expect(() => assertV4SchemaVersion("catalog", "4.0.1", "4.0.0"))
      .toThrow(/catalog schema drifted: expected 4\.0\.0, received 4\.0\.1/u);
  });
});
