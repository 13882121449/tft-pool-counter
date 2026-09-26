# QA 终审报告 —— 独立验证与挑刺式审计（QA-REVIEW-FINAL）

- **审计人**：严过关（Yan），QA 工程师（software-qa-engineer-2，**独立第二复核**）
- **审计对象**：`tft-pool-counter` 全量交付（`src/core`、`src/vision`、`src/main`、`src/preload`、`src/renderer`、`data/`、`scripts/`）
- **审计日期**：2026-09-14
- **审计基线**：`data/pool-baseline.json`（Set 18，65 弈子，30/25/18/10/9，CONFIRMED=false）
- **审计方法**：**不信任前序结论，从零独立复核** —— 源码逐行 + 独立构造边界用例（`tests/unit/qa2-*.test.ts`，6 文件 / 61 用例）+ 独立运行合规脚本 / 类型检查 / 全量测试 / 覆盖率 + 全仓 grep
- **前序审计**：`docs/QA-REVIEW-T02.md`（严过关 / T02 轮次）—— 本报告对其结论做**独立复现**，并**新增 2 项前序未发现的问题**
- **路由判定**：**Source → Engineer**（M1/M2/M3 三项「一般」级，前序已报，本轮复现确认）；**Tooling → 已由 QA 自修**（N1 合规门禁回归）；**阻断级 0**

---

## 一、结论速览

| 维度 | 结果 |
|---|---|
| 合规红线（一票否决） | ✅ **通过**（脚本扫描 290 文件 0 命中；独立 grep 亦 0 命中） |
| 合规门禁可运行性 | ⚠️ **曾回归**：`lint:compliance` 被前序 QA 文档打红（退出码 1 / 20 命中）→ **已修复**（见 N1） |
| 2.1 幂等端到端链路 | ✅ 正确（同扫描 apply 3 次不变；换牌覆盖；pipeline↔core 契约一致） |
| 2.2 降级路径 | ✅ 正确（optional 模块缺失不抛；全后端失败返回错误对象；运行期自动降级重试） |
| 2.3 几何缩放 | ✅ 正确（scaleFactor 1/1.25/1.5/2 归一化坐标不漂移；28+8 槽不越界） |
| 2.4 引擎边界 | ✅ 正确（星级 1/3/9 含 3★；溢出 clamp + 标记；基数可配置无硬编码；淘汰回池；撤销栈 LIFO） |
| 2.5 IPC 契约 | ✅ preload↔main 无悬空；⚠️ 2 个死通道（N2，非阻断） |
| baseline 数据契约 | ✅ 65 id 唯一、费用档 14/13/14/14/10、池总数自洽 |
| 全量测试 | ✅ **32 文件 / 430 用例全部通过**（新增 QA2 61 用例） |
| `src/core` 覆盖率 | ✅ 语句 96.92% / 分支 85.71% / 函数 100%（门槛 90/80/90） |
| typecheck | ✅ main / renderer 均 0 error |
| 阻断级缺陷 | **0** |
| 严重级缺陷 | **0** |
| 一般级缺陷 | **4**（M1/M2/M3 复现 + N1 本轮新发现）|
| 提示级 | **3**（N2 死通道 + I2 双源黑名单 + I3 默认悲观参数）|

---

## 二、合规红线审计（最高优先级，一票否决项）

**结论：✅ 通过。全仓不存在任何进程内存读写 / 进程注入 / 输入模拟 / 截图外传 的实现或依赖。**

### 2.1 官方脚本（独立运行）

```
$ node scripts/check-compliance.mjs
[compliance] ✅ 通过：扫描 290 个文件，无禁用 API 命中。   （exit 0）
```

### 2.2 独立 grep（不依赖脚本白名单）

