# TFT 牌库剩余计数器 — 阶段交接文档

> 生成时间：2026-09-15 12:50 (UTC+8)
> 生成人：主理人齐活林（Qi）· 交付总监
> 用途：因账号触发 429 频率限制导致工程师/QA 中断，本文档用于让下一个接手者**零背景**继续施工

---

## 0. 一句话现状

**核心大脑（牌库推算引擎 + 台账）已完成并通过 184 个单测；"眼睛"（屏幕识别）和"脸"（悬浮窗 UI）尚未开工。**

---

## 1. 进度总览

| 任务 | 内容 | 状态 | 说明 |
|------|------|------|------|
| T01 | 项目基础设施与共享契约（约 22 文件） | 已完成 | tsc 0 error，别名/通道/错误码/合规 ESLint 规则就绪 |
| T02 | 核心纯函数层：卡池基线 + 牌库引擎 + 台账（约 28 文件） | 已完成 | 184 测试全绿，`src/core` 覆盖率 96.71% |
| T03 | 视觉识别 Worker（约 28 文件） | **未开始** | 上一轮工程师在此处被 429 中断 |
| T04 | 主进程：窗口 / 调度 / IPC / 持久化（约 30 文件） | **未开始** | — |
| T05 | 渲染层 UI：HUD / 设置 / 校正 / 引导（约 30 文件） | **未开始** | — |

---

## 2. 中断原因与恢复时间

- 工程师与 QA 两个成员在同一时段各自被中断，报同一个错误：
  `429 您的使用量已超出频率限制，将在 2026-09-15 20:10:54 UTC+8 重置`
- **这是账号额度问题，不是代码或网络问题，重试无意义。**
- 恢复时间：**2026-09-15 20:10 (UTC+8)**。恢复后可直接接着做第 6 节的任务。
- 若需立即继续：在客户端切换到其他可用模型即可绕过。

---

## 3. 已交付资产清单（均在项目内，可直接使用）

```
D:\WorkBuddy Project\tft-pool-counter\
├── docs\
│   ├── PRD.md                     产品经理许清楚产出（38KB，含需求池 P0×11/P1×9/P2×5、UI 线框、卡池计算规则、10 类误差源、合规红线）
│   ├── ARCHITECTURE.md            架构师高见远产出（1300+ 行，8 条 ADR、137 项文件清单、4 张时序图、逐条验收标准）
│   ├── class-diagram.mermaid      类图
│   ├── sequence-diagram.mermaid   4 条时序图
│   └── HANDOVER.md                本文档
├── data\
│   └── pool-baseline.json         Set 18 卡池基线（65 弈子，CONFIRMED: false，见第 8 节）
└── src\ 等                        T01 + T02 共 50 个文件
```

---

## 4. 已验证的事实（可信，接手后无需重跑）

以下结论由主理人**独立复跑验证**过，不是工程师自报：

- `npx tsc --noEmit`：main / renderer 两份配置均 0 error
- `npx vitest run`：**12 个测试文件，184 个用例全部通过**（约 3.7s）
- `src/core` 覆盖率：statements 96.71% / branches 87.63% / functions 96.55% / lines 96.71%
- ESLint 合规规则生效：对 `OpenProcess` / `WriteProcessMemory` / `robotjs` / `ffi-napi` / `memoryjs` 报错

**算例实测值**（golden 已落盘 `tests/goldens/`）：

| 算例 | 场景 | 已观测 | 剩余 | 关键断言 |
|------|------|--------|------|----------|
| A | 维迦 | 11 | 19/30 | bySeat=[5,1,3,2,0,0,0,0]，覆盖 8/8 |
| B | 阿狸 | 9 | 1（悲观 0） | bySeat=[4,0,3,0,0,2,0,0]，覆盖 6/8；回滚后剩余回升至 4 |
| C | 艾希 | 10 | 0 | overflow=1，命中 flag `OVERFLOW_DUPLICATOR` |

