# 1bit STG 工业化基础

基于 `../1bit-stg-complete-asset-kit-v4` 的 Three.js STG 开发环境。默认入口是由种子驱动的 RUN，`/?mode=pattern-lab` 是显式开发控制面。工程直接读取 V4 权威 manifests、图集、背景与声音，不修改素材包本身。

## 技术基线

- Bun `1.3.14`（package manager 与脚本 runtime）
- Three.js `0.185.1`
- Vite `8.1.5`
- TypeScript `7.0.2`（strict）
- Vitest `4.1.10`
- Playwright `1.61.1`
- vite-plugin-pwa `1.3.0`

这些版本在 2026-07-18 通过 package registry 核验并精确锁定。没有引入 React、Phaser 或额外输入框架：Three.js 只负责表现，浏览器原生 API 负责输入/音频/PWA，玩法 authority 保持 renderer-independent。主循环使用整数 120Hz master，V4 60Hz machine 只在偶数 master tick 到期；完整装配边界见 `docs/ARCHITECTURE_ZH.md`。

## 启动

```sh
cd stg-dev
bun install
bun run dev
```

- `http://127.0.0.1:5173/`：默认 RUN；
- `http://127.0.0.1:5173/?mode=pattern-lab`：48-pattern 开发试验台；
- `?seed=4088`：为 RUN 固定非负 32-bit 种子。

完整本地门禁：

```sh
bun run test:all
```

它依次运行 typecheck、Vitest、production build、RUN smoke 与完整 Chromium E2E。首次运行浏览器测试前执行 `bunx --bun playwright install chromium`。应用内浏览器用于交互式视觉检查；Playwright 保留为可重复的仓库/CI 契约，两者职责不同。

## 输入

| 行为 | 键盘 | 标准映射游戏手柄 |
|---|---|---|
| 移动 | WASD / 方向键 | 左摇杆 / 十字键 |
| 表达 / 射击 | Z | A / Cross（button 0） |
| 局部 Override | X | B / Circle（button 1） |
| Focus | Shift | LB / RB（button 4 / 5） |
| 暂停 | Space | Start / Options（button 9） |

手柄使用浏览器原生 Gamepad API，包含 0.18 径向死区、热插拔、断开回退、动作边沿锁存，以及平台允许时的双马达触觉反馈。移动端支持在游戏画面内按住拖动。

## 当前已落地

- 种子确定的 Run Director 基础：觉醒、First Eye、2–4 个房间、强制休息、最多 2 个 Boss、Dusk、Snapshot 与 cross-run handoff；
- 默认 RUN 锁定开发控制，Pattern Lab 可直接检查全部 48 个 V4 executable patterns；
- V4 Content Authority：13 个入口、版本/ID/引用、物理文件 universe、SHA-256 与 dev/build fail-fast；
- 120/60Hz clock、72-event ordered bus，以及 pattern/projectile/player/laser/encounter/Boss/narrative authority 单测切片；
- 默认应用中的 120Hz 玩家移动、射击、Focus、擦弹 evidence、局部 Override、伤害与复归仍是 playable adapter；
- Three.js 正交像素渲染、V4 房间背景/图集、房间声床与事件 SFX；
- 键盘、触控、标准映射游戏手柄和可选 rumble；
- 可安装 PWA、离线预缓存、自动更新、favicon、Apple Touch、any 与 maskable 图标；
- Vitest 确定性/边界测试、Playwright production smoke/E2E 与 GitHub Actions 门禁。

当前 NORMAL oracle 已精确覆盖 48/48 trace hash、96/96 safe-gap path、12 operators 与 13 geometries；player/projectile/laser/Boss/narrative authority 也已有独立契约测试。但除 clock 外，新 authority 尚未替换默认应用的旧 `GameSimulation`/trace，EASY/HARD 增量 pattern adapter、完整 Run、跨局持久化和性能门禁仍未完成。详细差距与顺序见 `docs/ROADMAP_ZH.md`。

## PWA 图标

AI 生成的来源母版保存在 `artwork/icon-source-imagegen.png`，严格量化后的四色母版为 `artwork/icon-master-1024.png`。运行时图标在 `public/icons/`，包含 favicon、Apple Touch、192、512、shortcut 与 maskable 版本。

## 权威边界

V4 manifest 是唯一内容入口；表现回调、音频、PWA、手柄振动与 UI 不得回写 gameplay authority。项目不引入 score、rank 或善恶结局，记录的是行为事实和材料余波。任何超出 V4 的设计/素材扩展必须先使用项目 `aaajiao` skill，并完成 `docs/CONTENT_EXTENSION_ZH.md` 中的 Extension ADR。

素材包的独立门禁：

```sh
python3 -B ../1bit-stg-complete-asset-kit-v4/tools/qa/validate_v4_integration.py
python3 -B ../1bit-stg-complete-asset-kit-v4/runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B ../1bit-stg-complete-asset-kit-v4/gameplay/tools/validate_gameplay_v4.py
python3 -B ../1bit-stg-complete-asset-kit-v4/narrative/validate_narrative_v4.py
```
