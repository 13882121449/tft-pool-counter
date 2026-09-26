/**
 * IPC 通道常量 —— **唯一定义处**（架构 §8.3）。
 *
 * 其他地方禁止出现通道字符串字面量，一律从这里导入。
 * 命名规则：请求/响应用动词（`config:get`），主 → 渲推送用名词事件（`pool:snapshot`）。
 */

/** 扫描域。 */
export const CH_SCAN_ONCE = 'scan:once' as const;
export const CH_SCAN_PAUSE = 'scan:pause' as const;
export const CH_SCAN_RESUME = 'scan:resume' as const;
export const CH_SCAN_STATUS = 'scan:status' as const;

/**
 * 牌库快照域。
 *
 * `pool:snapshot` 是**主 → 渲推送**（变化才发）；
 * `pool:get-snapshot` 是**渲 → 主拉取**，用于渲染进程挂载时补齐首帧。
 *
 * 首帧拉取不是冗余：主进程在 `HUD did-finish-load` 上注册一次性推送，
 * 而渲染进程在挂载时才订阅，两者存在竞态 —— 拉取一次即可消除
 * "首次扫描前列表全空"的现象（QA N2 整改：原 `pool:get-rows` /
 * `pool:coverage` 两个通道声明后既未注册也未暴露，属死通道，已合并为本通道）。
 */
export const CH_POOL_SNAPSHOT = 'pool:snapshot' as const;
export const CH_POOL_GET_SNAPSHOT = 'pool:get-snapshot' as const;

/** 校正域。 */
export const CH_CORRECTION_OPEN = 'correction:open' as const;
export const CH_CORRECTION_APPLY = 'correction:apply' as const;
export const CH_CORRECTION_MOVE = 'correction:move' as const;
export const CH_CORRECTION_UNDO = 'correction:undo' as const;

/** 配置域。 */
export const CH_CONFIG_GET = 'config:get' as const;
export const CH_CONFIG_SET = 'config:set' as const;
export const CH_CONFIG_RESET = 'config:reset' as const;

/** 基线域。 */
export const CH_BASELINE_GET = 'baseline:get' as const;
export const CH_BASELINE_RELOAD = 'baseline:reload' as const;
export const CH_BASELINE_VALIDATE = 'baseline:validate' as const;

/** 窗口域。 */
export const CH_WINDOW_ACTION = 'window:action' as const;
export const CH_WINDOW_BOUNDS = 'window:bounds' as const;
export const CH_WINDOW_STATE = 'window:state' as const;

/** 标定域（棋盘 / 备战席 / 商店的归一化标定）。 */
export const CH_CALIBRATION_GET = 'calibration:get' as const;
export const CH_CALIBRATION_SET = 'calibration:set' as const;

/** 模板素材域。 */
export const CH_TEMPLATE_LIST = 'template:list' as const;
export const CH_TEMPLATE_IMPORT = 'template:import' as const;
export const CH_TEMPLATE_EXPORT = 'template:export' as const;
export const CH_TEMPLATE_APPEND = 'template:append' as const;
export const CH_TEMPLATE_CAPTURE = 'template:capture' as const;

/** 日志 / 系统域。 */
export const CH_LOG_TAIL = 'log:tail' as const;
export const CH_LOG_EXPORT = 'log:export' as const;
export const CH_SYSTEM_ERROR = 'system:error' as const;
export const CH_SYSTEM_INFO = 'system:info' as const;
export const CH_SYSTEM_QUIT = 'system:quit' as const;

/** 全部通道的联合类型。 */
export type IpcChannel =
  | typeof CH_SCAN_ONCE
  | typeof CH_SCAN_PAUSE
  | typeof CH_SCAN_RESUME
  | typeof CH_SCAN_STATUS
  | typeof CH_POOL_SNAPSHOT
  | typeof CH_POOL_GET_SNAPSHOT
  | typeof CH_CORRECTION_OPEN
  | typeof CH_CORRECTION_APPLY
  | typeof CH_CORRECTION_MOVE
  | typeof CH_CORRECTION_UNDO
  | typeof CH_CONFIG_GET
  | typeof CH_CONFIG_SET
  | typeof CH_CONFIG_RESET
  | typeof CH_BASELINE_GET
  | typeof CH_BASELINE_RELOAD
  | typeof CH_BASELINE_VALIDATE
  | typeof CH_WINDOW_ACTION
  | typeof CH_WINDOW_BOUNDS
  | typeof CH_WINDOW_STATE
  | typeof CH_CALIBRATION_GET
  | typeof CH_CALIBRATION_SET
  | typeof CH_TEMPLATE_LIST
  | typeof CH_TEMPLATE_IMPORT
  | typeof CH_TEMPLATE_EXPORT
  | typeof CH_TEMPLATE_APPEND
  | typeof CH_TEMPLATE_CAPTURE
  | typeof CH_LOG_TAIL
  | typeof CH_LOG_EXPORT
  | typeof CH_SYSTEM_ERROR
  | typeof CH_SYSTEM_INFO
  | typeof CH_SYSTEM_QUIT;

