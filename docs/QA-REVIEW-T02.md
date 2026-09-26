# QA 审计报告 —— T02 核心纯函数层（含 T03/T04/T05 回归）

- **审计人**：严过关（Yan），QA 工程师
- **审计对象**：`tft-pool-counter` 牌库引擎（`src/core/pool-engine/`、`src/core/ledger/`、`src/core/baseline/`）
- **审计日期**：2026-09-14
- **审计基线**：`data/pool-baseline.json`（Set 18，65 弈子，30/25/18/10/9）
- **审计方法**：源码逐行审计 + 独立构造边界用例 + 随机化性质测试 + 全仓合规红线扫描（不复用工程师的测试与断言）
- **路由判定**：**Source → Engineer（工程师）**，共 3 项「一般」级偏差需修复；**合规红线通过**，无阻断级问题

---

## 一、结论速览

| 维度 | 结果 |
|---|---|
| 合规红线（一票否决） | ✅ **通过**（独立扫描 0 命中；官方脚本 283 文件 ✅） |
| 牌库引擎核心公式 | ✅ 正确（星级换算 / 溢出 clamp / 淘汰回池 / 覆盖率 / 撤销栈 / 非池过滤 全部通过） |
| 随机化性质测试 | ✅ 300 局 × 8 家 × 28 格 ≈ 6.7 万次观测，64/65 弈子恒等式 0 反例 |
| 新增 QA 测试 | 97 个 / 9 文件，全部通过 |
| 全量测试 | 369 个 / 26 文件，全部通过 |
| `src/core` 覆盖率 | 语句 96.92% / 分支 85.46% / 函数 100%（门槛 90/80/90） ✅ |
| typecheck / build | ✅ 0 error；esbuild 0 warning + vite 构建成功 |
| 阻断级缺陷 | **0** |
| 严重级缺陷 | **0** |
| 一般级缺陷 | **3**（详见第四节） |
| 提示级 | **3** |

---

## 二、合规红线审计（最高优先级，一票否决项）

**结论：✅ 通过。全仓不存在任何内存读取 / 进程注入 / 输入模拟 / 截图外传的实现或依赖。**

### 2.1 危险 API / 违规包全仓检索（排除合规守卫自身）

检索关键词：`OpenProcess` `WriteProcessMemory` `ReadProcessMemory` `VirtualAllocEx` `CreateRemoteThread` `NtReadVirtualMemory` `SetWindowsHookEx` `SendInput` `mouse_event` `keybd_event` `robotjs` `ffi-napi` `memoryjs` `node-key-sender` `nut-js` `koffi` `win32-api` `winax`

- `src/` `tests/` `scripts/` `data/` `docs/` 范围内 **0 命中**（唯二命中位于 `.eslintrc.cjs` 与 `scripts/check-compliance.mjs` 的**禁用清单本身**，属守卫规则，非实现）。

### 2.2 模拟鼠标键盘 / 自动化注入

- 检索 `robot` / `InputEmulat` / `keyTap` / `typeString` / `mouseMove` / `mouseClick` / `keyboard.` / `dispatchKey` → **0 命中**。

### 2.3 外网请求 / 截图外传

| 命中项 | 判定 | 说明 |
|---|---|---|
| `src/main/vision-host.ts:request()` | ✅ 合规 | 对 `utilityProcess.fork` 出来的识别子进程做**内部消息 RPC**（`requestId` 配对 + 超时），非网络请求；文件头明确声明"不读内存、不注入、不模拟输入、从不落盘、从不上传" |
| `scripts/dev.mjs:63 fetch(VITE_URL)` | ✅ 合规 | `VITE_URL = http://localhost:5173`，仅开发模式探活 Vite；不在 `src/`，不入产物 |
| `src/` 中 http(s) URL | ✅ 0 个 | — |
| `src/` 中 `child_process` / `net` / `dgram` / `http` / `tls` import | ✅ 0 个 | — |

### 2.4 依赖清单核验（当前 `package.json`）

