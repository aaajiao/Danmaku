# Danmaku / 1bit STG

这个仓库包含两部分：

- `1bit-stg-complete-asset-kit-v4/`：V4 权威资源、玩法 manifests、TypeScript runtime、叙事、音频、UI 与严格验证工具；
- `stg-dev/`：直接消费 V4 数据的 Three.js + TypeScript 可玩 STG 开发环境，支持键盘、触控、标准映射游戏手柄与 PWA 离线运行。

## 运行开发环境

```sh
cd stg-dev
bun install
bun run dev
```

## 验证

```sh
cd stg-dev
bun run test:all

cd ../1bit-stg-complete-asset-kit-v4
python3 -B tools/qa/validate_v4_integration.py
python3 -B runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B gameplay/tools/validate_gameplay_v4.py
python3 -B narrative/validate_narrative_v4.py
```

更完整的工程说明与手柄映射见 [`stg-dev/README_ZH.md`](stg-dev/README_ZH.md)。
