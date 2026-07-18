# Danmaku / 1bit STG

一个以 `1bit-stg-complete-asset-kit-v4/` 为唯一内容权威的确定性 1-bit
STG。项目记录行为、材料、缺席、余波与交接，不引入分数、排名、胜负或道德评价。

## 当前可玩边界

- 默认 `/` 只接 `quiet_awakening → common.eye_acquisition`；当前 gaze/Flower 交接门仍
  not-ready，因此 session 保持在 First Eye，不进入完整房间链。Boss 循环与跨 Run 持久化
  仍在制作中。
- `/?mode=pattern-lab` 是显式 QA/开发控制面，不代表生产 Run 已接入全部 pattern。
- V4 素材包保持只读；应用 adapter 不能反向改写 canonical authority。

实时完成度、风险与下一阶段只在
[制作路线图](stg-dev/docs/ROADMAP_ZH.md)维护。

## 仓库地图

- `1bit-stg-complete-asset-kit-v4/`：canonical manifests、reference runtime、QA oracle 与素材。
- `stg-dev/`：Bun/Vite/TypeScript/Three.js 应用、authority、表现与测试。
- `.agents/skills/aaajiao/`：本项目内容与审美约束。

## 开发文档

- [游戏设计基线](stg-dev/docs/GAME_DESIGN_ZH.md)：玩家体验、Run 规则、材料语义与负空间。
- [技术架构基线](stg-dev/docs/ARCHITECTURE_ZH.md)：authority、时钟、事件、生命周期与模块边界。
- [制作路线图](stg-dev/docs/ROADMAP_ZH.md)：唯一的状态、优先级、风险与完成定义。
- [测试与验收](stg-dev/docs/TESTING_ZH.md)：分层测试策略、命令、发布门禁与设备矩阵。
- [内容扩展治理](stg-dev/docs/CONTENT_EXTENSION_ZH.md)：V4 外扩展的审批与 provenance。
- [应用开发说明](stg-dev/README_ZH.md)：启动、输入、目录和本地工作方式。

## 启动

```sh
cd stg-dev
bun install --frozen-lockfile
bun run dev
```

- `http://127.0.0.1:5173/`：canonical RUN 序章。
- `http://127.0.0.1:5173/?mode=pattern-lab`：Pattern Lab。

仓库固定使用 Bun `1.3.14` 和唯一的 `stg-dev/bun.lock`。

## 验证

日常开发先运行与改动直接相关的 focused tests、strict typecheck 和 whitespace check；
内容、构建、PWA 或可见路径再增加对应门禁。完整 `test:all` 只在跨模块里程碑、
Alpha/发布候选或显式要求时运行一次：

```sh
git diff --check
cd stg-dev
bun run typecheck
bun run test -- <test-file> -t "<case or describe>"
```

GitHub push/PR 自动 CI 在 FOUNDATION 阶段暂停，手动 workflow 仍保留；本地提交前验证
不因此减免。测试选择与恢复自动 CI 的条件见[测试与验收](stg-dev/docs/TESTING_ZH.md)。

## Authority 边界

玩法时间只使用整数 `tick120`；表现、音频、触觉、UI、天气和可访问性都是只读投影。
任何 V4 外内容或设计变化必须先读取项目 skill，并通过内容扩展治理。实现状态不得从
README 推断，以制作路线图和可执行测试为准。