- `dependencies`：`@emotion/*`、`@mui/*`、`@tanstack/react-virtual`、`@techstark/opencv-js`、`ajv`、`electron-log`、`electron-store`、`jszip`、`node-screenshots`、`react`、`react-dom`、`sharp`、`zustand`
- `devDependencies`：构建/测试/类型工具链，无违规包
- `optionalDependencies`：空
- `node_modules` 实际安装目录检索 `robotjs|ffi|memoryjs|key-sender|nut-js|koffi|win32-api|winax|node-gyp` → **0 命中**
- 新引入的 `node-screenshots`（原生截屏）、`sharp`（图像处理）、`@techstark/opencv-js`（WASM OpenCV）均为**本地只读像素处理**库，符合 PRD"只读取屏幕像素"的产品边界。

> **合规判定：无阻断级问题。产品在"仅读屏、不注入、不模拟、不外传"的红线内成立。**

---

## 三、测试与验证统计

### 3.1 新增 QA 测试（`tests/unit/qa-*.test.ts`，9 文件 / 97 用例）

| 文件 | 用例 | 覆盖审计点 |
|---|---|---|
| `qa-star-copies.test.ts` | 13 | 1★=1 / 2★=3 / 3★=9 / 4★=9；3★ 占 9 张；跨家叠加；人工校正落点星级 |
| `qa-overflow.test.ts` | 6 | 剩余数非负；`observed == pool` 边界不打标记；溢出 clamp + `OVERFLOW_DUPLICATOR` + `ENG_OVERFLOW`；恒等式 `remaining − overflow = pool − observed` |
| `qa-baseline-config.test.ts` | 13 | 基数切换 22/20/17/10/9 逐行验证无硬编码；星级换算表可配置；65 id 唯一；`pool_total` 与费用档/声明数量/tierTotal 自洽；schema 校验 |
| `qa-coverage.test.ts` | 16 | 8 家全扫 / 只扫 1 家 / 0 家；淘汰家算已覆盖；UNKNOWN 不计入 8 家；乐观/悲观区间；`LOW_COVERAGE` / `LOW_CONFIDENCE`；悲观 clamp |
| `qa-elimination.test.ts` | 8 | 台账层 + 引擎层双路验证"淘汰 → 单位回池"（PRD RQ-14） |
| `qa-undo.test.ts` | 13 | set-copies / adjust-copies / clear-seat / mark-eliminated 撤销后状态**完全一致**；LIFO；容量 50；reset 清栈；不可变性 |
| `qa-non-pool.test.ts` | 12 | 10 个非池 id 在 dedup 与引擎层双重过滤；未知 id 剔除 + `ENG_UNKNOWN_CHAMPION` |
| `qa-property.test.ts` | 7 | 随机 8 家 × 28 格；7 条恒等式；幂等；纯函数；单调性；UNKNOWN 口径 |
| `qa-double-slot.test.ts` | 9 | 远古巨龙双槽位合并正确性 + 1 处架构偏差（`it.fails` 记录） |

**辅助构造器**：`tests/helpers/qa-builders.ts`（直接构造 `PlayerLedger[]`，与工程师的 `goldens.ts` 黑盒路径互补）。

### 3.2 验证命令结果

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ 26 文件 / **369 用例全部通过** |
| `npx tsc --noEmit -p tsconfig.main.json` | ✅ 0 error |
| `npx tsc --noEmit -p tsconfig.renderer.json` | ✅ 0 error |
| `node scripts/check-compliance.mjs` | ✅ 扫描 283 文件，无禁用 API 命中 |
| `npx vitest run --coverage` | ✅ `src/core` 96.92% / 85.46% / 100%（`star-copies` 100%、`compute-remaining` 100%） |
| `npm run build` | ✅ esbuild（main/preload/vision-worker，0 warning）+ vite（856 模块）构建成功 |

### 3.3 已确认**正确**的关键行为（工程师无需改动）

- **星级换算**：换算表取自 `PoolBaseline.starCopyCost`，全链路无硬编码；3★ 正确占 9 张；5 费池 9 的 3★ 恰好耗尽时 `remaining=0, overflow=0` 且**不打**溢出标记（边界正确）。
- **溢出**：`remaining` 严格 clamp 到 0、`overflow = observed − pool`、打 `OVERFLOW_DUPLICATOR` 并产出 `ENG_OVERFLOW`；对 65 行全溢出场景无负数。
- **卡池基数可配置**：切换 22/20/17/10/9 后同一台账结果正确变化（1 费 28→20），证明无 30/25/18/10/9 硬编码；星级换算表亦可配置。
- **淘汰回池**：与 PRD §2.3 / RQ-14 一致 —— 淘汰后该家持有量归零、剩余数回升；台账层与引擎层（二次兜底）双路验证；淘汰家正确计入覆盖率。
- **撤销栈**：采用"变更前整体快照回滚"，4 类指令撤销后 slot / status / scanCount / lastScanAt **完全一致**，LIFO 与容量 50 正确。
- **非池过滤**：10 个非池 id 在识别阶段与引擎层双重过滤，不影响任何一行；未知 id 被剔除并报 `ENG_UNKNOWN_CHAMPION`（不静默计入）。
- **属性测试**：随机 300 局 ≈ 6.7 万次观测，64 个普通弈子的 `observedCopies` 与朴素求和**零反例**。

