/**
 * modules/notification.ts —— 模块 8：通知系统
 *
 * ## 分层（与面板「通知等级」一致）
 * - **debug**：开发排错；`debug()` 弹 toastr(info)+控制台，`trace()` 仅控制台（高频细节用 trace，避免刷屏）
 * - **always**：正常运行可见的成功类 toastr(success)+控制台
 * - **notice**：仅警告/错误类 toastr(warning|error)+控制台
 * - **error**：仅错误
 * - **silence**：全部静默（`feedback` 与 `bridgeError` / `bootstrapError` 仍写控制台，便于排障）
 *
 * ## 场景分类（控制台前缀 `[VarUpdate][code]`，便于过滤）
 * boot | evt | msg | sch | pat | wb | ui | mac | man | life | state | sys
 */

import type { NotifyLevel } from '../types/index.js';

/** 控制台与结构化日志用的场景码（短标签，便于检索） */
export type NotifyCategory =
  | 'boot' // 脚本启停
  | 'evt' // 事件总线 / 与宿主事件桥接
  | 'msg' // 消息入站（Agents / SillyTavern）
  | 'sch' // Schema 解析、编译、缓存
  | 'pat' // JSON Patch 管道
  | 'wb' // 世界书加载
  | 'ui' // 面板、魔棒
  | 'mac' // 插值宏
  | 'man' // 用户手动操作（常与 feedback 同现）
  | 'life' // 生命周期、恢复、清理、回退
  | 'state' // 变量快照（调试）
  | 'sys'; // 初始化失败等系统级

const NOTIFY_LEVEL_VALUES: Record<NotifyLevel, number> = {
  debug: 0,
  always: 1,
  notice: 2,
  error: 3,
  silence: 4,
};

let currentLevel: NotifyLevel = 'notice';

const CONSOLE_STYLES: Record<string, string> = {
  debug: 'color: #6CB4EE; font-weight: bold;',
  success: 'color: #50C878; font-weight: bold;',
  warning: 'color: #FFB347; font-weight: bold;',
  error: 'color: #FF6B6B; font-weight: bold;',
  trace: 'color: #8FA8C4; font-weight: normal;',
};

const PREFIX = '[VarUpdate]';

function bracket(cat?: NotifyCategory): string {
  return cat ? `${PREFIX}[${cat}]` : PREFIX;
}

function line(title: string, message: string): string {
  return message ? `${title}: ${message}` : title;
}

// ═══════════════════════════════════════════
//  等级
// ═══════════════════════════════════════════

export function setLevel(level: NotifyLevel): void {
  currentLevel = level;
}

export function getLevel(): NotifyLevel {
  return currentLevel;
}

export type NotifyOptions = { category?: NotifyCategory };

// ═══════════════════════════════════════════
//  标准出口（toastr + 控制台，受等级过滤）
// ═══════════════════════════════════════════

/**
 * 调试：toastr(info) + 控制台（仅 notifyLevel ≤ debug）
 * 高频细节请改用 `trace()`，避免 debug 等级下 toastr 爆炸。
 */
export function debug(title: string, message: string = '', opts?: NotifyOptions): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.debug) return;
  logToConsole('debug', title, message, opts?.category);
  showToastr('info', title, message, opts?.category);
}

/**
 * 仅控制台、不弹 toastr；仅在 notifyLevel ≤ debug 时输出。用于路径解析、缓存命中等高频条目。
 */
export function trace(title: string, message: string = '', category: NotifyCategory = 'pat'): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.debug) return;
  logToConsole('trace', title, message, category);
}

export function success(title: string, message: string = '', opts?: NotifyOptions): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.always) return;
  logToConsole('success', title, message, opts?.category);
  showToastr('success', title, message, opts?.category);
}

export function warning(title: string, message: string = '', opts?: NotifyOptions): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.notice) return;
  logToConsole('warning', title, message, opts?.category);
  showToastr('warning', title, message, opts?.category);
}