- 对 `src/` 检索 `OpenProcess|ReadProcessMemory|WriteProcessMemory|VirtualAllocEx|CreateRemoteThread|NtReadVirtualMemory|SetWindowsHookEx|SendInput|keybd_event|mouse_event|robotjs|ffi-napi|memoryjs|nut-js|node-key-sender|koffi|winax` → **唯一命中为 `src/shared/forbidden-apis.md`（禁用清单本身，白名单）**，其余 0。
- 对 `src/` 检索网络/进程能力 `axios|XMLHttpRequest|WebSocket|node:http|node:https|require('http…|child_process|node:net|node:dgram|node:tls` → **0 命中**。
- 对 `src/` 检索 `https?://` → **0 命中**。
- `scripts/dev.mjs:20/63` 的 `fetch` 仅指向 `http://localhost:5173`（dev 模式 Vite 探活），不在 `src/`、不入产物 → 合规。

### 2.3 依赖清单（`package.json`）

- `dependencies`：`@emotion/*`、`@mui/*`、`@tanstack/react-virtual`、`@techstark/opencv-js`、`ajv`、`electron-log`、`electron-store`、`jszip`、`node-screenshots`、`react`、`react-dom`、`sharp`、`zustand`
- 无 `robotjs` / `ffi-napi` / `memoryjs` / `nut-js` / `node-key-sender` / `koffi` 等任何违规包；`optionalDependencies` 为空。
- `node-screenshots`（原生截屏）、`sharp`（图像处理）、`@techstark/opencv-js`（WASM OpenCV）均为**本地只读像素处理**库，符合 PRD「只读取屏幕像素」的产品边界。

> **合规判定：无阻断级问题。产品在"仅读屏、不注入、不模拟、不外传"的红线内成立。**

---

## 三、端到端正确性验证（2.1–2.6）

新增独立测试 `tests/unit/qa2-*.test.ts`（61 用例）对应用例全部通过。

### 2.1 幂等链路 ✅
- 同一条 `ScanResult` 连续 `applyScan` 3 次 → 台账与 65 行剩余数**逐字段一致**；同 `scanId` 不累加 `scanCount`，异 `scanId` 才 +1。
- 同槽位换牌：旧弈子回池、新弈子入账（槽位覆盖，非事件累加），该家槽位数恒为 1。
- `applyScan` 纯函数：不修改入参 state。
- pipeline↔core 契约：输出 65 行且顺序严格等于 `baseline.champions`；`Σ bySeat == observedCopies`。

### 2.2 降级路径 ✅
- `tryImport('不存在的模块')` → `{ok:false, module:null}`，**不抛异常**；`tryImport('node:path')` → `ok:true`。
- 首选后端不支持 → 自动选下一个可用后端并标 `degraded=true`。
- **全后端不可用 → `capture()` 返回错误对象（`CAP_BACKEND_UNAVAILABLE`）而非抛异常**。
- 运行期连续失败达阈值（默认 3，可配置）→ 自动切回退后端并立即重试成功。
- `isSupported()` 抛异常被吞掉视为不可用（不崩）。
- 默认管理器后端顺序 = `node-screenshots → desktopCapturer`。

### 2.3 几何缩放 ✅
- `scaleFactor ∈ {1, 1.25, 1.5, 2}` 下，归一化槽位坐标保持不变（仅物理像素等比放大）；`geometry.screen.scaleFactor` 正确记录。
- 棋盘 4×7 = 28 槽 + 备战席 8 槽 = 36，全部 `x≥0 / y≥0 / x+w≤W / y+h≤H`，互不越界、无重叠。
- **累积取整**：每行最后一格右边缘 == 标定矩形右边缘，末槽与矩形右缘贴齐（无误差累积）。

### 2.4 引擎边界 ✅
- 星级换算来自基线：1★=1 / 2★=3 / 3★=9 / 4★=9；`starFromCopies(9)=3`、`(18)=4`。
- 3★ 恰好耗尽 5 费池（9 张）→ `remaining=0, overflow=0`，**不误报** `OVERFLOW_DUPLICATOR`。
- 溢出（18 > 9）→ `remaining` clamp 0、`overflow=9`、打 `OVERFLOW_DUPLICATOR`，守恒 `remaining − overflow = pool − observed`；65 行全溢出无负值。
- **卡池基数可配置**：`poolTotal=100` 后 remaining 随之为 100；切 22/20/17/10/9 后 1 费池 28→22 结果正确变化；`starCopyCost[3]=4` 后 3★ 只计 4 张 → 证明**读数据、无硬编码**。
- 淘汰语义：淘汰家持有归零、回池、仍计入覆盖率。
- 撤销栈：LIFO 精确回滚（槽位/状态一致）；容量 50 超限按 FIFO 丢弃。