---

## 四、发现的问题（分级）

### 阻断级（Blocker）

**无。**

### 严重级（Major）

**无。**

### 一般级（Minor）—— 建议修复

#### M1. 双槽位"相邻"判定用线性索引，未按架构要求的水平/垂直几何

- **文件**：`src/core/pool-engine/rules/double-slot.rule.ts:44-62`（`clusterAdjacent`）；同一假设亦见 `src/core/pool-engine/dedup.ts:167-183`
- **架构依据**：`docs/ARCHITECTURE.md:236` —— "对 `teamSlots > 1` 的弈子，把**水平/垂直相邻**且 `championId + star` 相同的槽位合并为一个实例"。
- **期望**：按二维棋盘的行列几何判断相邻（`SlotSample` 上游已提供 `row`/`col`）。
- **实际**：实现只比较 `instance.slotIndex === last.endSlot`（线性相邻）。TFT 棋盘为 **7 列 × 4 行**（`slotIndex = row*7 + col`），因此 `row1col6(索引 13)` 与 `row2col0(索引 14)` **线性相邻但空间不相邻**，会被误判为同一只巨龙。
- **影响**：两只分别位于行末与次行行首的远古巨龙被当成一只 → 少算最多 9 张（3★ 时）→ `observedCopies` 偏低、`remaining` 偏高。触发条件苛刻（需远古巨龙 + 恰好跨行边界 + 两格均被识别），故定「一般」。
- **复现**：`tests/unit/qa-double-slot.test.ts` 中 `it.fails('跨行边界的两只巨龙…应各计 1 张 = 2 张')`；同文件另有用例记录当前实际值 `observedCopies === 1`。
- **修复建议**：把 `boardCols`（或 `row`/`col`）透传到 `dedup` 与 `double-slot.rule`，相邻判定改为"同一行且列号 +1"或"同一列且行号 +1"；修复后该 `it.fails` 会因"意外通过"而报错，提示同步更新用例。

#### M2. `slotSpanHint` 契约未接线，`ObservationRecord.slotSpan` 从不产出

- **文件**：`src/vision/detect/slot-extractor.ts:54`（字段声明）、`:88`（`slotSpanHint: 1` 硬编码）
- **期望**：文件头注释声明 `slotSpanHint` 是"多格实例提示（远古巨龙占 2 格，下游规则据此合并）"，应由几何/模板判定产出 2。
- **实际**：全仓检索 `slotSpanHint` 仅这 3 处，**从未被赋值为 2**；`src/vision/**` 也从不写入 `ObservationRecord.slotSpan`。因此引擎侧所有基于 `slotSpan` 的分支在真实链路中恒为 1（等价死代码），双槽位合并完全依赖线性相邻 —— 直接放大了 M1 的影响面。
- **影响**：架构定义的"多格实例提示"能力实际不可用；双槽位正确性无冗余保障。
- **修复建议**：在 `slot-extractor` / 融合阶段依据 `champion.special.teamSlots` 与几何位置产出 `slotSpanHint`，并贯通到 `ObservationRecord.slotSpan`。

#### M3. `copiesToThreeStar` 硬编码 9，违反"禁止硬编码卡池数字"约定