export function error(title: string, message: string = '', opts?: NotifyOptions): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.error) return;
  logToConsole('error', title, message, opts?.category);
  showToastr('error', title, message, opts?.category);
}

/**
 * 面板等主动操作结果：不受 notifyLevel 过滤（silence 除外），始终 toastr + 控制台。
 */
export function feedback(isSuccess: boolean, title: string, message: string = '', opts?: NotifyOptions): void {
  if (currentLevel === 'silence') return;
  const type = isSuccess ? 'success' : 'error';
  logToConsole(type, title, message, opts?.category ?? 'man');
  showToastr(type, title, message, opts?.category ?? 'man');
}

export function notify(level: NotifyLevel, title: string, message: string = '', opts?: NotifyOptions): void {
  switch (level) {
    case 'debug': debug(title, message, opts); break;
    case 'always': success(title, message, opts); break;
    case 'notice': warning(title, message, opts); break;
    case 'error': error(title, message, opts); break;
    case 'silence': break;
  }
}

// ═══════════════════════════════════════════
//  全场景补充：总线 / 启动失败（控制台优先）
// ═══════════════════════════════════════════

/**
 * 事件注册或广播失败：**始终** `console.error`（silence 也输出）；toastr 仅在非 silence 且等级允许 error 时。
 */
export function bridgeError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const text = line(context, msg);
  console.error(`${bracket('evt')} ${text}`);
  if (currentLevel === 'silence') return;
  if (NOTIFY_LEVEL_VALUES[currentLevel] <= NOTIFY_LEVEL_VALUES.error) {
    showToastr('error', context, msg, 'evt');
  }
}

/**
 * 脚本顶层初始化失败：**始终** `console.error`（含 Error 对象）；非 silence 时弹错误 toastr。
 */
export function bootstrapError(err: unknown): void {
  console.error(`${bracket('sys')} 初始化失败`, err);
  if (currentLevel === 'silence') return;
  const msg = err instanceof Error ? err.message : String(err);
  showToastr('error', '初始化失败', msg, 'sys');
}

/**
 * 当前变量 data 快照：受等级约束——debug 打完整对象；always 打一行摘要；notice 及以上不打。
 */
export function logStateSnapshot(data: Record<string, any>): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.always) return;
  const style = CONSOLE_STYLES.debug;
  const top = Object.keys(data ?? {}).length;
  if (NOTIFY_LEVEL_VALUES[currentLevel] <= NOTIFY_LEVEL_VALUES.debug) {
    console.log(`%c${bracket('state')} 变量快照`, style, data);
  } else {
    console.log(`%c${bracket('state')} 变量快照 · ${top} 个顶层键`, style);
  }
}

// ═══════════════════════════════════════════
//  内部
// ═══════════════════════════════════════════

function logToConsole(type: string, title: string, message: string, category?: NotifyCategory): void {
  const style = CONSOLE_STYLES[type] || CONSOLE_STYLES.debug;
  const text = line(title, message);
  const labeled = `${bracket(category)} ${text}`;

  switch (type) {
    case 'error':
      console.error(`%c${labeled}`, style);
      break;
    case 'warning':
      console.warn(`%c${labeled}`, style);
      break;
    default:
      console.log(`%c${labeled}`, style);
      break;
  }
}

function showToastr(type: 'info' | 'success' | 'warning' | 'error', title: string, message: string, category?: NotifyCategory): void {
  try {
    const t = typeof toastr !== 'undefined' ? toastr
      : typeof parent !== 'undefined' ? (parent as any).toastr
        : null;

    if (t && typeof t[type] === 'function') {
      const toastTitle = category ? `${PREFIX}[${category}] ${title}` : `${PREFIX} ${title}`;
      t[type](message, toastTitle);
    }
  } catch {
    // 测试或非浏览器环境
  }
}
