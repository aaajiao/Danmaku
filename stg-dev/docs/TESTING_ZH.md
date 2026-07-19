# 1bit STG 测试与验收基线

状态：`FOUNDATION / GATES IN PROGRESS`

本文只拥有 QA 策略、测试选择、命令和发布门禁。精确 seed、event count、trace hash 与
期望值属于可执行 fixture、V4 report 或不可变 CI artifact，不在叙述文档重复保存。

原则：测试 gameplay authority，不用截图或表现状态替代碰撞、排序、确定性和生命周期证明。

## 1. 当前运行模式

GitHub push/PR 自动 CI 在 `FOUNDATION` 阶段暂停，`.github/workflows/ci.yml` 只保留
手动入口。本地提交前验证不因此减免。P0 权威闭环完成、进入 Alpha 候选且完整门禁稳定后，
恢复自动 CI。

所有 JavaScript/TypeScript 命令从 `stg-dev/` 运行，固定 Bun `1.3.14` 和唯一 lockfile：

```sh
bun install --frozen-lockfile
bun run content:check
bun run typecheck
bun run test:unit
bun run build
bun run test:smoke
bun run test:e2e
bun run test:all
```

首次安装 Playwright Chromium：

```sh
bun --bun playwright install chromium
```

`test:all` 串行运行 typecheck、全部 Vitest、production build、smoke 与 Chromium E2E；
它不包含下面四个 V4 Python validators。

## 2. 风险分层与命令选择

默认反馈环是 focused tests + strict typecheck + whitespace check。完整门禁是里程碑证据，
不是每个小 commit 的固定动作。

| 改动类型 | 必跑 | 何时扩大 |
|---|---|---|
| 纯文档 | `git diff --check`；链接、命令、日期/状态归属检查 | 文档同时改 generated content、manifest、可执行示例或发布 artifact 时按对应类型扩大 |
| 单 pattern / leaf authority | focused contract/lifecycle/determinism/hostile/profile cases；`typecheck`；`git diff --check` | public contract 变化时增加直接 consumer tests |
| shared clock/event/projectile/player/schema/session/persistence | 先 focused reproduction，再跑所有直接受影响 suites；`typecheck` | consumer 面无法可靠枚举时跑一次 `test:unit` |
| content/schema/bundle/PWA | focused tests、`content:check`、`typecheck`、`build` | 有用户路径时增加相关 Playwright spec |
| 用户可见路径 | 相关 unit/integration + production-preview Playwright spec | boot/关键可用性进 smoke；完整流程进 E2E |
| 里程碑/Alpha/发布候选/广泛重构 | targeted scopes 全绿后运行一次 `test:all`，并按需运行 V4 validators | 发布候选再加性能、soak、设备、离线升级与迁移 |

Focused Vitest 示例：

```sh
bun run test -- <test-file> -t "<case or describe>"
```

Focused Playwright 示例：

```sh
bun --bun playwright test <spec-file> --project=chromium
```

不要并发运行重型 suites：CPU/GPU/浏览器争用会制造虚假的 timeout 与性能证据。廉价且互不
争用的检查可以并行。

## 3. Gameplay authority 测试设计

新增或修改 authority 时，从以下责任中选择所有相关项，不按固定 case 数量凑测试：

1. exact V4 contract、版本、ID、引用、descriptor 与 hostile shape fail-closed；
2. seeded RNG 消费、entity/occurrence identity、cadence 与声明顺序；
3. integer `tick120` due-time、nonzero start、30/60/144Hz 与 retained-backlog parity；
4. 同 tick `collision-off → state/damage → collision-on → spawn → feedback` 顺序；
5. warning/collision swept geometry、safe gap、contact/graze/Override 的共同路径；
6. entity-owned arm/flight/cancel/residue/drain，包含晚 materialize、pool-full 和 failure atomicity；
7. full/reduced-motion/flash-off 与 presentation weather 的 gameplay trace parity；
8. intentional absence、inert hooks、not-ready handoff 和不拥有的 composer/session/renderer 边界。

截图只能证明视觉结果；不能证明 collision、ordering、RNG、lifecycle 或 handoff。

## 4. Oracle 与内容验证

V4 authority 优先级保持为 manifests → runtime/reference → `sim_core.py` → production adapter。
Python 30Hz、declared contract 与应用 120Hz 证据必须标明各自层级；不能把 deletion/intervention
count 冒充 production identity/lifecycle parity。

从仓库根目录运行不可变 V4 validators，并使用 `-B` 禁止 bytecode cache：