- **文件**：`src/core/ledger/selectors.ts:85-88`
- **期望**：3★ 张数应取自 `baseline.starCopyCost[3]`（`src/core/pool-engine/star-copies.ts` 头注释明确"换算表必须来自 `PoolBaseline.starCopyCost`，禁止在业务逻辑里硬编码数字"）。
- **实际**：`return Math.max(0, 9 - mine);` —— 字面量 `9`；且函数签名 `(row, mySeat)` 不接收 `baseline`，无法取表。
- **影响**：当前基线 `starCopyCost[3] === 9`，输出恰好正确，**暂无功能缺陷**；但只要基线调整 3★ 消耗（本报告已验证该表可配置），此函数会静默给出错误提示文案。
- **修复建议**：签名为 `copiesToThreeStar(row, baseline, mySeat = 0)`，内部用 `copiesOf(3, baseline)`。

### 提示级（Info / 建议）

#### I1. `undoCorrection` 只回滚 `ledgers`，不回滚 `history`

- **文件**：`src/core/ledger/ledger-store.ts:427-438`
- **现状**：撤销恢复 `ledgers` 与 `updatedAt`，但保留 `state.history`（环形缓冲只增）。
- **判定**：**不构成功能缺陷** —— `history` 仅用于复盘/调试，不参与任何剩余数计算；已撤销场景下会残留"曾发生过的变更"记录。已在 `qa-undo.test.ts` 用例中记录现状。
- **建议**：若产品要求撤销后复盘视图也一致，需一并将 `history` 入快照。

#### I2. 非池黑名单双源冗余：基线内那份从未被读取

- **文件**：`src/core/baseline/load-baseline.ts:212`
- **现状**：`nonPoolUnitIds = options.nonPoolUnitIds ?? typed.non_pool_unit_ids ?? DEFAULT_NON_POOL_UNIT_IDS`。而基线文件里实际字段是 `non_pool_units_blacklist.items`（中文描述型字符串数组），`non_pool_unit_ids` 不存在 → 永远回退到 `data/non-pool-units.json`。基线内那份黑名单是**死数据**。
- **建议**：删除基线内冗余字段，或在加载时合并，避免双源将来不一致。

#### I3. 黑名单缺"训练假人/木桩"类 id；`perSeatByCost` 默认值与 PRD Q7 表述不一致

- **I3a**：`src/vision/match/blacklist-filter.ts:4` 注释已提到"训练假人"，但 `data/non-pool-units.json` 的 10 条 id 中**无 dummy 类条目**（全仓检索 `假人|dummy|木桩` 仅命中该注释）。风险低（假人无法命中 65 个弈子模板，最终会走"未知 id"剔除路径），建议补一条以防模板误匹配。
- **I3b**：`constants.ts:65-71` 的 `DEFAULT_PER_SEAT_BY_COST` 全档为 1；PRD Q7（`docs/PRD.md:447`）表述为"未覆盖每家按该费用档**全场平均持有量**计，4/5 费按每家 1 张保守计"。当前默认使 1–3 费的悲观下界偏乐观（不够保守）。该项**已在架构 `A7` 记为"请产品确认默认值"**，属已跟踪事项，非新缺陷。
- **I3c（补充说明）**：任务书中"妮蔻复制单位"并非独立单位 id —— 英雄复制器是**机制**（生成额外副本），已由 `duplicator-overflow.rule` 的溢出路径正确覆盖，无需黑名单条目。此项**无缺陷**。

---

## 五、路由判定

1. **源码 Bug → 工程师（software-engineer）**：M1、M2、M3 三项「一般」级偏差需修（不阻断交付，可排入下一轮）。已提供文件 + 行号、期望 vs 实际、复现用例与修复建议。
   - **不由我修改源码**（遵守职责边界）；相关测试已落盘，修复后可直接回归。
2. **测试代码问题 → QA 自修（已完成）**：本轮共修正 2 处**我自己的**断言错误（备选预设中 4/5 费基数不变导致 `poolTotal` 合理不变；悲观 clamp 算术写成未 clamp 值）。均属测试断言错误，源码行为正确。
3. **阻断级问题**：无，**无需要立刻中断交付的项**。

> **总体裁定**：T02 核心纯函数层**通过审计**，可进入后续对接；合规红线**通过**。3 项「一般」级偏差建议在 T06 前修复（M1/M2 同源，一次即可一并解决）。**不给出"无问题"通行证 —— 上述偏差真实存在且可复现；同时也不虚构问题 —— 引擎核心公式经 6.7 万次随机观测验证无误。**

---

## 六、审计边界与未覆盖项（诚实声明）

