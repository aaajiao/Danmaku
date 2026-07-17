# 1bit STG 测试与验收基线

状态：`FOUNDATION / GATES IN PROGRESS`

原则：测试权威事实，不用截图替代玩法证明；视觉 QA 也不能反向决定碰撞。

## 1. 当前可执行命令

CI 从仓库根目录运行；`bun.lock` 必须已提交且不能在安装阶段漂移：

```sh
cd stg-dev
bun install --frozen-lockfile
bun run typecheck
bun run test:unit
bun run build
bun run test:all
```

本地首次安装使用 `bun install`。Playwright 浏览器安装与分层运行命令是：

```sh
cd stg-dev
bun install
bunx --bun playwright install chromium
bunx --bun playwright test
bun run test:smoke
bun run test:e2e
```

`playwright.config.ts` 默认先做 production build，再在 `127.0.0.1:4173` 启动不会被复用的 Vite preview。并行任务用 `STG_E2E_PORT`；针对已启动 preview/部署地址用 `STG_E2E_BASE_URL`。失败产物在 `test-results/playwright/` 和 `playwright-report/`。

V4 自身的四组契约验证必须从仓库根目录执行：

```sh
python3 -B 1bit-stg-complete-asset-kit-v4/tools/qa/validate_v4_integration.py
python3 -B 1bit-stg-complete-asset-kit-v4/runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B 1bit-stg-complete-asset-kit-v4/gameplay/tools/validate_gameplay_v4.py
python3 -B 1bit-stg-complete-asset-kit-v4/narrative/validate_narrative_v4.py
```

`test:e2e` 运行完整 Chromium 契约，`test:smoke` 运行最短默认 RUN 门禁；`test:all` 串行执行 typecheck、unit、build、smoke 与 E2E。CI 与文档只使用 Bun 1.3.14，不保留第二套包管理入口。

## 2. 分层测试矩阵

| 层 | 验证对象 | 现有证据 | 工业验收缺口 |
|---|---|---|---|
| Type/Build | strict TS、Vite/PWA 构建 | `typecheck`、`build` | 构建 metadata/content digest |
| Unit | dead zone、RNG、compiler、simulation、RunDirector | `src/game/*.test.ts` | 全 operator、pool、swept collision、dual-rate |
| Content contract | schema、ID、引用、hash、预算 | V4 自带 validator | 应用 content index 尚未建立 |
| Runtime contract | 72 canonical events、state ordering | V4 runtime validator | 应用 trace 尚未全量同构 |
| Oracle parity | 同 fixture 对 V4 reference runtime | 尚无 | 48 pattern × 3 difficulty × 12 operator |
| Integration | Run→snapshot→archive→restore | 局部 WIP | 16-state 与完整 material order |
| Browser E2E | RUN/LAB、clock、pause、PWA manifest | `e2e/**` 已有骨架 | CI/生产离线/更新事务 |
| Smoke | 默认 RUN 可启动、无 page error | `run-mode.smoke.spec.ts` | 发布包、弱网、缓存升级 |
| Visual | atlas、safe gap、warning、overlay parity | 人工 QA 截图 | 自动像素契约/实机矩阵 |
| Performance | tick budget、pool、GPU/内存 | 尚无基准 | 固定设备基线与回归阈值 |

## 3. Unit 与确定性契约

必须覆盖：

- 同 seed、初始状态与按 tick 输入得到完全相同 snapshot digest 与 event trace；
- 不同 render cadence（30/60/120/144Hz）不改变 gameplay trace；
- pause 期间 gameplay tick 不增长，恢复时不吸收 wall-clock；
- large delta 遍历所有 crossed boundary，且 1024 边界保护可诊断；
- 120Hz master 与 60Hz runtime due-time 长时间无漂移；
- 同 timestamp 严格遵循 collision-off → state/damage commit → collision-on → spawn → feedback；
- 同一 timestamp 多命中最多提交一个合法伤害；fatal/non-fatal 分支互斥；
- graze 唯一键含 instance/generation/player，最多一次；
- Override 证据不足拒绝，足够时只清除前方局部扇区，并写 typed scar；
- accessibility profile、音频/触觉失败和 devicePixelRatio 不影响核心。

当前 `simulation.test.ts` 已覆盖确定性 trace、部分伤害边界、graze/Override 和 pattern loop；这些是基础，不等于 projectile/runtime 全契约完成。

## 4. Content 与 oracle parity

P0 content test 应先建立一个 canonical content index，至少断言：

- 48 pattern 分类数量为 BOSS 24、COMMON 2、ROOM 16、TRANSITION 3、WEATHER_ECHO 3；
- 12 motion operator 均有可执行 fixture，不允许“未知 operator 静默忽略”；
- 8 Boss 各正好 3 phase，phase pattern 和 resolution event 均可解析；
- 8 laser geometry、4 room composer、72 event ID 全部可达且无孤儿引用；
- 7 atlas、448 frame、16 reaction overlay、48 WAV 的文件 hash/尺寸/引用有效；
- canonical room 只写 4 个新 ID；`INFO_OVERFLOW` 只允许 migration read；
- schema warning、runtime failure、feedback→gameplay edge、fixed projectile timeout 均为 0。

