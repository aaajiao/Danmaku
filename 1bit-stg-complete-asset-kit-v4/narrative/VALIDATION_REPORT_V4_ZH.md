# V4 世界观、叙事、UI 与音频验证报告

结果：**56/56 PASS，0 FAIL**。

| 检查 | 结果 | 说明 |
|---|---:|---|
| `json:boss-resolutions-v4.json` | PASS | valid JSON |
| `json:narrative-state-machine-v4.json` | PASS | valid JSON |
| `json:room-thresholds-v4.json` | PASS | valid JSON |
| `json:snapshot-observations-v4.json` | PASS | valid JSON |
| `json:validation-report-v4.json` | PASS | valid JSON |
| `json:weather-system-v4.json` | PASS | valid JSON |
| `json:world-reaction-graph-v4.json` | PASS | valid JSON |
| `json:audio-manifest-v4.json` | PASS | valid JSON |
| `json:feedback-cues-v4.json` | PASS | valid JSON |
| `json:ghost-replay-contract-v4.json` | PASS | valid JSON |
| `json:narrative-manifest-v4.json` | PASS | valid JSON |
| `json:run-memory-v4.schema.json` | PASS | valid JSON |
| `json:sample-run-memory-v4.json` | PASS | valid JSON |
| `json:ui-copy-v4.json` | PASS | valid JSON |
| `json:ui-layouts-v4.json` | PASS | valid JSON |
| `json:witness-conditions-v4.json` | PASS | valid JSON |
| `narrative-state-coverage` | PASS | 16 states |
| `cross-run-order-events` | PASS | scar -> ghost -> witness -> input |
| `non-judgemental-end-reasons` | PASS | forbidden=['BAD_END', 'DEFEAT', 'GOOD_END', 'SCORE_THRESHOLD', 'VICTORY'] |
| `world-reaction-node-coverage` | PASS | 13 required nodes |
| `world-reaction-edge-references` | PASS | 26 one-way edges |
| `four-distinct-memory-classes` | PASS | burnIn, deathTrace, ghostResidue, overrideScar, weatherResidue |
| `five-weather-types` | PASS | 5 types |
| `weather-three-phase-contract` | PASS | omen / burst / aftermath on all types |
| `weather-distinct-residue` | PASS | characterPuddle, binaryPuddle, routeAsh, misalignedShadowScuff, eclipseInversion |
| `four-room-thresholds` | PASS | 4 rooms |
| `room-threshold-id-unique` | PASS | 16 unique thresholds |
| `eight-boss-resolutions` | PASS | 8 bosses |
| `boss-resolution-diversity` | PASS | 8 distinct resolutions |
| `boss-resolution-not-hp-only` | PASS | all primary resolutions are behavioral/protocol conditions |
| `snapshot-observation-count` | PASS | 64 bilingual observations |
| `snapshot-observation-ids` | PASS | 64 unique ids |
| `snapshot-observation-traceability` | PASS | condition + metric paths + bilingual copy |
| `snapshot-traces-resolve-run-schema` | PASS | unknown metrics=[] |
| `snapshot-copy-non-evaluative` | PASS | forbidden terms found=[] |
| `run-memory-separated-remainders` | PASS | overrideScars, deathTraces, burnIns, ghostResidues |
| `sample-run-has-all-authoritative-metrics` | PASS | missing=[] |
| `sample-light-bands-sum-one` | PASS | sum=1.000000 |
| `sample-room-time-equals-duration` | PASS | rooms=462000, run=462000 |
| `sample-evidence-once-per-projectile` | PASS | spent <= accepted == unique bullets |
| `sample-material-ids-global-unique` | PASS | 4 material records |
| `sample-run-rehydration-order` | PASS | four remainders -> witness -> input |
| `ghost-actual-route-only` | PASS | actual player transform after authoritative movement resolution |
| `ghost-single-replay` | PASS | replay count = 1 |
| `ghost-no-gameplay-authority` | PASS | collision/reward = NONE |
| `witness-condition-coverage` | PASS | 7 witness states |
| `ui-no-score-semantics` | PASS | visible forbidden tokens=[] |
| `score-migrated-to-evidence` | PASS | score pickups/HUD removed |
| `feedback-cue-ids` | PASS | 37 unique cues |
| `feedback-four-modalities` | PASS | visual / UI / audio / haptic declared |
| `audio-room-bed-count` | PASS | 4 room beds |
| `audio-boss-signal-count` | PASS | 8 boss signals |
| `audio-sfx-count` | PASS | 36 SFX |
| `feedback-audio-references` | PASS | missing=[] |
| `audio-files-and-hashes` | PASS | errors=[] |
| `audio-loop-boundaries` | PASS | discontinuity=[] |