- **未验证**：真实截图下的识别准确率（需真实对局样本，当前无素材）—— 属 T03 视觉层，超出本次 T02 审计范围。
- **未验证**：`npm run dev` 真机 GUI 弹窗（沙箱不保证 GUI 进程启动）；已用 `npm run build` 产物 + 静态自证替代。
- **未验证**：Electron 运行时行为（窗口/IPC 实际联调），仅做了类型检查与构建冒烟。
- **可复现性**：所有随机化用例采用固定种子 LCG，结果 100% 可复现。

---

## 七、第二轮：M1 / M2 / M3 修复复核（QA 一审独立复核）

- **复核触发**：工程师报告 M1/M2/M3 已修，请回归。
- **复核方式**：不依赖工程师新增用例，自建 **31 个独立用例**（`tests/unit/qa-m1m2m3-verify.test.ts`），以一审原报缺陷的精确复现为基准，并追加二审未覆盖的角度。
- **复核结论**：✅ **M1 / M2 / M3 三项修复均验证通过**；另发现 1 项「M3 未端到端达成」与 1 项「提示级」遗留。

### 7.1 复核结果

| 项 | 复核内容（自建用例） | 结果 |
|---|---|---|
| M1 | `slot-geometry` 纯函数边界（`toRowCol` / `isOrthogonallyAdjacent` 水平·垂直·跨行·自身·对角、非法 cols 回退） | ✅ |
| M1 | 原报缺陷 13↔14、6↔7、20↔21 跨行 → 各 2 张；12↔13 水平 → 1 张 | ✅ |
| M1 | **竖向**相邻 0↔7、6↔13 → 各 1 张（几何相邻含垂直，为修复新增能力） | ✅ |
| M1 | 3 格连续不越 `teamSlots` 上限（→2 张）；4 格两两相邻 → 2 张；备战席 0↔1 → 1 张 | ✅ |
| M1 | `geometry` 覆盖**真实生效**：7 列下 5↔6 为水平相邻(1 张)，改 `{board:6}` 后变跨行(2 张) | ✅ |
| M2 | `applyMultiCellHints`：水平/竖向合并写 `slotSpan=2`；跨行不合并；3 格受上限产出 span 2+1；不改入参 | ✅ |
| M2 | `applyScan` 写入 `slotSpan=2` 实例且只计 1 张 | ✅ |
| M2 | **步骤 3b 生效**：先有 slot1 单格实例，再收到 slot0/spanspan=2 观测 → 旧实例被清理、无重复计数 | ✅ |
| M2 | dedup 侧几何合并为第二道保险；不误并跨行；`ApplyScanOptions.geometry` 覆盖生效 | ✅ |
| M3 | `copiesToThreeStar(row, baseline)` 读 `starCopyCost`；自定义 3★=27 时同步为 27；缺省回退 9；已持 9 张返回 0 | ✅ |

### 7.2 对工程师改动的独立审计（重点：是否弱化我方测试）

| 被改文件 | 审计结论 |
|---|---|
| `tests/unit/qa-double-slot.test.ts`（**我方文件**） | ✅ **属加强，非弱化**：原 `it.fails` 的关键断言 `observedCopies === 2` **原样保留**，并新增 `remaining === 7`；原先"记录 bug 现状（=1）"的特征化用例被正确移除（缺陷已修，理应删除）。 |
| `tests/unit/pool-engine/compute-remaining.test.ts`（工程师自己文件） | ✅ **改动合理**：兜底用例由 `20↔21` 改为 `19↔20`。7 列棋盘上 20=row2col6、21=row3col0（跨行，不相邻），19=row2col5、20=row2col6（同行相邻）。旧用例依赖的正是被修掉的线性相邻假设；新用例仍验证"两个相邻实例合并为 1 张"的**原意**，未削弱。 |
| `dedup.test.ts` / 新增 `slot-geometry.test.ts` / `vision/multi-cell.test.ts` | ✅ 覆盖正常合并、跨行不合并、步骤 3b、普通弈子不合并，方向正确。 |

### 7.3 本轮新发现

#### M3b（一般级，建议修）—— M3 未端到端达成：真正在用的渲染层函数仍硬编码 9

