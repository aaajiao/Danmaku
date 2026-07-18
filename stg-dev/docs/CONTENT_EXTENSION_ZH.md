# V4 外内容扩展与 aaajiao Extension ADR

状态：`MANDATORY GATE`

适用范围：任何不在 `../1bit-stg-complete-asset-kit-v4/` 内的玩法、素材、文案、声音、图标、事件、存档字段、依赖或内容工具。

## 1. 强制前置

每次 V4 外扩展必须在设计和生成前完整读取项目技能：

```text
.agents/skills/aaajiao/SKILL.md
```

仓库已提交的技能基线 metadata version 为 `1.1.0`。ADR 要记录实际读取的 skill version 与文件 digest，因此本地未提交的技能更新也必须与仓库基线分开记载；技能升级后，只对被修改的扩展重新评审，不静默改写历史 provenance。

技能在本项目中的约束不是“模仿一种视觉风格”，而是四个工程门：

1. **元数据门**：先写出扩展要保存的不可约事实；
2. **做减法门**：现有 V4 若能表达，就复用、组合或删除提案；
3. **行为优先门**：扩展必须揭示被内容表面遮蔽的玩家行为，不能只增加图标/敌人数量；
4. **双螺旋门**：数字变化必须指出材料对应，材料痕迹也必须有权威行为来源。

同时执行 anti-utopia 与 anti-monoculture 检查：不要把系统包装成完美治理，也不要让一个最优 build、单一结局或统一审美吞掉其他路径。文案禁用空泛艺术话语，必须指向具体机制、事件、坐标、时间或材料。

## 2. 何时必须创建 ADR

以下任一变化都必须新增 `EXT-YYYY-NNN`：

- 新增/修改 V4 外 gameplay rule、event、operator、Boss、room、ending fact；
- 新增图像、动画、字体、声音、文案或生成式素材；
- 新增 cross-run record、telemetry 字段或玩家画像；
- 新依赖/服务会改变内容治理、离线能力、隐私或可复现性；
- 对 V4 canonical ID 做 alias、override 或 migration；
- PWA 图标、商店图、宣传截图等产品视觉更新。

只修拼写、无语义格式化或测试 fixture 不必建新 ADR，但 PR 必须说明为何不影响行为、hash 或 provenance。

## 3. 做减法 Gate

评审按顺序回答，任一项不通过即拒绝或退回：

1. **V4 可表达吗？** 能通过已有 pattern/operator/event/frame/audio 组合表达，就不得新建同义资产。
2. **删除后失去什么？** 若删除提案后没有不可替代的行为事实消失，则删除提案。
3. **最小表面是什么？** 在 data、rule、projection 中只选必要层；能只加 manifest mapping 就不加 runtime class，能只加 projection 就不改 gameplay。
4. **谁治理？** 写清作者、生成工具、模型/版本、license、审核人和淘汰/迁移权。
5. **谁被隐藏？** 写清素材劳动、数据来源、设备/地域/性能偏差以及被默认排除的玩家。
6. **数字—物质是否成对？** 没有 material consequence 的数字积累，或没有 authoritative event 的“材料装饰”，都不进入 ledger。
7. **是否制造单一最优路径？** 若形成 rank、score、good/bad end、pay-to-win 或唯一有效输入方式，拒绝。
8. **能否离线、重放、校验？** 无法绑定 content hash、无法 deterministic replay 或无法提供无障碍 parity 的扩展不得进入生产。

依赖也执行同一门禁：优先 Web Platform/现有 Three.js/Vite 能力。新增库必须证明减少了更大的自研权威面，而不是因为“最新”或“方便”。

## 4. Extension ADR 模板

在现有 `docs/adr/` 目录中以 `EXT-YYYY-NNN-short-name.md` 保存；不得只写在 PR 描述或聊天记录中。

```md
# EXT-YYYY-NNN：短名称

- 状态：PROPOSED | ACCEPTED | REJECTED | SUPERSEDED
- 日期：YYYY-MM-DD
- 负责人 / 审核人：
- 关联 issue / PR：
- aaajiao skill：version；sha256；读取日期
- V4 package：schemaVersion；package/content sha256
- 影响层：content | authority | simulation | narrative | projection | platform

## 不可约事实（Metadata）

- 玩家哪一个具体行为此前不可见？
- 删除本扩展后，哪一个事实无法再被记录或感知？
- 用一句无形容词的机制描述：

## 负空间（Behavior > Content）

- 当前 UI/内容显示了什么，却遮住了什么行为？
- 本扩展如何让该行为可观察，而不是增加一个代表它的图标？

## 数字—物质双螺旋

- authoritative input/event/state：
- material record / 坐标 / 生命周期：
- restore / witness 关系：

## 做减法结果

- 已检索并尝试复用的 V4 ID：
- 被删除的层/字段/资产：
- 为什么最终仍需新增：
- 新增预算：event __；state __；asset __ bytes；dependency __

## 治理与非单一化

- 谁创建/审核/迁移/删除？
- 哪些玩家、设备、语言、地域或劳动可能被隐藏？
- 如何避免 score/rank/moral ending/唯一最优路线？

## 行为契约

- seed / RNG domain：
- canonical tick 与 same-timestamp phase：
- event ID + required payload：
- collision / safe-gap / warning 影响：
- snapshot/archive/restore 影响：
- failure 与 offline degradation：

## Provenance

| artifact | source/author | tool/model/version | prompt/parameters | license | sha256 |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

## 验证证据

- schema/reference integrity：
- deterministic trace / oracle：
- full == reducedMotion == flashOff：
- E2E/offline/migration：
- performance/pool budget：
- 实机输入：

## 回滚与迁移

- 删除扩展时哪些记录保留为只读？
- content digest 不匹配时如何诊断？
- supersedes / superseded by：

## 决策

- 接受/拒绝理由；仍然未解决的矛盾：
```

## 5. Provenance 最低字段

所有生成或导入 artifact 必须可追溯：

- 规范化相对路径、byte size、MIME、宽高/采样率、SHA-256；
- 原作者/来源 URL/取得日期/license；无法确认授权即不得发布；
- 生成工具、模型、精确版本、完整 prompt/negative prompt、seed、采样/后处理参数；
- 人工编辑步骤、量化 palette、裁切/缩放策略及 reviewer；
- 语义 ID、V4 binding、fallback 和无障碍替代；
- 首次进入的 Git commit 与关联 Extension ADR。

已有 PWA 图标是一个参考：生成源保存在 `artwork/icon-source-imagegen.png`，四合同色母版在 `artwork/icon-master-1024.png`，运行时派生图标在 `public/icons/`。后续改动仍需单独 ADR、prompt/provenance 和 hash，不能只覆盖 PNG。

## 6. 自动验收

Extension merge gate 至少包括：

- schema + semantic ID + file hash 校验；
- 无未知/重复 ID，无 V4 canonical ID 静默覆盖；
- deterministic replay 与同 timestamp order；
- Full/Reduced Motion/Flash-Off trace parity；
- 离线可用和 content digest 绑定；
- pool/performance budget；
- license/provenance 字段完整；
- 禁词/语义检查：`score`、`rank`、`leaderboard`、`victory`、`defeat`、`good_end`、`bad_end` 不得进入玩家评价逻辑；
- 至少一项测试证明新增的是行为事实，而不只是内容数量。

评审允许结论是“拒绝”。一个被证明不需要的扩展，是门禁正常工作的结果。
