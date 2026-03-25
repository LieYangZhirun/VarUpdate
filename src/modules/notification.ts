/**
 * modules/notification.ts
 *
 * 模块 8：通知系统
 *
 * 统一的五级通知输出，根据用户设置的通知等级控制 toastr 弹窗和控制台的可见性。
 *
 * 等级：debug(0) → always(1) → notice(2) → error(3) → silence(4)
 */

import type { NotifyLevel } from '../types/index.js';
import { NOTIFY_LEVEL_VALUES } from '../types/index.js';

// ═══════════════════════════════════════════
//  模块状态
// ═══════════════════════════════════════════

/** 当前通知等级（默认 notice） */
let currentLevel: NotifyLevel = 'notice';

// ═══════════════════════════════════════════
//  控制台颜色样式
// ═══════════════════════════════════════════

const CONSOLE_STYLES: Record<string, string> = {
  debug:   'color: #6CB4EE; font-weight: bold;',  // 蓝色
  success: 'color: #50C878; font-weight: bold;',   // 绿色
  warning: 'color: #FFB347; font-weight: bold;',   // 橙色
  error:   'color: #FF6B6B; font-weight: bold;',   // 红色
};

const PREFIX = '[VarUpdate]';

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 设置当前通知等级（低于此等级的通知被忽略）
 */
export function setLevel(level: NotifyLevel): void {
  currentLevel = level;
}

/**
 * 获取当前通知等级
 */
export function getLevel(): NotifyLevel {
  return currentLevel;
}

/**
 * 发送调试通知（等级 0）
 *
 * toastr: info + 控制台: 蓝色
 */
export function debug(title: string, message: string = ''): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.debug) return;

  logToConsole('debug', title, message);
  showToastr('info', title, message);
}

/**
 * 发送成功通知（等级 1）
 *
 * toastr: success + 控制台: 绿色
 */
export function success(title: string, message: string = ''): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.always) return;

  logToConsole('success', title, message);
  showToastr('success', title, message);
}

/**
 * 发送警告通知（等级 2）
 *
 * toastr: warning + 控制台: 橙色
 */
export function warning(title: string, message: string = ''): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.notice) return;

  logToConsole('warning', title, message);
  showToastr('warning', title, message);
}

/**
 * 发送错误通知（等级 3）
 *
 * toastr: error + 控制台: 红色
 */
export function error(title: string, message: string = ''): void {
  if (NOTIFY_LEVEL_VALUES[currentLevel] > NOTIFY_LEVEL_VALUES.error) return;

  logToConsole('error', title, message);
  showToastr('error', title, message);
}

/**
 * 通用通知函数
 */
export function notify(level: NotifyLevel, title: string, message: string = ''): void {
  switch (level) {
    case 'debug':  debug(title, message); break;
    case 'always': success(title, message); break;
    case 'notice': warning(title, message); break;
    case 'error':  error(title, message); break;
    case 'silence': break; // 不输出任何内容
  }
}

// ═══════════════════════════════════════════
//  内部实现
// ═══════════════════════════════════════════

/**
 * 输出到控制台（带颜色标记）
 */
function logToConsole(type: string, title: string, message: string): void {
  const style = CONSOLE_STYLES[type] || '';
  const text = message ? `${title}: ${message}` : title;

  switch (type) {
    case 'error':
      console.error(`%c${PREFIX} ${text}`, style);
      break;
    case 'warning':
      console.warn(`%c${PREFIX} ${text}`, style);
      break;
    default:
      console.log(`%c${PREFIX} ${text}`, style);
      break;
  }
}

/**
 * 显示 toastr 弹窗（仅在浏览器环境中）
 */
function showToastr(type: 'info' | 'success' | 'warning' | 'error', title: string, message: string): void {
  try {
    // 运行时：从宿主页面访问 toastr
    const t = typeof toastr !== 'undefined' ? toastr
            : typeof parent !== 'undefined' ? (parent as any).toastr
            : null;

    if (t && typeof t[type] === 'function') {
      t[type](message, `${PREFIX} ${title}`);
    }
  } catch {
    // 测试环境或 iframe 不可用 → 静默
  }
}