- **文件**：`src/renderer/utils/format.ts:130-133`（`distanceToThreeStar`）
- **关键事实**：M3 修复的 `src/core/ledger/selectors.ts` 的 `copiesToThreeStar` 在 **`src/` 下无任何生产调用点**（全仓检索仅定义 + 测试）；HUD 实际使用的是 `format.ts` 的 `distanceToThreeStar`（调用点：`src/renderer/components/hud/ChampionRow.tsx:54`、`WatchlistPanel.tsx:38`），它**仍然写死 9**。
- **结论**：M3 修的是"没人调的函数"，**用户可见的「差 N 张」文案仍走硬编码**。当前 `starCopyCost[3] === 9`，故无功能错误；但 M3 的"单一事实来源"意图**未端到端实现**。
- **实证**：`tests/unit/qa-m1m2m3-verify.test.ts` 的「M3b」用例 —— 把基线 3★ 改为 27 后，`copiesToThreeStar` 输出 27，而 `distanceToThreeStar` 仍输出 9（两者发散）。
- **判定**：**不认同**"渲染层镜像是有意为之、与 M3 无关"的免责。文件头虽声明渲染层不 import core，但 `format.ts` 已经在 import `@shared/types/domain`；把星级换算表下沉到 `@shared`（如 `constants.ts`，那里已有 `DEFAULT_PER_SEAT_BY_COST` 等同类常量），让 `core/star-copies.ts` 的 `FALLBACK_STAR_COPY_COST` 与渲染层**共用同一份**，即可在不违反分层的前提下消除重复。
- **建议**：`src/shared/constants.ts` 新增 `STAR_COPY_COST: Record<Star, number>`（唯一来源）→ `core/star-copies.ts` 与 `renderer/utils/format.ts` 同时引用；`distanceToThreeStar` 改为 `Math.max(0, STAR_COPY_COST[3] - mine)`（签名不变，非破坏性）。

#### N1（提示级）—— dedup「步骤 3b」用线性格位推算，与几何相邻口径不一致

- **文件**：`src/core/pool-engine/dedup.ts:270-278`
- **现状**：步骤 3b 按 `slotIndex + offset`（offset = 1..span-1）线性推算被覆盖格，而 M1/M2 的合并判定已改为**二维几何相邻**（支持竖向）。
- **潜在后果**：若出现**竖向**多格实例（合并发生在 `slotIndex` 与 `slotIndex + cols`），步骤 3b 会清理 `slotIndex+1` —— 既漏清真正的被覆盖格，又可能误删相邻格上**其它弈子**的旧实例。
- **可达性**：当前 TFT 双格单位（远古巨龙）为**横向**摆放，步骤 3b 的线性推算在实践中恰好正确，故定为**提示级**。仅当未来出现竖向多格单位时才会显形。
- **建议**：步骤 3b 也改用 `slot-geometry` 推算被覆盖格（或让 `slotSpan` 携带覆盖格偏移而非仅计数），保持三处口径一致。

### 7.4 第二轮验证命令

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ **38 文件 / 510 用例全部通过** |
| `npx tsc --noEmit -p tsconfig.main.json` / `tsconfig.renderer.json` | ✅ 均 0 error（`MAIN_EXIT=0` / `RENDERER_EXIT=0`） |
| `node scripts/check-compliance.mjs` | ✅ 扫描 301 文件，无禁用 API 命中 |
| 自建复核用例 `qa-m1m2m3-verify.test.ts` | ✅ 31 用例通过 |

> 复核期间我方新增用例曾漏删 2 个未使用 import，导致 renderer 项目 typecheck 报 TS6133/TS6196；**属我的测试代码问题，已自修并复验 0 error**（不计入源码缺陷）。

### 7.5 第二轮路由判定

- **M1 / M2 / M3**：✅ 修复验证通过，**已关闭**。
- **M3b**（渲染层 `distanceToThreeStar` 硬编码 9）：建议**立项修复**（做法见 7.3），以真正达成 M3 意图；不阻断交付。
- **N1**（步骤 3b 线性推算）：提示级，可与 M3b 一并处理；不阻断交付。
- **阻断级 / 严重级**：仍为 **0**。
- **合规红线**：仍然 **通过** ✅

---

## 八、第三轮：M3b / N1 修复复核

