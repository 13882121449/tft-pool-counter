# TFT 牌库剩余计数器（tft-pool-counter）

Windows 桌面悬浮窗工具：基于**屏幕像素只读 + 本地图像识别**，实时估算云顶之弈（TFT）Set 18
「自然之力」各弈子的**牌库剩余数**，帮助玩家决定"继续 D 还是止损转型"。

> ⚠️ 本工具显示的是**基于可见信息的剩余数估算**，不是游戏内部真实牌库值。
> UI 永久显示覆盖率与"估算"字样（PRD 6.4 产品承诺）。

---

## 合规声明（最高优先级）

本工具**只做屏幕像素读取 + 图像识别 + 本地计数**，与 Overwolf 平台上 MetaTFT / Blitz 等
只读辅助插件同属一类。

**明确不做**：

| # | 禁止项 |
| --- | --- |
| X1 | 读取 / 写入游戏进程内存 |
| X2 | DLL 注入 / 进程内 Hook |
| X3 | 模拟鼠标 / 键盘输入（含自动切换巡查视角） |
| X4 | 修改游戏文件 / 资源包 |
| X5 | 拦截 / 修改 / 伪造网络数据包 |
| X6 | 自动化游戏决策与操作 |
| X7 | 绕过反作弊 / 隐藏自身进程 |
| X8 | 上传用户游戏画面或对局数据（100% 本地完成） |

代码层面由 ESLint 合规红线规则 + `docs/COMPLIANCE-CHECKLIST.md` +
`src/shared/forbidden-apis.md` 三道防线保证，运行 `npm run lint` 与
`npm run lint:compliance` 可自查。

---

## 快速开始

### 0. 环境准备（Windows + 国内网络）

```bash
# 使用 Node >= 20（本项目开发用 managed v22.22.2）
node -v

# 先配镜像，否则 electron / sharp / node-screenshots 的二进制下载会卡住
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set sharp_binary_host https://npmmirror.com/mirrors/sharp
npm config set sharp_libvips_binary_host https://npmmirror.com/mirrors/sharp-libvips
```

### 1. 安装依赖

```bash
npm install
```

> `node-screenshots` / `sharp` 若安装失败，程序仍可运行：捕获层自动降级为
> Electron `desktopCapturer`，识别层退化为纯 JS，能力自检会如实上报（ADR-01 双后端）。

### 2. 开发运行

```bash
npm run dev        # Vite + esbuild watch + Electron
```

> 若「窗口起不来但也不报错」，检查是否设置了 `ELECTRON_RUN_AS_NODE`
> （此时 `electron.exe` 会被当作纯 Node 执行）。
> 用 `env -u ELECTRON_RUN_AS_NODE npm run dev` 启动。

### 3. 首启引导（必做）

1. **合规门禁**：确认「只读屏幕像素」的能力边界；
2. **环境自检**：若是「独占全屏」，请改成「无边框全屏」，否则悬浮窗会被游戏覆盖、截屏可能黑帧；
3. **棋盘标定**：对照当前画面微调棋盘 4×7 与备战席 8 槽的归一化边界，保存即下发给识别进程。

### 4. 建模板库（识别准确率的关键）

`设置 → 素材`：停在游戏一局画面上 →「采集当前画面」→ 逐格指派弈子 →「保存到用户模板库」。
模板全部来自用户本地截图，**不内置任何图鉴站素材**（版权合规）；支持 zip 导入 / 导出跨机迁移。

### 5. 阵容推荐（HUD「阵容」页）

HUD 里有「牌库 / 阵容」两个视图切换。切到「阵容」后，工具会基于**我已有的牌**与
**全场剩余牌库**实时给出：

- **可成型阵容 TOP 3**：以一条「主线羁绊」为核心组织阵容，评分维度为
  可得性 40%（按缺口张数加权的悲观剩余）/ 已有进度 30% / 主线深度 20% / 费用质量 10%；