### 2.5 IPC 契约（三方一致） ✅/⚠️
- `channels.ts`（唯一常量处）声明常量数 == `ALL_CHANNELS` 长度，无重复，命名符合 `domain:action`。
- **preload 调用的每个通道都在 main 注册**（0 悬空 invoke）；main 注册的每个通道都在 `channels.ts` 声明（0 裸字符串）；preload 订阅的推送通道均已声明。
- ⚠️ 发现 2 个「死通道」`pool:get-rows` / `pool:coverage`（见 N2）。

### 2.6 baseline 数据契约 ✅
- 65 弈子、id 全局唯一、顺序与原始 JSON 一致；费用档 14/13/14/14/10 与声明一致。
- 每弈子 `poolTotal == copies_per_champion`；`tierTotal == copies × distinct`；`starCopyCost={1,3,9,9}`。
- `setNumber=18`、`schemaVersion=1.0`、`confirmed=false` 与原始文件一致。
- `elderdragon`（teamSlots=2 / poolCopiesConsumed=1）、`lux`（sharedPoolNote）元数据齐全；traits↔traitsCn 一一对应。
- 非池黑名单非空、与 `data/non-pool-units.json` 数量一致、不含任何合法弈子 id。

> **未能验证（见第七节）**：2.6 中的"真实截图识别准确率""UI 关键交互（校正后不被动摇 / 巡查进度 x/8 / 低置信高亮阈值）"需真机 GUI 与真实对局样本，本轮无法动态验证，仅做代码核对。

---

## 四、发现的问题（分级）

### 🔴 新增发现（前序 T02 报告未提及）

#### N1.（一般级，已由 QA 自修）合规门禁被审计文档打红 —— `lint:compliance` 回归

- **现象**：`npm run lint:compliance` → **退出码 1**，报 20 处命中。
- **根因**：`scripts/check-compliance.mjs` 的 `WHITELIST` 仅含 `PRD/ARCHITECTURE/COMPLIANCE-CHECKLIST/HANDOVER`，**未含 QA 审计报告**；而 `docs/QA-REVIEW-T02.md` 为"证明不存在而逐项引用了禁用字样"，被脚本逐条命中。即：**QA 自己的交付物使项目的合规自检失败**。
- **影响**：若 CI 接入 `lint:compliance`，交付门禁将红；与"合规红线通过"的结论自相矛盾。
- **处置**：合规守卫属 QA 职责域（非业务源码），已将 `docs/QA-REVIEW-T02.md`、`docs/QA-REVIEW-FINAL.md` 加入 `scripts/check-compliance.mjs` 白名单。修复后复跑 → `✅ 扫描 290 文件 0 命中（exit 0）`。
- **复核建议**：请 team-lead/Engineer 确认该白名单修改可接受；或改为"审计文档统一置于白名单目录"。

#### N2.（提示级）IPC 死通道 `pool:get-rows` / `pool:coverage`

- **文件**：`src/shared/ipc/channels.ts:16-17`（声明 + 列入 `ALL_CHANNELS`）
- **现象**：两通道既**未在 `src/main/ipc/*` 注册 handler**，也**未在 `src/preload/index.ts` 暴露**（`grep` 全仓仅命中 `channels.ts` 自身）。
- **影响**：渲染层无法调用（未暴露）→ **无运行影响**；属契约冗余/潜在误导（后续若有人误用 `invoke` 将永远挂起）。建议删除或补齐 handler。
- **证据**：新增用例 `qa2-ipc-contract.test.ts` 已将其固化记录，防止悄悄变化。

### 🟡 复现确认前序偏差（Source → Engineer）