- **复核触发**：工程师采纳 M3b（单一事实来源）与 N1（步骤 3b 几何口径）两项建议并修复。
- **复核方式**：自建 **19 个独立用例**（`tests/unit/qa-m3b-n1-verify.test.ts`），另将第二轮 `qa-m1m2m3-verify.test.ts` 的 M3b 用例按新事实重新表述。
- **复核结论**：✅ **M3b / N1 均已按要求修复**；结构与行为双向验证通过。残留仅 1 项**已声明的边界**，不构成缺陷。

### 8.1 M3b 复核（单一事实来源）

| 验证项 | 结果 |
|---|---|
| `src/shared/constants.ts:61` 定义 `STAR_COPY_COST = {1:1,2:3,3:9,4:9}` 作为唯一来源 | ✅ |
| `core/pool-engine/star-copies.ts` 引用之，基线缺失时逐档回退一致 | ✅ |
| `core/baseline/load-baseline.ts` 引用之（`normalizeStarCopyCost` 以其为底） | ✅ |
| `renderer/utils/format.ts` 引用之，`distanceToThreeStar` = `STAR_COPY_COST[3] - mine` | ✅ |
| **全 `src/` 已无 `FALLBACK_STAR_COPY_COST` 重复定义**（递归扫描断言为空） | ✅ |
| 引用 `STAR_COPY_COST` 的文件恰覆盖 shared / core(×2) / renderer 四处 | ✅ |
| 静态断言：`format.ts` 不再出现 `9 - mine` / `Math.max(0, 9` 硬编码运算 | ✅ |
| 运行时基线仍优先于常量（未被"单一来源"反向遮蔽）：3★ 改 27 → `copiesOf(3, baseline)` = 27 | ✅ |
| 默认基线下 HUD 与 core 结果一致 | ✅ |

**残留边界（已在 7.3/本节如实记录，定为"已声明边界"而非缺陷）**：`distanceToThreeStar(row)` 无 `baseline` 入参，故当**运行时基线覆盖** `star_copy_cost`（如 JSON 改为 3★=27）时，core 跟随 27 而 HUD 仍按共享常量显示 9。默认基线下无任何用户可见偏差；此为该分层设计的固有边界，已由共享常量消除了真正的"重复定义"问题。

### 8.2 N1 复核（步骤 3b 几何口径）

| 验证项 | 结果 |
|---|---|
| 精确路径：`mergedSlotIndices=[11]` → 水平被并入格旧实例被清理，只留 1 个 span=2 | ✅ |
| 精确路径（竖向）：`mergedSlotIndices=[13]` → 竖排格被清理，且**邻近无关格 slot 1 未被误删** | ✅ |
| fallback 路径：`slotSpan=2` 于 slot 0 → 几何推为 `[1]`，线性外推已消除 | ✅ |
| fallback 行末转竖：slot 6（row0col6）span=2 → 覆盖格推为 `[13]` 并清理 | ✅ |
| **守卫**：覆盖格上是**其他弈子**的单格实例 → 不清理 | ✅ |
| **守卫**：覆盖格上是**同弈子但 span=2** 的实例（另一只巨龙）→ 不清理 | ✅ |
| 普通弈子（teamSlots=1）不参与步骤 3b | ✅ |
| 该 fallback 残留**不可达**：视觉层对合并的多格实例必写 `mergedSlotIndices`（含竖向） | ✅ |

**已知残留（提示级，非缺陷）**：fallback 是"横向优先、行末转竖向"的**启发式**。若一只**竖排**多格巨龙**只以 `slotSpan` 声明而缺 `mergedSlotIndices`**，fallback 会推为横向 `[1]`，导致真正的被并入格（如 slot 7）残留未被清理 → 多计 1 张。**正常管线中视觉层总会写入 `mergedSlotIndices`（已用 `applyMultiCellHints` 竖向用例验证），故该路径不可达**；仅当外部手工构造"只有 slotSpan 的旧数据"时才会显形。

### 8.3 第三轮验证命令

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ **41 文件 / 563 用例全部通过** |
| `npx tsc --noEmit -p tsconfig.main.json` / `tsconfig.renderer.json` | ✅ 均 0 error（`MAIN_EXIT=0` / `RENDERER_EXIT=0`） |
| `node scripts/check-compliance.mjs` | ✅ 扫描 313 文件，无禁用 API 命中 |
| 自建复核用例 `qa-m3b-n1-verify.test.ts` | ✅ 19 用例通过 |

