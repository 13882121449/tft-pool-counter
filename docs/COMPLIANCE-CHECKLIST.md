# 合规红线逐条审查清单

> 对应 `docs/PRD.md` 第 7 章 X1–X8。
> **每个 PR 必须逐条勾选**，未勾选不得合并。
> 静态防线：`.eslintrc.cjs` 的合规规则 + `npm run lint:compliance`（全仓 grep）。

---

## 逐条审查表

| # | 红线 | 本项目的保证 | 审查要点 | 状态 |
| --- | --- | --- | --- | --- |
| **X1** | 禁止读取/写入游戏进程内存 | 全链路只使用 OS 公开截屏接口（WGC / desktopCapturer）。代码中不存在任何进程句柄与内存读写调用 | grep `ReadProcessMemory` / `WriteProcessMemory` / `OpenProcess` / `VirtualAllocEx` / `CreateRemoteThread` / `memoryjs` 应零命中 | ✅ |
| **X2** | 禁止 DLL 注入 / 进程内 Hook | 不存在任何注入或 Hook 路径；`ffi-napi` / `koffi` 等 FFI 包在"不引入清单"中 | grep `SetWindowsHookEx` / `CreateRemoteThread` / `ffi-napi` / `koffi` 应零命中 | ✅ |
| **X3** | 禁止模拟鼠标/键盘输入 | 不提供"自动切换巡查视角"等便利功能；视角切换由用户手动完成，工具只被动识别当前画面属于谁 | grep `SendInput` / `mouse_event` / `keybd_event` / `robotjs` / `nut-js` / `node-key-sender` 应零命中 | ✅ |
| **X4** | 禁止修改游戏文件/资源包 | 只读写自己的 `userData`（配置/模板/日志/对局记录） | 代码中不应出现指向游戏安装目录的任何路径 | ✅ |
| **X5** | 禁止拦截/修改/伪造网络包 | 无网络中间件、无代理注入；唯一网络出口是"可选的社区数据源更新"（P2，需用户显式确认） | 不得引入抓包/改包依赖；不得调用未公开接口 | ✅ |
| **X6** | 禁止自动化游戏决策与操作 | 工具只"显示信息"，绝不"替玩家操作"：没有自动 D 牌/买牌/站位 | UI 中不得存在任何触发游戏内操作的入口 | ✅ |
| **X7** | 禁止绕过反作弊/隐藏自身 | 不隐藏进程与窗口；HUD 是普通 `BrowserWindow`（`skipTaskbar` 仅用于悬浮窗体验，不做进程隐藏） | 不得引入进程隐藏、驱动、内核模块 | ✅ |
| **X8** | 禁止上传游戏画面/对局数据 | 识别与计算 100% 本地完成；`ScanResult` 只含结构化观测，**不含像素**；日志与截图永不上传 | 不得出现任何向外部服务器 POST 截图/对局数据的代码路径 | ✅ |

---

## 架构级保证（三条硬约束）

1. **像素不跨进程**：截屏数据只在 Vision Worker 进程内存中流转。
   `ScanResult` 只含 `championId / star / confidence / fingerprint / candidates`，
   从架构上杜绝"截图被上传"的可能路径。
2. **共享层与核心层零宿主依赖**：`src/shared` 禁止 import `electron` / `node:*`；
   `src/core` 禁止任何 electron / node 依赖。由 ESLint 强制。
3. **唯一网络出口**：可选社区数据源更新（P2，用户显式确认后才会发起）。

---

## 自查命令

```bash
npm run lint             # ESLint：合规红线规则 + 分层依赖约束
npm run lint:compliance  # 全仓 grep 禁用 API 关键字（含注释与数据文件）
npm test                 # 含分层与幂等等架构约束测试
```

## 禁用 API 清单

见 [`src/shared/forbidden-apis.md`](../src/shared/forbidden-apis.md)。