- 每个成员直接列出「有 N 张 / 差 N 张 / 牌库剩 N」，并标注可得性状态（正常 / 紧张 / 无货）；
- **追卡建议**：手上已经投了钱的牌，判定为「可追 / 观望 / 止损」并给出理由。

> **为什么不做「强度榜单」**：强度数据会随版本过时，且必须依赖外部数据源；
> 而「这套阵容现在到底凑不凑得出来」只有拿到全场剩余牌库才算得准 —— 这是本工具独有的优势。
> 评分只用于**同一次快照内的相对排序**，不代表绝对强度。

> **误差声明**：推荐继承牌库快照本身的误差（未侦察到的玩家、两次扫描之间的买入卖出），
> 因此面板顶部永远显示覆盖率与估算声明。**不要当成确定性结论。**

- 引擎（纯函数，可单测）：`src/core/recommender/`
- 展示层：`src/renderer/components/hud/LineupPanel.tsx`、`ViewTabs.tsx`

> 主线之外的一个副产品：这一步顺带修掉了 dedup 里「多格弈子旧槽位残留导致重复计数」的缺陷 ——
> `coveredCellsFallback` 此前是**死代码**（写了但从未被调用），现在已接线，
> 远古巨龙这类占 2 格却只消耗 1 张的弈子不会再被算成 2 张。

### 6. 常用命令

```bash
npm run typecheck        # tsc（main + renderer）零错误
npm test                 # vitest 全量单测
npm run lint             # ESLint（含合规红线规则）
npm run lint:compliance  # 全仓禁用 API grep（第二道防线）
npm run build            # esbuild(main/preload/worker) + vite(renderer)
npm run make:templates   # 生成 65 张占位模板
```

---

## 架构索引

| 文档 | 内容 |
| --- | --- |
| `docs/PRD.md` | 产品需求（许清楚） |
| `docs/ARCHITECTURE.md` | 系统架构与任务分解（高见远） |
| `docs/class-diagram.mermaid` | 类图 |
| `docs/sequence-diagram.mermaid` | 时序图 |
| `docs/COMPLIANCE-CHECKLIST.md` | 合规红线逐条审查清单 |
| `src/shared/forbidden-apis.md` | 禁用 API 清单 |

### 分层

```
src/shared  → 三方共享类型 / 常量 / 数学工具（禁止 electron、node 依赖）
src/core    → 纯函数核心：卡池基线 + 牌库引擎 + 台账 + 阵容推荐（零依赖，100% 可单测）
src/vision  → Utility Process：截屏 + CV 识别（独立进程，不阻塞 UI）
src/main    → 主进程：窗口 / 调度 / IPC / 持久化（唯一权威状态源）
src/renderer→ 渲染进程：HUD / 设置 / 校正 / 引导（React + Tailwind + MUI）
data        → 卡池基线等外部数据源（禁止把池总数硬编码进代码）
```

### 路径别名（5 处同步）

`@shared/*`、`@core/*`、`@vision/*`、`@main/*`、`@renderer/*` 在
`tsconfig.base.json`、`vite.config.ts`、`scripts/build.mjs`（esbuild）、
`vitest.config.ts`、`.eslintrc.cjs` 中保持一致。

---

## 任务进度

| 任务 | 内容 | 状态 |
| --- | --- | --- |
| T01 | 项目基础设施与共享契约 | ✅ |
| T02 | 核心纯函数层：卡池基线 + 牌库引擎 + 台账 | ✅ |
| T03 | 视觉识别 Worker（截屏 / 几何 / 匹配 / 流水线 / 采集向导） | ✅ |
| T04 | 主进程：窗口 / 调度 / IPC / 持久化 / 自检 | ✅ |
| T05 | 渲染层 UI：HUD / 设置 / 校正 / 引导 | ✅ |