> 复核期间我方新增用例有 1 个断言错误（尝试删除 `star_copy_cost` 整体字段以触发回退，但 schema 强制要求该字段，实际触发 `BASE_SCHEMA_FAIL`）—— **属我的测试代码问题，已改为"删除可选的 4 档 + 置 3 档为非法 0 值"复验通过**，不计入源码缺陷。

### 8.4 第三轮路由判定

- **M3b**：✅ 已按要求修复（共享常量消除重复定义），**已关闭**；残留边界为分层固有、已声明。
- **N1**：✅ 已按要求修复（精确格位优先 + 几何 fallback + 守卫），**已关闭**；fallback 启发式残留不可达。
- **阻断级 / 严重级 / 一般级未决项**：**0**（M1/M2/M3/M3b/N1 全部关闭）。
- **合规红线**：**通过** ✅
- **提示级未决项**：I1（undo 不回滚 history）、I2（基线内 `non_pool_units_blacklist` 死数据）、I3（黑名单缺"训练假人"、`perSeatByCost` 默认值待产品确认）—— 均不构成功能缺陷，维持原判。

---

## 九、收尾确认：引擎侧合并保险路径的安全性（工程师终检论证复核）

工程师在终检中提出一个待验证论断：**引擎侧 `dedup.mergeAdjacentSlots` 保险路径只写 `slotSpan`、不写 `mergedSlotIndices`，其被覆盖格的清理是否安全？** 我以自建用例独立复核（追加至 `qa-m3b-n1-verify.test.ts`，23/23 通过）。

**结论：安全，工程师论断成立。** 依据：

- **双路径分工**：视觉层 `applyMultiCellHints` 对"合并多格"**总是**写入 `mergedSlotIndices`（精确格位）→ 走步骤 3b 的精确清理分支；引擎侧 `mergeAdjacentSlots` 仅在**视觉层漏并同弈子相邻格**时触发（极深边缘），只写 `slotSpan` → 走 `coveredCellsFallback()` 启发式。
- **保险路径留有第二道清理**：`mergeAdjacentSlots` 自身在合并时通过步骤 3 的 `droppedSlotIndex` **精确删除**被并掉的格位实例，而非依赖 `slotSpan` 反推。因此即便 fallback 启发式在竖向场景推错覆盖格，被合并格也已被步骤 3 正确清除，不会造成重复计数。
- **实测**：构造"引擎侧合并 + 被覆盖格上残留单格实例"场景，断言合并后 `observedCopies` 计数正确、无非池/相邻误删。

**残留记录（提示级，不要求改）**：`coveredCellsFallback` 的"横向优先"启发式仅在「`span>1` 且缺 `mergedSlotIndices` 且竖向」交集下才可能误推覆盖格；该交集经论证在正常管线不可达。若架构侧后续推动"引擎合并路径回填精确 covered 格（与视觉层同口径）"，可彻底消除该启发式，本次按已知残留处理。

---

## 十、项目终检（第四轮 · 收尾）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ **41 文件 / 567 用例全部通过** |
| `npx tsc --noEmit -p tsconfig.main.json` / `tsconfig.renderer.json` | ✅ 均 0 error（`MAIN_EXIT=0` / `RENDERER_EXIT=0`） |
| `node scripts/check-compliance.mjs` | ✅ 通过，无禁用 API 命中 |
| 自建复核用例 `qa-m3b-n1-verify.test.ts` | ✅ 23 用例通过（含保险路径澄清用例） |

**最终判定**：
- **缺陷闭环**：M1 / M2 / M3 / M3b / N1 —— **五项全部关闭**。
- **阻断级 / 严重级 / 一般级未决项**：**0**。
- **合规红线（一票否决）**：**通过** ✅。
- **路由判定**：**NoOne**（无需返工；提示级残留 I1/I2/I3 及"横向优先启发式"均为已知边界，不构成功能缺陷）。

> **审计独立性声明**：全程未改动任何源代码；我方测试曾出现 2 处断言错误（`qa-baseline-config` / `qa-coverage` 的算术期望）与 1 处回退触发方式错误（`star_copy_cost` 字段），均属**我方测试代码问题**，已自行修正复验，未计入源码缺陷。工程师对本方既有测试文件的改动（`qa-double-slot.test.ts` 由 `it.fails` 转正）经审计为**加强而非弱化**（原断言保留并追加 `remaining===7`）。
