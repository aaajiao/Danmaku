# 《1bit》V4 世界观与运行叙事系统

V4 不把剧情放在战斗之外。玩家怎样射击、收窄、擦弹、抬头、经过裂缝和留下 Override，已经是剧情。游戏只把这些行为交给世界回应，再把回应留下的材料带到下一局。

## 1. 这一版补上的主链

```text
上一局材料复水
→ 上一条真实路径播放一次
→ 见证者根据事实转向
→ 安静觉醒
→ 第一眼与第一次强迫压暗
→ 精神房间采样
→ 世界开始回应
→ 局部 Override
→ 黄昏／No Dusk
→ 非击杀式协议解决
→ State Snapshot
→ 下一局材料条件
```

权威状态机是 `narrative/narrative-state-machine-v4.json`。只有 `gameplayClock` 能推进状态；视觉、声音或震动可以省略表现，不能提前结束等待、提前恢复输入或制造新的事实。

## 2. 觉醒不是教程页

开局前六秒没有来弹和命令文字。花在 0.30–0.50 之间呼吸，玩家发出信号后，空间刷新与声响立即改变。世界先展示因果，界面后记录发现。

只有四种兜底提示：

- 60 秒没有发出信号，显示当前绑定的信号按键；
- 第一眼前用一条单像素地平线暗示凝视阈值；
- Override 条件真实满足后，文字才出现在附近建筑上；
- 快照第一次打开时，提示可以查看句子的事实来源。

V3 的完整教程因果图在 V4 被移除。它提前解释了本应由身体发现的关系。

## 3. 花、凝视与局部反抗

花有三个可读区间，但没有“最佳”区间：

| 区间 | 玩家状态 | 世界回应 |
|---|---|---|
| 暗 | 低暴露 | 世界较少刷新，见证者保持孤立 |
| 中 | 可持续表达 | 近处见证者以半速同频呼吸 |
| 亮 | 高表达／高暴露 | 电缆上报、数据瀑布加快、见证者低头 |

Focus 是主动、平滑、可逆的收窄；Eye Clamp 是外部、突然且延迟恢复的强迫。两者不能复用动画曲线或音频包络。

Override 消耗擦弹得到的 `evidence`，只在玩家指定方向和半径内让规则暂时缺席。它不是清屏、全局无敌或传统 Bomb。数字空白关闭以后，在真实坐标写入 `overrideScar`。

## 4. 世界反应图

`narrative/world-reaction-graph-v4.json` 将输入单向分配给十三个反应系统：Eye、Flower、Witness、Ghost、Cable、Snapshot Echo、Seam、RoomSky、ShadowCorrection、DataWaterfall、ViewmodelEcho、Burn-in 与 No Dusk。

每个节点都保留数字／物质双轨：

| 数字反应 | 物质对应物 |
|---|---|
| Eye 的读取被局部遮断 | 断开的读取环与空白孔径 |
| Cable 上报中断 | 分叉烧痕、松弛电缆 |
| 数据包删除 | 字符水洼或立面擦除条 |
| Viewmodel 被两个系统重复读取 | 双边残迹或稳定交集印记 |
| No Dusk 将时间切成两态 | 半变换电缆和矩形时间墙残留 |

反应节点只订阅事实，不生成战斗奖励，不修改碰撞，也不倒过来选择玩家行为。

## 5. 四个精神状态的阈值

具体数值在 `narrative/room-thresholds-v4.json`。

- `INFORMATION`：花亮度依次让字符流可见、电缆上报、刷新溢出；持续凝视写入 Burn-in。
- `FORCED_ALIGNMENT`：左右主张和裂缝各有带滞回的阈值；坠落仍会复位，但留下方向擦痕。
- `IN_BETWEEN`：系统 A、系统 B、交集与误注册各自独立；交集可以被学习，但不是身份标签。
- `POLARIZED`：凝视先 acquire、再 Clamp；累计凝视、两次强迫压暗与至少一份 evidence 同时成立后，才开放 Override。

每次房间切换以一个明确的 `thresholdCommit` 交接碰撞权威，避免视觉已经进入下一房间而规则还在上一房间。

## 6. 天气不是装饰层

V4 有五类独立天气，每类都有前兆、爆发、余波和不同材料：

| 天气 | 前兆 | 余波材料 |
|---|---|---|
| STATIC | 包停止、远点漏刷 | 迟一拍的字符水洼 |
| RAIN | 深度空间出现几根短竖线 | 二值字符水洼 |
| ASH | 第一片灰逆重力落下 | 沿最近路径沉降的灰 |
| WIND | 电缆先于粒子绷紧 | 迟归位的影子擦痕 |
| ECLIPSE | 见证者依次抬头 | 一栋未完全复原的反相建筑 |

玩家行为最多只把天气概率偏置 ±30%，不能直接召唤天气。天气也不能移动弹体、碰撞体或安全通道。

## 7. Boss 是协议，不是血包

八个 Boss 的主解决条件全部不同，见 `narrative/boss-resolutions-v4.json`：

- Absent Receiver：三次信号窗都没有返回确认；
- Unanswering Feed：队列耗尽而互惠通道从未出现；
- One Sun One Rule：Override scar 穿过单一阴影校正线；
- Two Claims：两个主张都在场时保持稳定交集；
- Misreader：连续三次读取未能预告下一步移动；
- Twin Moons：双时钟失配时穿过未认领 seam；
- No Dusk：二值时钟完成见证窗口后撤回；
- Absolute Reader：读取账本关闭时仍有未分类区间。

HP 归零仍可作为 `STRUCTURAL_RUPTURE`，但只说明结构破裂，不自动产生“胜利”。每个结果都必须留下与协议对应的材料。

## 8. 运行结束与下一局

运行可以因身体停下、协议撤回、读取失败、稳定交集、seam 穿越、scar 中断或 No Dusk 撤回而结束。Snapshot 只陈述可追溯事实。

跨局顺序固定：

1. `overrideScar`、`deathTrace`、`burnIn` 复水；
2. 上一条真实路线播放一次；
3. 路线烧尽，在真实终点写 `ghostResidue`；
4. 见证者根据事实转向；
5. 输入归还。

完整、Reduced Motion 和 Flash-Off 模式使用相同的 gameplay tick。区别只在表现帧。

## 9. 接入顺序

1. 先接 `run-memory-v4.schema.json`，删除旧的通用 `scars[]`；
2. 用 V4 narrative state machine 统一开始、结束与跨局时钟；
3. 接房间阈值，再接 reaction graph；
4. 真实采样 ghost route；
5. 接 witness 与 weather；
6. Boss 改读 resolution contract；
7. 最后接 feedback-cues、音频与 UI。

不要让预览、UI 或声音各自复制一套判断条件。它们只能订阅权威事件。

## 10. 验证

运行：

```text
python -B narrative/validate_narrative_v4.py
```

验证覆盖状态链、十三个反应节点、五类天气、四房间阈值、八种 Boss 解决、64 组双语观察句、四种跨局材料、37 条反馈线和 48 个音频资源。