```sh
python3 -B 1bit-stg-complete-asset-kit-v4/tools/qa/validate_v4_integration.py
python3 -B 1bit-stg-complete-asset-kit-v4/runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B 1bit-stg-complete-asset-kit-v4/gameplay/tools/validate_gameplay_v4.py
python3 -B 1bit-stg-complete-asset-kit-v4/narrative/validate_narrative_v4.py
```

不要用只返回预期 hash 的 wrapper 代替 oracle 执行。V4 tree 不因应用测试失败而修改。

## 5. Smoke、E2E 与探索性检查

Smoke 只验证最短关键路径：production preview 可启动、默认 Run clock 前进、关键 manifest/asset
可用、无未捕获 page/console/request failure。不要把完整 Run、离线升级或长流程塞进 smoke。

E2E 负责用户可见的 production-preview 契约，包括：

- canonical boot、显式 seed fail-closed、输入 guard 与 pause；
- 相关 room/Boss/narrative 路径达到其真实 handoff 边界；
- PWA manifest、在线/离线启动与安全更新；
- 完整 Run 的 accessibility trace parity；
- persistence、reload、migration 与 corruption isolation。

Pattern Lab 是 QA 控制面，不能替代 production Run E2E。应用内浏览器/Chrome 适合探索性视觉、
交互和登录态检查；Playwright 才是可重复仓库证据。操作细节见
[E2E runbook](../e2e/README.md)。

## 6. 失败处理与证据

- 先用最窄命令复现，再修复并重跑同一 scope；focused 绿后才扩大范围。
- 区分断言失败、真实性能回归、环境争用与 timeout。只有测量证明预算不足时才提高 timeout。
- 禁止 skip、mute、弱化断言、替换 oracle 或把 flaky retry 当修复。
- 记录实际运行的命令、scope 与结果；没有运行的 gate 不得宣称通过。
- 旧 full-gate 结果只能在 source、fixtures、manifests、lockfile 与 build inputs 都未变化时复用，
  并明确标注为复用证据。
- 失败 trace、截图、视频与报告保持为临时 artifact，不提交到仓库；长期证据由不可变 CI/release
  artifact 或测试 fixture 承担。

## 7. 性能与 soak 门禁

性能只在固定硬件、浏览器版本、seed、场景和采样方法下比较：

- 120Hz authority tick 的硬上限是 8.33ms；工程目标 P95 ≤ 4ms，为表现和系统抖动留余量；
- 不得通过跳过 gameplay tick、减少 identity 或改变 trace 达标；
- projectile/emitter/residue/pool 的 concurrent、cumulative 与 residue-inclusive 口径必须先有
  V4/adapter policy，缺失时只记录 observation，不伪造 budget gate；
- 10 分钟 mixed Run soak 后 heap、GPU resource 与 pool allocation 不持续增长；
- Desktop Chrome presentation 目标 60fps；移动端可以降低表现质量，但 gameplay trace 不变；
- 记录 draw calls、texture/atlas、JS heap、GC pause、shader compile stall 与 long task。

Worker 或并发执行只能在 profile 证明瓶颈后进入路线图。

## 8. 实机输入与可访问性

浏览器 mock 不能证明硬件兼容。每个发布候选记录 OS/浏览器、连接方式、设备/固件、mapping、
结果和已知降级，最低覆盖 Xbox/XInput、DualShock/DualSense、Switch Pro、通用标准手柄与移动端
Bluetooth controller。

每台设备验证冷启动已连接、运行中热插拔、dead zone、摇杆/D-pad 合并、动作 edge、Focus/Shoot
持续输入、断线回退、重连清理和 haptics 缺席降级。Full/Reduced Motion/Flash-Off 的 gameplay
trace 必须相同。

## 9. Alpha / 发布验收

Alpha 候选至少需要：

- 完整 seeded Run 的 authority、browser 与 accessibility 闭环；
- 48/48 production pattern、live rooms、Boss/narrative 与 durable restore；
- `test:all`、四个 V4 validators、完整 Run E2E、基础性能/soak 全绿；
- 自动 GitHub CI 恢复，并对 push/PR 运行稳定；
- content/extension digest、commit 与版本可诊断。

发布候选另外要求离线冷暖启动、N→N+1 更新、存档迁移/损坏隔离、固定设备性能、实机矩阵、
回滚演练，以及 0 schema warning / unknown operator / orphan event / feedback→gameplay edge /
fixed projectile flight timeout / accessibility trace mismatch。每个 V4 外扩展都必须通过
[内容扩展治理](CONTENT_EXTENSION_ZH.md)，并有 accepted Extension ADR 与 provenance。
