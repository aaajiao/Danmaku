# 1bit STG 技术架构基线

状态：`STABLE AUTHORITY CONTRACT`

本文只描述稳定技术契约、依赖方向与跨模块决策。当前覆盖率、优先级和施工缺口见
[制作路线图](ROADMAP_ZH.md)；验证方法见[测试与验收](TESTING_ZH.md)；独立设计决定与
provenance 见 [ADR 索引](adr/README.md)。

## 1. 权威来源与依赖方向

来源冲突时使用以下顺序：

1. `1bit-stg-complete-asset-kit-v4/manifests/**` canonical contracts；
2. `1bit-stg-complete-asset-kit-v4/runtime/**` reference machines/oracles；
3. `1bit-stg-complete-asset-kit-v4/gameplay/tools/sim_core.py` QA oracle；
4. `stg-dev/src/authority/**` production authority adapters；
5. `stg-dev/src/game/**` application/presentation integration。

依赖只允许向下游移动：

```text
V4 manifests / reference oracles
              ↓
        Content Authority
              ↓
 deterministic gameplay authorities
              ↓
     coordinator / Run session
              ↓
 read-only projections and adapters
              ↓
 renderer / audio / haptics / UI / PWA
```

Renderer、动画、音频、UI、weather、accessibility、PWA 和设备 API 不得向上游写 gameplay
authority。V4 素材包不因应用测试失败而修改。

## 2. 模块职责

| 路径 | 责任 | 禁止拥有 |
|---|---|---|
| `src/content/` | 加载 canonical entrypoints；验证版本、schema、ID、引用、文件 universe 与 digest | gameplay selection、mutable fallback、renderer state |
| `src/authority/` | clock、event、pattern、projectile、player、Boss/laser、narrative、snapshot/restore 等确定性状态 | DOM、Three.js、audio、wall-clock identity |
| `src/game/` | 装配 authority、输入投影、renderer/audio/UI adapter 与应用生命周期 | 重解释 manifest、根据画面推断 collision/lifecycle |
| `src/main.ts` | boot mode、显式 URL facts、Run/Lab 入口和应用 wiring | 隐式 seed、第二套 Run authority |
| `e2e/` | production-preview 用户路径验证 | 注入私有 gameplay state 以伪造完成 |

Authority 只暴露冻结 snapshots、readonly views 或窄命令端口。调用方不能取得可变 pool、event
buffer、ledger 或内部 state 引用。

## 3. Content Authority

- 只从 V4 canonical entrypoints 建立 manifest-derived registries；禁止复制 ID 清单。
- version、schema、ID、引用、文件 universe 或 SHA-256 漂移立即 fail-fast。
- unknown operator、event、pattern、geometry、Boss binding 或 required payload 是错误，不回退到
  默认实现。
- V4 canonical counts 是内容契约；production coverage 是制作状态，两者不能混写。
- V4 外内容必须经过 `CONTENT_EXTENSION_ZH.md`、focused ADR 与 provenance；不得修改 V4 tree
  让 application tests 通过。

## 4. 时间模型

整数 `tick120` 是唯一 gameplay 时间 identity。毫秒只用于输入/manifest 表达，并在边界向上取整
投影为 due tick；浮点时间不能成为 entity、event 或 occurrence identity。

- V4 60Hz machine 只在偶数 master tick 到期。
- 一次 frame 可以推进多个 gameplay ticks；每个 tick 仍按相同顺序独立提交。
- Pause 冻结 gameplay time，并丢弃暂停期间积累的 wall time；恢复时不补跑。
- Renderer 可插值表现，但不能推进或跳过 gameplay tick。
- cadence、arm、pattern end 与 residue drain 各自拥有 due-time；晚 materialize 不能因接近 complete
  而被提前删除。

## 5. Canonical event bus

Event ID 只来自 V4 schema。每个 event 带整数 tick、显式 occurrence identity、完整 required payload
和稳定 serialization；unknown ID、duplicate occurrence key、hole/accessor/custom prototype 等 hostile
输入 fail-closed。

同 tick 提交顺序固定为：

```text
collision-off → state/damage → collision-on → entity-spawn → feedback
```

Coordinator 可以保留当前 tick 给多个 authority 写入，但 tick close 后不可重开。Feedback 端口只读，
不能调用 gameplay command 或写状态。

需要跨多个 draft 的操作先完整 preflight，再一次 append。Receipt 只证明 exact bus/tick/draft group
已受理，可授权预计算 after-state；它不是通用数据库 transaction，也不能回滚任意 sibling mutation。

## 6. Determinism 与 identity

- 一个 pattern occurrence 使用一个 seeded Mulberry32 stream；消费顺序由 manifest source/declaration
  order 决定，不受 renderer cadence、对象插入顺序或 locale sort 影响。
- occurrence、generation、entity 和 event key 使用显式稳定 identity；排序使用稳定 code-point/byte
  规则。
- canonical serializer 拒绝非有限数字、稀疏数组、访问器、symbol、自定义 prototype 与重复 key。
- 同 seed、输入、content digest 与 profile-independent gameplay facts 必须产生同一 trace。
- accessibility 与 presentation weather 不进入 gameplay hash。

## 7. Pattern 与 motion adapter

Pattern adapter 必须验证完整 contract，而不是只挑实现方便的字段。Emitter cadence、geometry、motion
operator stack、safe gap、hook、residue、difficulty 和 pool ownership 都属于同一责任边界。

