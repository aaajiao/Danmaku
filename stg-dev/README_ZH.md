# 1bit STG 应用开发说明

`stg-dev/` 是 `../1bit-stg-complete-asset-kit-v4/` 的生产应用层。Three.js 只负责表现；
玩法 authority 保持 renderer-independent，素材包本身不因应用测试而修改。

项目当前完成度与缺口只在[制作路线图](docs/ROADMAP_ZH.md)维护。

## 技术基线

- Bun `1.3.14`：唯一的 package manager 与脚本 runtime
- TypeScript `7.0.2`（strict）
- Vite `8.1.5` / Three.js `0.185.1`
- Vitest `4.1.10` / Playwright `1.61.1`
- vite-plugin-pwa `1.3.0`

依赖由唯一的 `bun.lock` 精确锁定。不要引入 npm、npx、pnpm、Yarn 或第二份 lockfile。

## 启动

```sh
cd stg-dev
bun install --frozen-lockfile
bun run dev
```

- `http://127.0.0.1:5173/`：canonical RUN（觉醒 → First Eye → 固定首房切片）。
- `http://127.0.0.1:5173/?mode=pattern-lab`：显式开发/QA 控制面。
- `?seed=4088`：十进制 uint32 raw Run seed。Run authority 以显式 domain 和 EXT-005 salt policy
  分别解析 First Eye 与固定首房 occurrence seed；非法值 fail closed。
- `?profile=reduced-motion` / `?profile=flash-off`：只读表现配置。

检查 production PWA 构建：

```sh
bun run build
bun run preview
```

只有显式升级依赖并准备审查 lockfile diff 时，才允许不带
`--frozen-lockfile` 的安装。

## 输入

| 行为 | 键盘 | 标准映射游戏手柄 |
|---|---|---|
| 移动 | WASD / 方向键 | 左摇杆 / 十字键 |
| 表达 / 射击 | Z | A / Cross（button 0） |
| 局部 Override | X | B / Circle（button 1） |
| Focus | Shift | LB / RB（button 4 / 5） |
| 凝视意图（按住） | G | Y / Triangle（button 3） |
| 暂停 | Space | Start / Options（button 9） |

手柄由浏览器原生 Gamepad API 读取；触觉反馈是可选投影，不影响 gameplay trace。
实机支持范围只能由已记录的设备矩阵证明。触屏支持在画面内单指按住/拖动，移动与 signal
由同一次 pointer 输入投影，不产生双份 gameplay fact；First Eye 中双指按住产生独立 gaze intent，
不会改写 Focus，首个仍接触的 pointer 继续拥有移动目标。

## 目录职责

- `src/authority/`：确定性玩法 authority 与只读 snapshots/ports。
- `src/assets/`：只读 V4 浏览器素材 registry；共享层拥有物理 URL，章节层只选择 canonical ID。
- `src/game/`：应用装配与表现集成，不反写 authority。
- `src/content/`：V4 内容入口与 fail-fast validation。
- `e2e/`：production-preview Playwright runbook 与 specs。
- `docs/`：GDD、技术架构、制作路线图、QA 与 ADR。
- `public/`：应用身份图标；`artwork/`：已记录 provenance 的应用源文件。游戏素材继续唯一来自仓库根目录的 V4 包。

## 验证方式

小切片默认只跑聚焦测试、strict typecheck 与 whitespace check；按影响面增加
content/build/Playwright。不要在每个 commit 后重复完整门禁。

```sh
bun run typecheck
bun run test -- <test-file> -t "<case or describe>"
```

内容、构建或 PWA 集成：

```sh
bun run content:check
bun run build
```

用户可见路径运行相关 production-preview spec。首次安装 Chromium：

```sh
bun --bun playwright install chromium
```

`bun run test:all` 只用于跨模块里程碑、Alpha/发布候选或显式要求。
GitHub 自动 CI 当前暂停，手动 workflow 保留；本地验证仍是提交前门禁。完整选择矩阵见
[测试与验收](docs/TESTING_ZH.md)，浏览器操作见 [E2E runbook](e2e/README.md)。

## Authority 边界

- 整数 `tick120` 是唯一玩法时间；V4 60Hz machine 只在偶数 master tick 到期。
- canonical event、projectile、laser、player、Boss、narrative 与 cross-run authority 只从
  V4 契约和显式 application adapter 得到权限。
- Pattern Lab 的可见性、renderer frame、音频、alpha、weather 或 accessibility profile
  都不能证明或改写生产玩法状态。
- 项目不增加 score、rank、victory 或 morality。V4 外扩展必须通过
  [内容扩展治理](docs/CONTENT_EXTENSION_ZH.md)和 focused ADR。

更多稳定技术边界见[技术架构基线](docs/ARCHITECTURE_ZH.md)；当前实现范围与下一步只见
[制作路线图](docs/ROADMAP_ZH.md)。
