# 禁用 API 清单（合规审查用）

本清单对应 PRD 第 7 章 X1–X8 红线，是**人工审查**的第一道防线；
第二道防线是 `.eslintrc.cjs` 中的静态规则（对下列字样直接报 error）；
第三道防线是 `docs/COMPLIANCE-CHECKLIST.md` 的 PR 逐条勾选。

> 项目中任何位置（包括注释、测试用例、文档示例）都**不应**出现下表左列的实现性用法。
> 本文件与 ESLint 配置中的"字样"属于白名单例外（它们是为了禁止而存在）。

| 类别 | 禁用项 | 对应红线 |
| --- | --- | --- |
| 进程内存读写 | `ReadProcessMemory` / `WriteProcessMemory` / `NtReadVirtualMemory` / `NtWriteVirtualMemory` / `ZwReadVirtualMemory` / `ZwWriteVirtualMemory` | X1 |
| 进程句柄与远程执行 | `OpenProcess` / `VirtualAllocEx` / `VirtualProtectEx` / `CreateRemoteThread` | X1 / X2 |
| 注入与 Hook | `SetWindowsHookEx` / DLL 注入 / Inline Hook / Detour | X2 |
| 输入模拟 | `SendInput` / `mouse_event` / `keybd_event` / 驱动级输入模拟 / 自动切换巡查视角 | X3 |
| 输入模拟 npm 包 | `robotjs` / `nut-js` / `node-key-sender` | X3 |
| 内存扫描 npm 包 | `memoryjs` / `process-list` | X1 |
| FFI | `ffi-napi` / `ffi` / `ref-napi` / `koffi` | X1 / X2 |
| 游戏文件修改 | 任何对游戏安装目录 `.wad` / `.client` / 配置文件的写入 | X4 |
| 网络拦截 | 代理注入 / 抓包改包 / 未公开 Riot 内部接口 | X5 |
| 自动化操作 | 自动 D 牌 / 自动买牌 / 自动站位 | X6 |
| 反作弊对抗 | 隐藏进程 / 隐藏窗口 / 绕过检测 | X7 |
| 数据外传 | 上传截图、对局数据、日志到任何服务器 | X8 |

## 架构级保证

1. **截屏数据只在 Vision Worker 进程内存中流转。**
   `ScanResult` 只含结构化观测（championId / star / confidence / fingerprint），
   不含任何像素，从架构上杜绝"截图被上传"的可能路径。
2. **唯一网络出口**为可选的社区数据源更新（P2，需用户显式确认）；日志与截图永不上传。
3. **代码中不存在任何指向游戏目录或游戏进程的读写路径**。
4. 所有图像处理耗时操作都在 Vision Worker，主进程同步路径禁止图像处理。

## 自查命令

```bash
npm run lint            # ESLint 合规红线规则
npm run lint:compliance # 全仓 grep 禁用 API 关键字
npm test                # 含合规相关的架构约束测试
```