- operator 严格按 manifest declaration order 执行；跨 boundary 的 tick 必须明确旧/新 heading 或
  speed 在哪一段生效。
- safe-gap preflight 使用完整 swept path；warning 与 collision geometry 共享受权威证明的路径，
  不能只检查 endpoint。
- clock gate、phase gate、seam/offset discontinuity、turn 与 envelope 各自保留其声明语义；不能
  合并为通用“删除弹体”。
- Python/30Hz QA、declared contract 与 120Hz production path 分层记录。采样层不同就不宣称未证明
  的 trajectory、redirect 或 lifecycle parity。
- pattern 声明存在但没有 producer/evaluator policy 的 hook 必须 exact-validate 并保持 inert。

一个 isolated direct-kernel capability 只证明该 occurrence 可以在给定 authority 内执行。它不自动
授予 live admission、composer、selection、scheduler、room completion、session、renderer 或 handoff。

## 8. Projectile、collision 与 material lifecycle

Projectile/laser flight 由 entity authority 拥有：

```text
scheduled → materialized → armed → collision lease → terminal cancel/impact/OOB
          → collisionless residue → drained/released
```

- arm 前不移动/碰撞；collision lease 只由 gameplay authority 改变。
- contact、graze、Override、warning 与 rule clip 使用连续 swept geometry 和相同 ordered path。
- 不连续的 authority path 必须显式分隔 collision components；consumer 只在 component 内 sweep，
  不得跨 authored absence 自动补 connector。Ash Memory 的 accepted seam 见
  [EXT-2026-003](adr/EXT-2026-003-ash-memory-history-replay.md)。
- collision-off 必须先于同 tick terminal/cancel；residue 永不碰撞。
- renderer frame、alpha、animation end、audio、reduced motion 或 pool visual 不能终止实体。
- pool 满时拒绝新的 live collider；不得回收仍存活的 collider。
- generation 的 RNG/identity 和 material residue 不因表现缺席而消失。

Laser geometry 由 manifest topology/width/tolerance 驱动；pattern family association 不代表当前 Boss
phase 已授权 active laser。

## 9. Player 与局部 Override

Player movement、Focus、graze/evidence、damage、death/respawn 与 input lock 都属于 gameplay authority。
一次 damage proposal 必须绑定 owner、bus、tick、revision 和 exact draft receipt，append 成功后才应用
after-state。

Directional Override 只对授权区域/方向的实际 swept path 生效，并在真实 terminal 坐标留下 scar。
它不是全屏清弹，也不能由 UI、动画或 pattern hook 自动触发。dead、respawning、run-ended 或未授权
阶段必须拒绝其 edge。

## 10. Run、room 与 Boss 组合

把以下层级分开：

1. **Contract validation**：candidate 的 schema、seed domain、metrics、segments、parallel、Boss binding
   和 capability 完整；不写 bus。
2. **Admission**：确认 caller-resolved facts 可进入某个已支持的 authority；不选择、不组合、不排程。
3. **Composition/selection**：由明确 producer 生成 room order、difficulty salt、parallel/weather 与 Boss。
4. **Execution**：创建 run-owned bus/state/pools，按 causal boundary 执行 occurrence。
5. **Completion/handoff**：只有 authored terminal、entity/residue drain、narrative/room barriers 全部满足
   才提交。

任何下层 artifact 都不能被命名或投影成更高层已完成。Boss observe、phase exit、laser start、resolution
与 terminal 是不同 facts；generic projectile drain 不等于 Boss phase handoff。

## 11. Narrative、snapshot 与 cross-run restore

Snapshot 只观察当前 Run，不评价玩家，也不自行写 cross-run event。Serialize 成功后才能铸造与
exact bus/token/payload/tick 绑定的 receipt；Archive 只接受该 receipt，durable storage 另有责任。

Restore 顺序固定为：

```text
material record → ghost route → ghost residue → witness → input return
```

Ghost collision/reward/emitter 为 `NONE`。Snapshot complete、archive acceptance、gaze release 或 room
swap 都不能单独授权 handoff。跨 Run ledger 必须防止 previous-run、route 与 next-run 的重复/冲突，
失败时不留下部分 index。

## 12. Presentation、PWA 与更新

- Renderer/audio/haptics/UI 只消费 frozen projection；不得保存隐藏 gameplay state。
- 视觉截图是表现证据，不是 collision/order/lifecycle 证据。
- `full`、`reducedMotion`、`flashOff` 与 weather presentation 必须产生相同 gameplay trace。
- PWA 使用 waiting-worker；运行中的 gameplay 不由新 worker 接管。只有安全 boot/Run boundary 可以
  提升版本，禁止混用 content digest。
- build/release metadata 记录 Git commit、V4 package/content digest、extension digest、Bun/runtime
  版本与 build mode。

## 13. Failure 与扩展原则

- validation 在 mutation 前完成；不可恢复的 authority mismatch 立即 fail-stop。
- event append 拒绝、stale receipt、reentry、wrong owner/tick/revision 都不得留下部分 gameplay state。
- 不为“看起来能跑”创建默认 ID、fallback pattern、伪事件、固定生命周期 timeout 或 renderer-owned
  completion。
- V4 没有定义的数值/映射必须标记 `application-required-v4-omission`，记录来源、影响、测试和回滚。
- 新机制、内容、文案、视觉/音频语言或 provenance 决定使用 focused ADR；不要继续扩张历史 umbrella
  ADR，也不要建立第二套 gameplay language。