/** 主 ↔ Vision Worker 的 postMessage 消息类型（用 scanId 配对）。 */
export const WORKER_MSG_SCAN = 'scan' as const;
export const WORKER_MSG_CALIBRATE = 'calibrate' as const;
export const WORKER_MSG_CAPTURE_TEMPLATE = 'captureTemplate' as const;
export const WORKER_MSG_READY = 'ready' as const;
export const WORKER_MSG_SCAN_RESULT = 'scan:result' as const;
export const WORKER_MSG_ERROR = 'error' as const;
export const WORKER_MSG_HEARTBEAT = 'heartbeat' as const;

/**
 * 运行期配置下发（T03 新增）。
 *
 * 由主进程 VisionHost 在 worker 就绪后发送，内容包含识别配置、规格文件路径、
 * 模板目录，以及**是否启用 desktopCapturer 回退帧提供者**。
 * 后者必须是显式开启：主进程若未实现帧转发，worker 侧探测会超时，
 * 默认关闭可避免无谓的等待。
 */
export const WORKER_MSG_CONFIG = 'config' as const;

/**
 * Worker → 宿主 请求一帧压缩画面（desktopCapturer 回退链路）。
 * 宿主返回 WORKER_MSG_FRAME_RESPONSE；未实现时 worker 侧超时并自动跳过该后端。
 */
export const WORKER_MSG_FRAME_REQUEST = 'frame:request' as const;

/** 宿主 → Worker 回传压缩帧（PNG 字节）。 */
export const WORKER_MSG_FRAME_RESPONSE = 'frame:response' as const;

/** Worker → 宿主 上报自身能力（后端可用性、模板数量、识别后端）。 */
export const WORKER_MSG_CAPABILITIES = 'capabilities' as const;

/** 所有 Worker 消息类型（便于测试断言与文档化）。 */
export const ALL_WORKER_MESSAGES: readonly string[] = [
  WORKER_MSG_SCAN,
  WORKER_MSG_CALIBRATE,
  WORKER_MSG_CAPTURE_TEMPLATE,
  WORKER_MSG_READY,
  WORKER_MSG_SCAN_RESULT,
  WORKER_MSG_ERROR,
  WORKER_MSG_HEARTBEAT,
  WORKER_MSG_CONFIG,
  WORKER_MSG_FRAME_REQUEST,
  WORKER_MSG_FRAME_RESPONSE,
  WORKER_MSG_CAPABILITIES,
];

/** 所有通道常量数组，便于注册时遍历与测试断言。 */
export const ALL_CHANNELS: readonly IpcChannel[] = [
  CH_SCAN_ONCE,
  CH_SCAN_PAUSE,
  CH_SCAN_RESUME,
  CH_SCAN_STATUS,
  CH_POOL_SNAPSHOT,
  CH_POOL_GET_SNAPSHOT,
  CH_CORRECTION_OPEN,
  CH_CORRECTION_APPLY,
  CH_CORRECTION_MOVE,
  CH_CORRECTION_UNDO,
  CH_CONFIG_GET,
  CH_CONFIG_SET,
  CH_CONFIG_RESET,
  CH_BASELINE_GET,
  CH_BASELINE_RELOAD,
  CH_BASELINE_VALIDATE,
  CH_WINDOW_ACTION,
  CH_WINDOW_BOUNDS,
  CH_WINDOW_STATE,
  CH_CALIBRATION_GET,
  CH_CALIBRATION_SET,
  CH_TEMPLATE_LIST,
  CH_TEMPLATE_IMPORT,
  CH_TEMPLATE_EXPORT,
  CH_TEMPLATE_APPEND,
  CH_TEMPLATE_CAPTURE,
  CH_LOG_TAIL,
  CH_LOG_EXPORT,
  CH_SYSTEM_ERROR,
  CH_SYSTEM_INFO,
  CH_SYSTEM_QUIT,
];