#### M1.（一般级）双槽位"相邻"判定用线性索引，未按架构要求的水平/垂直几何
- **文件**：`src/core/pool-engine/rules/double-slot.rule.ts:50`、`src/core/pool-engine/dedup.ts:172`（均用 `slotIndex === last.endSlot / current+span`）。
- **架构依据**：`docs/ARCHITECTURE.md:236` 明确"**水平/垂直相邻**且 id+star 相同的槽位合并"。（注：PRD RQ-04 只要求"按单位实例而非格子计数"，未规定几何口径 —— 故这是**实现 vs 架构**的偏差，非 PRD 违约。）
- **实际**：7 列棋盘上 `row1col6(13)` 与 `row2col0(14)` 线性相邻但空间不相邻，会被误合并为 1 只 → 3★ 时最多少算 9 张。**真实巨龙为水平相邻（索引差 1），可被正确合并**；触发条件需"两只独立巨龙恰好跨行边界" → 稀有，定「一般」。
- **复现**：`tests/unit/qa-double-slot.test.ts` 的 `it.fails` 用例 + 新一轮 `qa2` 亦确认合并逻辑为线性。

#### M2.（一般级）`slotSpanHint` 契约未接线，`ObservationRecord.slotSpan` 从不产出
- **文件**：`src/vision/detect/slot-extractor.ts:54`（声明）、`:88`（硬编码 `slotSpanHint: 1`）。
- **实际**：全 `src/vision/` 仅此 3 处，**从未赋值为 2**；亦无任何地方写 `ObservationRecord.slotSpan`。故引擎中所有基于 `slotSpan` 的分支在真实链路恒为 1（等价死代码），双槽位合并**完全依赖线性相邻**，放大 M1 影响面。

#### M3.（一般级）`copiesToThreeStar` 硬编码 9
- **文件**：`src/core/ledger/selectors.ts`（`return Math.max(0, 9 - mine)`，签名 `(row, mySeat=0)` 不接 baseline）。
- **实际**：与 `star-copies.ts` 头注释"换算表必须来自 `PoolBaseline.starCopyCost`，禁止硬编码"相悖。当前 `starCopyCost[3]===9` 输出恰好正确，**暂无功能缺陷**；但基线调整 3★ 消耗后该文案会静默错误。

### 🟢 提示级（前序已列，复现确认）

- **I2**：基线内 `non_pool_units_blacklist.items` 是**中文描述字符串**，而 loader 读的是不存在的 `non_pool_unit_ids` → 永远回退到 `data/non-pool-units.json`（`DEFAULT_NON_POOL_UNIT_IDS`）。**基线内黑名单为死数据**。本轮 `qa2-baseline-schema.test.ts` 已用"黑名单数量 == non-pool-units.json units 数量"独立佐证。
- **I3**：`DEFAULT_PER_SEAT_BY_COST` 全档为 1，与 PRD Q7「4/5 费按每家 1 张、1–3 费按平均」表述略有出入（1–3 费悲观下界偏乐观）；架构 A7 已记为"待产品确认"，属已跟踪项。

---

## 五、新增 QA 测试清单（`tests/unit/qa2-*.test.ts`，6 文件 / 61 用例）

| 文件 | 用例 | 覆盖审计点 |
|---|---|---|
| `qa2-ledger-chain.test.ts` | 6 | 2.1 ScanResult→ledger→剩余数 幂等 3 连 / scanCount / 换牌覆盖 / 纯函数 / pipeline 契约 |
| `qa2-degradation.test.ts` | 8 | 2.2 tryImport 缺失不抛 / 全后端失败返回错误对象 / 运行期降级重试 / 后端顺序 / 异常吞并 |
| `qa2-geometry-scale.test.ts` | 16 | 2.3 scaleFactor 1/1.25/1.5/2 不漂移 / 28+8 不越界 / 累积取整贴边 / 无重叠 |
| `qa2-engine-boundary.test.ts` | 13 | 2.4 星级 1/3/9 含 3★ / 溢出 clamp+标记 / 基数可配置（无硬编码）/ 淘汰 / 撤销栈 LIFO+容量 |
| `qa2-baseline-schema.test.ts` | 11 | 65 id 唯一 / 费用档 14/13/14/14/10 / 池总数自洽 / starCopyCost / 特殊机制 / 黑名单 |
| `qa2-ipc-contract.test.ts` | 7 | 2.5 通道唯一性 / 命名规范 / preload↔main 无悬空 / main 无裸字符串 / 死通道记录 |