48 pattern oracle 不是“能生成有限数字”即可。每个 pattern × difficulty 至少比较：burst due-time、实体稳定 ID、spawn 数量/顺序、初速度、operator 状态转移、safe gap、warning boundary、impact/cancel/residue 事件和最终 trace hash。浮点比较只在 manifest 明确允许的数值域使用固定 epsilon；事件 ID/tick/order 必须精确相等。

## 5. E2E 与 Smoke

现有浏览器测试职责：

- 默认 `/`：面向玩家的 RUN，pattern 控件锁定，进入后 gameplay clock 前进；
- `/?mode=pattern-lab`：48 pattern 可选、首尾循环、难度切换、pattern 重置；
- Space pause：clock 精确冻结并恢复；
- PWA manifest：standalone、192/512 any、512 maskable，图标可访问；
- page error 必须为空。

P0/P1 还要增加：

- 固定 seed 的完整 Run 至 snapshot/archive，校验 route digest 与 end fact；
- reload 后 next-run restore 顺序及 input return tick；
- production `bun run preview` 的离线冷/热启动、未知 URL fallback；
- service worker N→N+1 更新在 Run 边界生效，禁止混合 digest；
- IndexedDB migration、quota、损坏记录隔离与导出；
- reducedMotion/flashOff/full 的 trace parity；
- 390px 移动视口无阻塞操作、focus 顺序和文本可读性。

Smoke 必须保持短：启动、进入、clock 前进、无未捕获错误、关键资产/manifest 200。完整 Run、离线升级和视觉回归不塞进 smoke。

## 6. 性能门禁

性能阈值在固定硬件/浏览器/场景上记录，不能用开发者主观“感觉流畅”替代。P1 建立以下基线：

- 120Hz 核心单 tick 的 P95 小于 8.33ms，且不得靠跳过 gameplay tick 达标；推荐工程目标 P95 ≤ 4ms，为渲染和系统抖动留余量；
- 每个 room tier 不超过 manifest 的 `maxProjectiles` / `maxEmitters`；越界是 contract failure；
- projectile/shot/sprite 使用有上限的 pool，10 分钟 soak 后 heap 和 GPU resource 不持续增长；
- Desktop Chrome 目标稳定 60fps presentation；中端移动设备允许降 presentation 质量/帧率，但权威 trace 不变；
- atlas/material/texture 数量、draw calls、JS heap、GC pause 和 shader compile stall 写入 benchmark artifact；
- Worker 迁移只能在 profile 证明主线程瓶颈后进入 P2，不能预先增加并发复杂度。

建议固定场景：最高 manifest projectile budget、三段 Boss laser、room transition、snapshot/ghost replay，以及 10 分钟 mixed Run soak。

## 7. 实机游戏手柄验收矩阵

浏览器自动化无法代替实机 Gamepad API 验收。每个发布候选至少记录：OS/版本、浏览器/版本、连接方式、手柄固件、mapping 字符串、结果和已知降级。

| 设备族 | 连接 | 平台最低覆盖 | 必测 |
|---|---|---|---|
| Xbox Wireless / XInput | USB、Bluetooth | Windows Chrome、macOS Chrome | standard mapping、摇杆/D-pad、A/B、LB/RB、Start、热插拔 |
| DualShock 4 / DualSense | USB、Bluetooth | macOS Chrome、Windows Chrome | Cross/Circle 映射、dead zone、断线回退、可选振动 |
| Switch Pro | USB、Bluetooth | macOS/Windows Chrome | mapping 差异识别，不猜测标签；必要时 remap |
| 通用标准手柄 | USB | Chrome | 无品牌 ID、轴漂移、按钮 edge、无 haptics 降级 |
| Mobile controller | Bluetooth | Android Chrome；iOS Safari 记录能力 | PWA standalone、重连、系统手势冲突 |

每台设备执行：

1. 冷启动前已连接与运行中热插拔；
2. 0.18 区间内无漂移，满幅保持方向并 clamp；
3. 摇杆和 D-pad 同时输入时择强一致；
4. Override/Pause 每次实体按压只产生一个 edge；
5. Focus 可持续按住，Shoot 可持续输入；
6. 断开后键盘/指针仍可操作，重连不残留按键；
7. haptics 拒绝/不存在时无异常且 trace 不变；
8. Full/Reduced Motion/Flash-Off trace hash 相同。

## 8. 发布验收单

发布候选只有在以下证据均归档后可标记：

- typecheck、unit、build、4 个 V4 validator、E2E、smoke 全绿；
- 0 manifest warning、0 orphan ID、0 unknown operator；
- canonical trace parity 与 accessibility parity 全绿；
- 固定性能/soak artifact 无预算越界或泄漏；
- 实机手柄矩阵有记录，未覆盖项明确列为风险；
- PWA 在线/离线/升级/存档迁移通过；
- 每个 V4 外扩展均有通过的 Extension ADR 与 provenance；
- 版本、Git commit、content digest、extension digest 可从发布包诊断页读取。