**三个命门逻辑（本项目的正确性根基，均有独立测试）**：

1. **幂等**：同一 `ScanResult` 连续 `applyScan` 3 次，台账与剩余数完全不变。
   实现方式：台账用 `(seat, zone, slotIndex)` **槽位覆盖语义**，绝不做事件累加。
2. **卖回池**：先扫到"第 2 家有 2★ 阿狸（占 3 张）"，再扫到该槽为空且超过 TTL → 剩余数从 1 回升到 4。
3. **双槽位弈子**：同一帧中 2 个相邻槽位属于同一实例（远古巨龙类）→ 只计 1 张。

---

## 5. 环境坑（血泪经验，必读）

### 5.1 Bash 的 PATH 不完整
本机 Bash 直接敲 `ls` / `npm` 会报 `command not found`。**每条命令前先加这段前缀**：

```bash
export PATH="/c/Users/asus/.workbuddy/binaries/node/versions/22.22.2-3:/c/Users/asus/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/asus/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"
```

Node 用 managed 版 **v22.22.2**，npm **10.9.7**（不要用系统 Node）。

### 5.2 npm 镜像（务必先配，否则 native 包全挂）

```bash
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set sharp_binary_host https://npmmirror.com/mirrors/sharp
npm config set sharp_libvips_binary_host https://npmmirror.com/mirrors/sharp-libvips
```

### 5.3 electron 二进制下载
上一轮 electron 的 postinstall 卡了 47 分钟未成功，最后用 `--ignore-scripts` 绕过才装完依赖。
**后果：`npm run dev` 的真机弹窗从未验证过。** T04/T05 完成后必须补这一步验证。

**规矩**：任何单个包安装超时上限 10 分钟，超时就标记失败继续写代码，不要反复重试。

### 5.4 Electron 启动必须解除 ELECTRON_RUN_AS_NODE

本机环境中 `ELECTRON_RUN_AS_NODE` 可能被设置。此时 `electron.exe` 会被当作**纯 Node** 执行（`require('electron')` 只返回一个路径字符串），表现为"窗口起不来但也不报错"，极具迷惑性。启动前先：

```bash
env -u ELECTRON_RUN_AS_NODE npx electron .
```

### 5.5 【已更正】GUI 进程**可以**在沙箱里跑起来 → 真机验证是可行的

> **本节在 2026-09-15 第二轮整改中被实测推翻。** 原文结论"沙箱会拦住 GUI exe 的启动、真机弹窗极可能无法验证"过于悲观 —— 那条结论来自 09-14 用 `cmd //c start` 的一次失败尝试，但**直接执行 `electron.exe` 是可行的**。

**已实测出的成功条件**（缺一不可）：

```bash
# 1) 必须解除 ELECTRON_RUN_AS_NODE（见 §5.4）
# 2) 必须带 --disable-gpu --disable-gpu-sandbox，否则 Chromium 的 GPU 进程起不来，
#    会直接 FATAL: GPU process isn't usable. Goodbye. 然后 abort（窗口都来得及创建，但活不过 1 秒）
# 3) 不要加 --no-sandbox —— 实测那样反而更早起不来
./node_modules/.bin/electron . --disable-gpu --disable-gpu-sandbox --remote-debugging-port=9222
```

**验证手段：CDP 探针**（`scripts/probe-runtime.mjs`）。沙箱里看不到窗口，但进程与渲染进程是**真实运行**的，用 CDP 连上 HUD 页面即可拿到"真机证据"而不是静态推断：

```bash
node scripts/probe-runtime.mjs 9222
```

实测输出（2026-09-15，第二轮整改后）：