> **纪律**：**未修改任何已有测试与业务源码**；唯一改动的 `scripts/check-compliance.mjs` 为合规守卫白名单（见 N1）。

---

## 六、验证命令结果（本轮独立运行）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ **32 文件 / 430 用例全部通过**（含新增 61） |
| `npx vitest run --coverage` | ✅ `src/core` 语句 **96.92%** / 分支 **85.71%** / 函数 **100%**（门槛 90/80/90）；`star-copies` 100% |
| `npx tsc --noEmit -p tsconfig.main.json` | ✅ 0 error |
| `npx tsc --noEmit -p tsconfig.renderer.json` | ✅ 0 error |
| `node scripts/check-compliance.mjs` | ✅ 290 文件 0 命中（exit 0，修复 N1 后） |

---

## 七、路由判定

1. **源码偏差 → Engineer（software-engineer）**：**M1 / M2 / M3** 三项「一般」级（不阻断交付，建议随 T06/下一迭代修复）。已附文件 + 行号、期望 vs 实际、复现用例。**不由我修改源码**（遵守职责边界）。
2. **工具/合规 → QA 自修（已完成）**：**N1** 合规门禁回归 —— 已修 `scripts/check-compliance.mjs` 白名单并复跑为绿。请 team-lead 知情确认。
3. **测试代码问题 → QA 自修**：本轮**未发现**需修正的断言错误；前序 `qa-property.test.ts` 的双槽位求和口径问题在现版本已正确（已排除 `teamSlots>1` 弈子的朴素求和）。**未修改任何已有测试。**
4. **阻断级问题**：**无** —— 无需中断交付。

> **总体裁定**：全套交付**通过独立复核**。合规红线成立、引擎核心公式经独立构造 + 430 用例验证无误；M1/M2/M3/N1/N2 真实存在且可复现。**既不虚构问题，也不因"全绿"而放行 —— 上述偏差均给出行号与复现路径。**

---

## 八、审计边界与未能验证项（诚实声明）

- **未验证**：真实游戏截图下的**识别准确率**（需真实对局素材，当前无样本）—— 属视觉识别精度，超出可自动化验证范围。
- **未验证**：**UI 关键交互的运行时行为**（校正后数值不被动摇、巡查进度 x/8 不重复计数、低置信高亮阈值）—— 需 Electron 真机 GUI；本轮仅做**代码/契约层面**核对，未做 GUI 端到端。
- **未验证**：`node-screenshots` / `sharp` / `desktopCapturer` 的**真机截屏链路**（沙箱无 GUI 窗口）；降级逻辑以**注入式假后端**单测覆盖，未跑真实截屏。
- **可复现性**：所有随机化用例采用固定种子 LCG，结果 100% 可复现；`qa2-*` 断言均为确定性。
- **诚实提示**：本报告与 `docs/QA-REVIEW-T02.md` 均含禁用 API 字样的**逐项引用**（为证明其不存在），故两者已在合规脚本白名单中 —— 这是 N1 的成因，也是其修复。

---

# 九、修复后回归验收（M1 / M2 / M3） —— 第二轮

- **验收人**：严过关（QA-2），**聚焦回归验收**（非全量重审）
- **背景**：工程师已修复 M1/M2/M3；team-lead 复跑 36 文件 / 467 用例全绿
- **本轮独立新增**：`tests/unit/qa2-m1m3-regression.test.ts`（11 用例）→ 全量升至 **37 文件 / 478 用例全绿**
- **验收裁定**：**M1 ✅ 真实修复｜M2 ✅ 真实接线（占位字段删除 + 新模块）｜M3 ✅ 读基线**；新增测试**未发现无效断言**

## 9.1 M1 —— ✅ 修复真实（线性相邻 → 二维几何相邻）

