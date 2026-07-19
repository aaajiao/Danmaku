# EXT-2026-003：Ash Memory history replay

- 状态：ACCEPTED
- 日期：2026-07-19
- 负责人 / 审核人：aaajiao / Codex
- 实现提交：`53324d0b5edb338f23e244f6f79ff09ddde34b40`
- 前置记录：[EXT-2026-002](EXT-2026-002-canonical-run-fragment-adapters.md)（只读历史基线）
- aaajiao skill：`1.1.1`；SHA-256 `ccfb41ac8898d7f035a9f8bd9cfd66cb526d213e0184b266d7ef71477fe310e4`
- V4 package：schema `4.0.0`；content digest SHA-256 `f5ad0e32d5c15aa9cae52a5b7948af217bc82951bfb7f8f4cb97c3a8c24bc2b2`
- 影响层：authority / simulation；不修改 V4、asset、canonical event ID 或依赖

## 背景与不可约缺口

V4 `encounter.weather_echo.ash_memory` 声明 `history_chain`、序列化 points、420ms delay、
`reverse` replay、`operator_constraint` ash wake 与 `ash_fiber` residue。motion operator 明示
points 是 gameplay data，碰撞使用 polyline capsule；warning、动画和真实 ASH weather 都不能成为
轨迹输入。pattern 还明确禁止 `weatherEvent`、`weatherSeed` 与 `weatherRng` 改写 spawn、motion、
collision 或 safe gap。

不可变 Python QA oracle 会反转序列化路径，以 occurrence 内 UID 计算 X offset，并在 endpoint
侵入走廊时按 endpoint 所在侧贴边和旋转。但它是 30Hz endpoint 参考，没有定义以下 120Hz
production policy：

- arm anchor 到 absolute replay path 首点之间的首个 flight interval；
- 一个 master tick 跨过 replay 内部顶点或 terminal time 时的 swept path；
- 首次 anchor sweep 从 ash wake 一侧进入、而 oracle endpoint 最终落在另一侧时，碰撞路径是否应
  穿过受保护的 corridor；
- replay 完成后的第一个 fixed tick 是否重新贴到 terminal point；
- isolated capability 如何取得 live director、weather、composer 或 session authority。

这些缺口不能由 renderer、warning shape、天气表现或隐藏 scheduler 推断。

## 决定

### 1. 精确合同、RNG 与 identity

- adapter 对 Ash Memory 的完整 pattern、emitter、motion、safe-gap、weather firewall、difficulty、
  cancel、residue 与 pool mapping 做 descriptor-safe exact validation；未知字段、accessor、稀疏数组、
  非有限坐标或不严格递增的 point time fail-closed。
- `history_chain` 与 `op.history_replay` 只在这个 exact Ash capability 内获得执行权；这不开放通用
  history-replay operator registry。
- 每个 geometry candidate 继续按 authored 顺序消费同一 Mulberry32 stream；replay offset 使用稳定的
  occurrence-local ordinal `burstIndex * scaledCount + sourceIndex + 1`，不使用可回收 pool slot，
  也不因较早的 allocation 结果改号；X offset 精确保持 oracle 的
  `((ordinal % 7) - 3) * 2.2`。
- `bullet.micro.shard` 只映射到既有 `micro` pool class；不新增 archetype、event 或 gameplay state。

### 2. 120Hz absolute history replay

- projectile 在 arm 前停留于 emitter anchor。首个 post-arm flight tick 保留 anchor 到 reverse path
  首点的完整 sweep；420ms delay 和 replay age 都从 authored spawn time 计算。
- reverse polyline 是 absolute serialized gameplay path。一个 tick 跨过内部 authored vertex 时按 vertex
  分段，contact、safe gap 与 Override 共享相同 ordered path，不以 endpoint chord 穿过折点。
- replay 期间每个 fixed tick 先恢复本 tick 的 absolute sample，再对完整 sweep 重复应用
  `operator_constraint` 求 continuous first entry；redirect 保留同一 generation，并按 immutable
  oracle 的 endpoint side 贴边与累积 signed `±8°` heading。
- replay terminal 之后的第一个 fixed tick 从上一 tick 已解析的位置按累积 heading 和 authored speed
  继续 linear flight；不重新 snap 到 exact terminal point。

### 3. 走廊两侧是离散 contact components

当首个 anchor-to-history sweep 从 ash wake 一侧进入、而 exact oracle snap 位于另一侧时，生产路径
只保留“走廊外到首次 entry 的 contact 前缀”和“贴边后的 endpoint”两个 contact component。
前缀仍能产生正常 contact；两者之间的走廊内部没有 collider，不得用一条人工 connector 把受保护
的缺席重新变成碰撞。该 cross-side 例外只属于 Ash，其他 `operator_constraint` pattern 遇到同类
跨侧输入继续 fail-closed。