```
[probe] 页面目标: hud.html, handle.html
[probe] getPoolSnapshot → {"hasApi":true,"ok":true,"rows":65,"scanned":0,"total":8,
                          "setNumber":18,"firstRow":{"id":"akali","pool":30,"remaining":30},"allFull":true}
[probe] getScanStatus ok → true
[probe] DOM → {"title":"TFT 牌库剩余计数器","hasRoot":true,
               "bodyText":"TFT 牌库剩余\n估算\nS18 · 18.1 ~ 18.2\n估算\n待实测\n尚未扫描\n· 未知\n—\n巡查 0/8\n未巡查 8 家..."}
```

即已验证：三窗口创建成功、基线 65 弈子加载成功、Vision worker 拉起成功、preload 的 contextBridge 生效、IPC 往返正常、HUD 真的渲染出了 65 行首屏与合规"估算"文案。

**仍然做不到的**：肉眼确认窗口外观、用鼠标做交互验收（无可见桌面）。像素级 UI 与交互验收仍需人工或有桌面的环境。

### 5.6 使用环境背景（国服）

用户玩的是**国服**云顶之弈：独立 UE 客户端 `TFTTencentClient-Win64-Shipping.exe`，带完整腾讯 ACE 反作弊（`AntiCheatExpert/` 下 5 个内核驱动，且持续更新）。

这正是本项目合规红线存在的原因 —— 读内存必然演变成反作弊对抗，技术终点是"会被封号的作弊器"。本工具坚持纯屏幕像素路线，用户已知晓并接受"无法自动切换巡查视角"的功能折衷。

---

## 6. 下一阶段任务（T03 → T04 → T05）

详细定义见 `docs/ARCHITECTURE.md` §9。要点摘录：

### T03 — 视觉识别 Worker（约 28 文件）
- `capture-manager`：双后端 + **能力探测（连拍 3 帧非纯黑）** + 自动降级。主选 `node-screenshots`（Rust/WGC），回退 Electron `desktopCapturer`
- `geometry`：标定矩形 → 棋盘网格 → 物理像素坐标（含多 DPI / scaleFactor）
- `cost-classifier`：**费用颜色先验分类，把 65 类降到 ≤14 类**（准确率与性能的关键一招）
- 识别主链路：`slot-extractor` → `cost-classifier` → `template-store` + `phash-matcher` 粗筛 → `opencv-matcher` 精排 → `fusion` 融合 → `blacklist-filter`
- `star-detector`（**不确定时保守默认 1★**）/ `stage-detector` / `board-detector` / `player-detector`（三级链，用于判定"当前是第几家"）
- `pipeline` 编排 + `profiler` 分段耗时 + **1.2s 超时保护**
- 模板：**自建采集向导** + `make-templates.mjs` + zip 导入导出 + 65 张占位模板
- **关键前提：棋盘上没有弈子名字文字可 OCR**（名称只在 hover tooltip 出现），所以名称 OCR 不进主链路

### T04 — 主进程（约 30 文件）
- 三窗口：HUD（透明置顶）/ Settings（单例）/ Handle（10×10），+ window-state 持久化 + 点击穿透联动
- IPC handlers：scan / correction / config / baseline / window / template
- 扫描调度器 + 阶段策略，**扫描绝不能卡主线程**
- 持久化（config-store / session-store）、hotkeys、tray、logger
- **`self-check/resolution-check.ts`：启动时自动检测是否独占全屏，若是则引导用户改「无边框全屏」**（用户已拍板要做）
- 产出 `docs/COMPLIANCE-CHECKLIST.md` + `src/shared/forbidden-apis.md`

### T05 — 渲染层 UI（约 30 文件）
- HUD：弈子列表 + 剩余数 + 费用/羁绊筛选 + **巡查进度 x/8** + 低置信度高亮 + **一键校正**
- 设置页：卡池基数编辑（按费用档批量改 + 单弈子覆写）、备选预设一键切换、标定、模板管理
- 首启引导页（含全屏模式引导）
- 性能约束：HUD 高频重绘的 65 行用 **Tailwind**；MUI 只用于弹层/表单/设置页（emotion 运行时开销扛不住 1.5s 全量刷新）