- 新增 `src/core/pool-engine/slot-geometry.ts`（`isOrthogonallyAdjacent` / `toRowCol` / `colsForZone`）作为**单一事实来源**；`rules/double-slot.rule.ts` 与 `dedup.ts:mergeAdjacentSlots` **双双改为二维判定**。
- 几何列数已贯通：`RuleContext.zoneCols`、`ComputeRemainingOptions.geometry`、`ApplyScanOptions.geometry`、`DedupDeps.boardCols/benchCols/shopCols`，缺省回退 7/8/5。
- **独立复现（`computeRemaining` 端到端）**：
  - `13↔14`（跨行边界）**不合并** → observed=2、remaining=7 ✔（修复前为 1/8）
  - `6↔7`（跨行边界）不合并 ✔
  - 同行 `10↔11` 合并为 1 ✔；同列 `3↔10` 合并为 1 ✔
  - 备战席单行 `0↔1` 合并为 1 ✔；备战席↔棋盘不跨区合并 ✔
- **测试有效性**：`slot-geometry.test.ts`（11）与 `qa-double-slot.test.ts` 中 **`it.fails` 已转正为常规断言**；断言方向正确 —— 若实现回退到线性相邻，`13↔14` 用例必失败（非空测）。

## 9.2 M2 —— ✅ 实际修法 =「删除占位字段 + 真接线」（非仅删字段）

- **占位字段已删除**：`SlotSample.slotSpanHint`（原硬编码 1 的死字段）不再存在。
- **真接线**：新增 `src/vision/match/multi-cell.ts` 的 `applyMultiCellHints()` —— 识别层完成裁决后，依 `teamSlots` + 二维相邻，把同一只巨龙的多格观测并成一条并写 `ObservationRecord.slotSpan = 2`。
  - 已在 `src/vision/pipeline.ts` 第 **6.5 步**调用（传入 calibration 的 board/bench/shop 列数）；
  - `src/vision/worker-entry.ts` 由 `baseline.champions[].special.teamSlots` 构造 `teamSlots` 表并下传。
- **测试覆盖**：`multi-cell.test.ts`（7）覆盖 helper：水平/垂直相邻并、跨行边界不并、异星不并、非多格不受影响、空表原样返回、空观测忽略、不污染入参。
- ⚠️ **残留缺口**：**pipeline 第 6.5 步的集成点本身无端到端用例**（仅 helper 有单测）—— 列入未验证项。

## 9.3 M3 —— ✅ 修复真实（从基线读，非换址硬编码）

- `copiesToThreeStar(row, baseline?, mySeat=0)` 现为 `Math.max(0, copiesOf(3, baseline) - mine)`（缺省回退兜底换算表）。
- 工程师原有用例仅 `copiesToThreeStar(row)`（不传 baseline，无法证明读表）。**本轮补测**（`qa2-m1m3-regression.test.ts`）：
  - `starCopyCost[3]=12 → 差 10`；`=5 → 差 3`；缺省 → 7；持有 ≥ 需求 → clamp 0。
  - **结果随基线变化** ⇒ 确证读基线，非硬编码。

## 9.4 新增测试有效性抽查（挑刺结论）

- 抽查 `slot-geometry` / `multi-cell` / `qa-double-slot` / `double-slot.rule` / `ledger-store`(M3 段) 等新增用例：
  - 均为**对实际结果的断言**（非"仅断言 mock 被调用"）；
  - 断言方向与修复方向一致（回退即失败）；
  - 无恒为真的空测试。
- ✅ **未发现无效断言，无需自修。**
- 附带发现：工程师另修一处**启动流程回归** —— `LedgerRuntime.ensureSnapshot()` 改为只读，避免 `reset()` 抹掉刚才 `restore()` 的上一局台账；`ledger-runtime.test.ts`（6）配套且语义正确。

## 9.5 命令结果（本轮独立运行）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | ✅ **37 文件 / 478 用例全部通过**（含本轮 +11） |
| `npx tsc --noEmit -p tsconfig.main.json` | ✅ 0 error |
| `npx tsc --noEmit -p tsconfig.renderer.json` | ✅ 0 error |

## 9.6 仍未验证（诚实声明）

- **pipeline 第 6.5 步（多格合并接线）无端到端测试**（helper 已测，集成未测）。
- 其余同第八节：真实截图识别准确率、GUI 运行时时序交互、真机截屏链路。