跨 authority 的 ordered-path port 因此增加 exact marker `startsNewComponent: true`：它只能出现在非首
segment、必须分隔真正不连续的 endpoints，且 first/redundant/false/non-boolean/accessor marker 以及
未标记的 discontinuity 均拒绝。
player contact 与 Directional Override 只在 component 内 sweep，同时仍验证第一起点和最终终点与
projectile authority 一致。这一 marker 表示 collider topology，不是 presentation hint。

### 4. Weather firewall 与 capability 边界

Ash Memory 只加入 private direct-kernel capability；exported live-admission registry 仍为 20。它没有
weather input port，也不读取真实 ASH event/seed/RNG。director 仍是 manifest 声明的未来 scheduling
authority，但本切片不实现或推断该 producer。

该 capability 不进入 live admission、parallel scheduler、room composer、`CanonicalRunSession`、默认
RUN、renderer、persistence、room completion 或 handoff。数字侧的 reverse path、短暂 contact absence
和 collisionless `ash_fiber` residue 构成同一 behavior；不产生方向正确、成功、分数、效率或奖励。

## 未采用方案

- **从动画、warning 或真实天气采样路径**：会让 presentation 获得 gameplay write authority。
- **把不连续 endpoints 用直线相连**：会制造穿越 authored safe gap 的 collider。
- **在 cross-side entry 时 omit、gate 或 cancel body**：会改变已消费 RNG、entity identity 与 material
  residue lifecycle，不等价于 oracle redirect。
- **以 isolated kernel 证明 live weather encounter**：V4 的 director/composer producer 尚未接入，当前
  evidence 不足以授权 scheduling、session 或 Run。

## 后果与制作状态

- direct kernel 从 24/48 增至 25/48；weather echo direct coverage 从 2/3 增至 3/3。
- exported live-admission registry 保持 20；private direct-only capability 从 4 增至 5。
- ordered projectile path 现在可以精确表达多个 collision components；后续 consumer 必须保留 component
  boundary，不能自动补线。
- 完成 weather-echo family 的 isolated direct coverage 不代表 live weather、room 或完整 Run 已完成。

## Provenance

权威来源为：

- `1bit-stg-complete-asset-kit-v4/manifests/gameplay/executable-patterns-v4.json`；
- `1bit-stg-complete-asset-kit-v4/manifests/gameplay/motion-operators-v4.json`；
- `1bit-stg-complete-asset-kit-v4/manifests/gameplay/encounter-director-v4.json`；
- `1bit-stg-complete-asset-kit-v4/gameplay/tools/sim_core.py`。

接受时实现 artifact：

| artifact | SHA-256 |
|---|---|
| `src/authority/combat-kernel.ts` | `15e97d1d1a55d3a276a3e2d9ea23efdf93b3cbf7ca19966ccecb962098d83da1` |
| `src/authority/combat-kernel.test.ts` | `8b2ee0a22b52fea6e00778e27166c0d5ce62bc01a3f7953bf25f9bdcde174aa5` |
| `src/authority/player.ts` | `879b692e777ee060cccad3f8123e397cb5eca9ff513861be6447f74191dc3c3f` |
| `src/authority/player.test.ts` | `b360875ecb4ee283c6262528cdb181e81b76a9e8cb52b17cc0d83f621e74258b` |

V4 source tree 未修改。精确 seed、oracle/production trace hash、cadence、lifecycle 与 hostile descriptor
fixtures 固定在上述测试 artifact，不复制进 Roadmap 或 Architecture。

## 验证

接受提交通过：

- Ash Memory focused Vitest；
- player ordered-path / Override full Vitest；
- combat-kernel full regression；
- strict TypeScript typecheck；
- `git diff --check`。

Python/30Hz oracle、declared contract 与 120Hz production evidence 保持分层；验证不声称三者拥有相同
continuous trajectory 或 redirect count。

## 回滚与 supersession

若该 seam 被证明不正确，回滚必须让 Ash Memory 恢复为 unsupported private capability，并移除其
component-path consumer，不能退回 animation/weather inference、endpoint-only collision 或人工 connector。
该回滚没有存档迁移，默认 RUN 保持不变。

任何改变 replay terminal、cross-side contact topology、weather producer 或 live scheduling 的后续决定，
必须新建 successor ADR，引用本记录与接受提交，不静默重写本文件。