### 下一阶段的完成标准
1. `tsc --noEmit`（main + renderer）零错误
2. `npm test` 全绿，**原有 184 个用例不允许 regression**
3. `vite build` 产出 renderer 产物
4. 全局一致性审查输出 `IS_PASS: YES`（NO 则修复重审，最多 2 轮）
5. README 写清：装依赖 / 跑 dev / 标定棋盘 / 建模板库

---

## 7. 硬约束清单（不可违背）

### 7.1 合规红线（最高优先级，一票否决）
只读**屏幕像素**。严禁：
- 读写游戏进程内存（`OpenProcess` / `ReadProcessMemory` / `WriteProcessMemory` / `VirtualAllocEx` / `CreateRemoteThread`）
- 注入 DLL、修改游戏文件或网络包
- 模拟鼠标/键盘输入（`robotjs` / `ffi-napi` / `memoryjs` / `nut-js` / `node-key-sender`）
- 把游戏截图上传到任何云端服务（识别必须全部本地离线完成）

**因此工具无法自动切换游戏内巡查视角** —— 采用「用户手动切视角，工具自动识别当前是第几家并累加到台账，UI 显示巡查进度 x/8」。

### 7.2 已拍板的产品决策
1. 形态：Windows 桌面悬浮窗（Electron 透明置顶）
2. 录入：OCR/模板自动识别为主，**手动校正为一等公民**（低置信度高亮 + 一键修正 + 修正后不被动摇）
3. 范围：全场 8 家棋盘 + 备战区
4. 巡查：手动切视角 + 自动识别玩家序号 + 台账累加
5. 卡池基数：默认 1费30 / 2费25 / 3费18 / 4费10 / 5费9，**严禁硬编码**，必须走 `data/pool-baseline.json` + 配置注入，设置页可编辑
6. 备选卡池预设：`22/20/17/10/9`（tftactics 来源）保留为设置页可一键切换的预设
7. 模板素材：**用户自建采集向导**（不内置图鉴站素材，规避版权风险）
8. 全屏引导：启动自动检测独占全屏 → 引导改「无边框全屏」
9. 棋盘几何：4 行 × 7 列，备战席 8 槽，走 `data/board-geometry.json` 可配置

---

## 8. 已知待确认项（不要当成已解决）

1. **卡池基数未实测确认**：`data/pool-baseline.json` 中标了 `CONFIRMED: false`。主流三方来源（esportstales / tft.ninja / tft-lab）为 30/25/18/10/9，但 tftactics 旧页写 22/20/17/10/9。需实机复核。
2. **真实截图样本缺失**（PRD Q4）：需 3 种分辨率各 20 张真实游戏截图，用于校准网格几何、费用色阈值、星标模板。**T03 的真实准确率验收待样本到位**。
3. **棋盘几何待校准**：4×7 / 8 槽是按经典布局暂定，需按 Q4 样本实测校准。
4. **S18 是首个虚幻引擎赛季**，UI 与视觉全变，识别准确率达标（95%）是最大技术风险（架构师判断 R1）。
5. **识别准确率兜底**：即使自动识别只有 80%，靠"手动校正一等公民"设计产品仍可用。

---

## 9. 建议的下一步

1. 额度恢复（今晚 20:10）后，直接继续 T03 → T04 → T05
2. T03 完成后立即跑 QA 回归：原有 184 个用例 + 新增识别层测试
3. 补做 `npm run dev` 真机弹窗验证 —— **先确认沙箱是否允许 GUI 进程启动**（见 §5.5）。若不允许，走「构建产物 + 静态自证」并如实标注，不要谎报
4. 用户提供真实游戏截图（3 分辨率 × 20 张）后，做识别准确率专项验收
5. 实机复核卡池基数，把 `CONFIRMED: false` 改为真实值