> 识别准确率专项验收待用户提供真实游戏截图（3 分辨率 × 20 张）后开展。
>
> ### 真机运行时验证（2026-09-15 通过）
>
> 用 CDP 探针连上**真实运行**的渲染进程取证，不是静态推断：
>
> | 验证项 | 实测结果 |
> | --- | --- |
> | 进程与窗口 | 三窗口创建成功，HUD `340×640` full 模式 |
> | 基线加载 | 65 个弈子，实际读取 `data/pool-baseline.json` |
> | 视觉进程 | `dist/vision/worker.js` 独立进程拉起成功 |
> | preload 桥 | `window.api` 可用（`hasApi: true`） |
> | 主进程 handler | 返回 65 行快照，`setNumber 18`，巡查 `0/8`，首帧=全部池总数 |
> | DOM 渲染 | 标题 /「估算」合规文案 / `S18` 徽标 / 「牌库·阵容」切换 / 巡查进度 均正常 |
> | 阵容推荐面板 | 切换后可渲染，3 条推荐 + 成员「有/差/剩」明细，**页面错误 0** |
> | 调度器 | 无棋盘时正确转入探测模式（每 ~4.5s 重试） |
>
> 复现命令：
> ```bash
> env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe . \
>   --disable-gpu --disable-gpu-sandbox --remote-debugging-port=9222
> node scripts/probe-runtime.mjs 9222
> ```
> （**不要加 `--no-sandbox`**，会让 Electron 更早起不来；不加 `--disable-gpu-sandbox`
> 会 `FATAL: GPU process isn't usable`。）
>
> 仍需用户本机确认：**窗口的视觉呈现与操作手感**（沙箱内无可见桌面）、
> **真实游戏画面下的识别准确率**（缺样本）。

---

## 变更记录（变更请求：T02 审计 3 项一般级缺陷）

来源 `docs/QA-REVIEW-T02.md`（严过关）。均已修复并回归：

| 编号 | 问题 | 修复 |
| --- | --- | --- |
| M1 | 双槽位「相邻」用**线性索引**判断，跨行边界（`row1col6` 与 `row2col0`）被误合并 | 新增 `src/core/pool-engine/slot-geometry.ts`，`dedup.mergeAdjacentSlots` 与 `rules/double-slot.rule` 改为**水平/垂直二维相邻**；`boardCols/benchCols` 经 `computeRemaining` / `applyScan` 从标定透传（缺省 7/8/5） |
| M2 | `slotSpanHint` 契约未接线，`ObservationRecord.slotSpan` 从不产出 | 新增 `src/vision/match/multi-cell.ts`：识别层在裁决后按 `teamSlots` + 几何相邻合并多格观测并写 `slotSpan`；`pipeline` 经 `deps.teamSlots` 接线（引擎侧合并保留为第二道保险） |
| M3 | `copiesToThreeStar` 硬编码 9 | 签名改为 `copiesToThreeStar(row, baseline?, mySeat=0)`，内部改用 `copiesOf(3, baseline)`（回退兜底表） |
| M3b | 换算表分散在 3 处（`star-copies` / `load-baseline` 各自 `FALLBACK_*`、`format.distanceToThreeStar` 写死 9），HUD「差 N 张」文本仍硬编码 | 单表下沉到 `src/shared/constants.ts` 的 `STAR_COPY_COST` 作为**唯一来源**；`star-copies` / `load-baseline` / `renderer/utils/format` 全部改引用它，HUD 文本端到端生效 |
| N1 | 去重步骤 3b 按**线性** `slotIndex + offset` 推算被覆盖格，与二维相邻口径不一致（竖排多格会漏清/误删） | 观测携带 `mergedSlotIndices`（精确格位）时按精确格清理；缺失时用 `coveredCellsFallback()` 走 `slot-geometry` 几何推算（水平优先、行末转竖，每步二维校验） |

> 提示级 I1/I2/I3 经评估为**不构成功能缺陷**，按产品口径暂不修改（详见审计报告）。
> 复核回归（本机）：`npm run typecheck`（main + renderer）0 error；`vitest run` 40 文件 / 544 用例全绿；`lint:compliance` 扫描 312 文件 0 命中；`eslint` 0 warning。

