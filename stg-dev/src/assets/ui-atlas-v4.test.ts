import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {V4_UI_ATLAS, v4UiCell, v4UiCellOrNull} from "./ui-atlas-v4";

const KIT_ROOT = new URL("../../../1bit-stg-complete-asset-kit-v4/", import.meta.url);

interface LegacyUiFrame {
  readonly frame: {readonly x: number; readonly y: number; readonly w: number; readonly h: number};
  readonly sourceSize: {readonly w: number; readonly h: number};
  readonly pivot: {readonly x: number; readonly y: number};
  readonly category: string;
  readonly roomTintable: boolean;
  readonly alpha: string;
}

interface LegacyUiAtlas {
  readonly size: {readonly w: number; readonly h: number};
  readonly grid: {readonly columns: number; readonly rows: number; readonly cell: number};
  readonly sampling: string;
  readonly premultiplyAlpha: boolean;
  readonly frames: Readonly<Record<string, LegacyUiFrame>>;
}

async function authoredCellMap(): Promise<LegacyUiAtlas> {
  const text = await readFile(
    fileURLToPath(new URL("legacy-v3/manifests/ui-atlas.json", KIT_ROOT)),
    "utf8",
  );
  return JSON.parse(text) as LegacyUiAtlas;
}

describe("V4 UI atlas binding", () => {
  it("reproduces the authored cell map exactly, in order", async () => {
    const authored = await authoredCellMap();
    const authoredIds = Object.keys(authored.frames);
    expect(authoredIds).toHaveLength(64);
    expect(Object.keys(V4_UI_ATLAS.cells)).toEqual(authoredIds);
    expect(V4_UI_ATLAS.grid).toEqual(authored.grid);
    expect(V4_UI_ATLAS.sampling).toBe(authored.sampling);
    expect(V4_UI_ATLAS.premultiplyAlpha).toBe(authored.premultiplyAlpha);
    expect(V4_UI_ATLAS.atlas.size).toEqual([authored.size.w, authored.size.h]);

    authoredIds.forEach((id, index) => {
      const authoredCell = authored.frames[id]!;
      const cell = v4UiCell(id);
      expect(cell.index).toBe(index);
      expect(cell.rect).toEqual([
        authoredCell.frame.x,
        authoredCell.frame.y,
        authoredCell.frame.w,
        authoredCell.frame.h,
      ]);
      expect(cell.pivot).toEqual([authoredCell.pivot.x, authoredCell.pivot.y]);
      expect(cell.category).toBe(authoredCell.category);
      expect(cell.roomTintable).toBe(authoredCell.roomTintable);
      expect(cell.alphaMode).toBe(authoredCell.alpha);
      expect(Object.isFrozen(cell)).toBe(true);
    });
  });

  it("binds the live V4 PNG, whose real header matches the declared 512x512 grid", async () => {
    expect(V4_UI_ATLAS.atlas.sourcePath).toBe("ui/atlas/ui-atlas.png");
    expect(V4_UI_ATLAS.atlas.url).toContain("ui-atlas.png");
    expect(V4_UI_ATLAS.atlas.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const png = await readFile(fileURLToPath(new URL("ui/atlas/ui-atlas.png", KIT_ROOT)));
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    expect(V4_UI_ATLAS.grid.columns * V4_UI_ATLAS.grid.cell).toBe(512);
    expect(V4_UI_ATLAS.grid.rows * V4_UI_ATLAS.grid.cell).toBe(512);
  });

  it("fails closed on an unknown cell", () => {
    expect(() => v4UiCell("ring_reticle")).toThrow(/no cell ring_reticle/u);
    expect(v4UiCellOrNull("ring_reticle")).toBeNull();
    expect(v4UiCellOrNull("cursor")?.category).toBe("navigation");
  });

  it("binds no QA or mockup material", () => {
    expect(V4_UI_ATLAS.atlas.sourcePath).not.toMatch(/mockup|preview|report|source/u);
  });
});
