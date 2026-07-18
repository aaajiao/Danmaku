# 1bit STG V4 最终验证报告

结论：**通过，可作为 Three.js／ECS 游戏实现的 V4 权威资源基线。**

最终组合包经过 40 项跨系统检查，结果为 **40/40 PASS、0 errors、0 warnings**。所有图集、弹幕、Boss、叙事、反馈、音频、UI、背景与运行时入口均可从 `manifests/v4/package-manifest-v4.json` 追溯。

## 1. 最终规模

| 系统 | 结果 |
|---|---:|
| 像素图集 | 7 张 1024×1024 |
| 唯一物理／语义帧 | 448；每张图集 64 格 |
| V4 新增行为帧 | 192 |
| 运动算子／可执行弹幕 | 12／48 |
| 独立弹幕结构签名 | 48／48 |
| Normal／Focus 可达安全通道 | 48／48、48／48 |
| 普通敌人／机械职责 | 16／8 |
| Boss／阶段／激光拓扑 | 8／24／8 |
| Pattern／Boss 动画 | 48／8；每项同时有 GIF、APNG、timeline |
| 房间／反应叠层／天气 | 4／16／5 |
| 叙事状态／反应节点／双语观察 | 16／13／64 |
| 音频 | 48 个 48kHz、双声道、16-bit WAV |
| UI | 1 张 UI atlas、9 张语义界面 |
| 权威事件／状态系统／反馈绑定 | 72／12／34 |
| 无障碍组合 | 216；玩法事件轨迹一致 |

## 2. 世界观闭环

- 四个房间统一使用 `INFORMATION`、`FORCED_ALIGNMENT`、`IN_BETWEEN`、`POLARIZED`；`INFO_OVERFLOW` 只保留为旧存档读取别名。
- 八个 Boss 的 `resolutionId`、条件、终止事件、物质余留和第三阶段退出条件全部直接对齐世界观权威表。Boss 不再以 HP 清空作为唯一结论。
- 天气属于世界表现层。它不能生成弹体、改变碰撞、修改安全通道或进入弹幕随机种子；三个 `WEATHER_ECHO` 仅是 encounter director 独立调度的结构回声。
- Snapshot 记录可追溯事实，不生成分数、排名、人格判断或“好／坏结局”。旧 Score／Power／Life 只作为迁移读别名，运行时只写 Evidence／Expression／Continuity。
- Override 是消耗 evidence 的局部方向性缺席，不是全屏 Bomb；结束后在真实坐标留下 `overrideScar`。

## 3. 跨局与动效验证

跨局恢复使用真实 `routeDuration`，不读取 GIF、APNG 或渲染帧时长：

1. `0ms`：分别复水 `overrideScar`、`deathTrace`、`burnIn`；
2. `420ms`：开始真实 Ghost Route；
3. `routeDuration + 420ms`：路线完成；
4. `routeDuration + 421ms`：在终点写入独立 `ghostResidue`；
5. `routeDuration + 700ms`：Witness 转向；
6. `routeDuration + 1140ms`：归还输入。

四种跨局材料拥有独立数组、事件与衰减时钟。Full、Reduced Motion、Flash-Off 使用相同的权威玩法轨迹，只改变表现映射。

动效覆盖不是把同一张预览重复命名：48 个 Pattern 与 8 个 Boss 各自拥有一对一的 GIF、APNG 和 timeline；文件帧数、timeline identity 与内容哈希均已复验。另有 24 组图集状态库动画用于角色、弹体、行为 cue 与 Boss 组件。

## 4. 素材合同

- 七张图集全部通过文件存在、尺寸、SHA-256 与 frame→atlas 闭合检查。
- 448 个 `semanticId` 全部唯一，每张图集恰好 64 个 128×128 单元。
- V4 新增图集严格使用八色合同，透明度仅为 0／255，普通单元可见颜色不超过四种。
- 9 张 UI、16 张反应叠层和所有可部署音频的文件、尺寸、格式与哈希均和 manifest 一致。
- 13 个 package entrypoint 全部存在；229 个 JSON 可解析，本地 schema 引用闭合。

## 5. 可重复验证

从资源包根目录运行：

```sh
python3 -B tools/qa/validate_v4_integration.py
python3 -B runtime/validate_v4_runtime.py --run-code --strict-warnings
python3 -B gameplay/tools/validate_gameplay_v4.py
python3 -B narrative/validate_narrative_v4.py
```

详细跨系统检查表见 `reports/V4_INTEGRATION_VALIDATION_REPORT_ZH.md`；机器可读结果见 `reports/v4-integration-validation-report.json`。根目录 `checksums-sha256.txt` 用于验证交付包中的每一个文件。

