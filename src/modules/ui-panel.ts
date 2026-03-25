/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板与脚本按钮
 *
 * 酒馆助手的脚本运行在 iframe 沙箱中，不能直接操作宿主 DOM。
 * 脚本可用的 UI 机制：
 * - appendInexistentScriptButtons：在脚本面板注册快捷按钮
 * - getButtonEvent + eventOn：监听按钮点击
 * - replaceScriptInfo：设置脚本说明信息
 * - 变量存储：持久化设置
 */

import * as notify from './notification.js';
import { readVariables, writeVariables } from './variable-store.js';
import type { NotifyLevel } from '../types/index.js';

// ═══════════════════════════════════════════
//  回调注册容器
// ═══════════════════════════════════════════

interface PanelCallbacks {
  onManualInit?: () => void;
  onManualUpdate?: () => void;
  onReset?: () => void;
}

let callbacks: PanelCallbacks = {};

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

/**
 * 初始化 UI
 *
 * 1. 设置脚本说明信息
 * 2. 注册快捷按钮
 * 3. 加载已保存的设置
 *
 * @param cbs 按钮回调函数
 */
export function renderPanel(cbs: PanelCallbacks = {}): void {
  callbacks = cbs;

  try {
    // 设置脚本说明信息
    setScriptInfo();

    // 注册快捷按钮到脚本面板
    registerButtons();

    // 加载已保存的设置
    loadSettings();

  } catch (e) {
    notify.warning('UI', `初始化失败: ${(e as Error).message}`);
  }
}

/**
 * 注册快捷按钮
 *
 * 使用 appendInexistentScriptButtons 在脚本面板注册操作按钮，
 * 然后用 getButtonEvent 获取事件名，eventOn 监听点击。
 */
export function registerWandButtons(): void {
  registerButtons();
}

/**
 * 刷新调试区的变量状态显示（通过控制台输出）
 */
export function refreshDebugState(data: Record<string, any>): void {
  // iframe 中无法渲染自定义面板 → 通过控制台输出
  console.log('%c[VarUpdate] 当前变量状态:', 'color: #50C878; font-weight: bold;', data);
}

// ═══════════════════════════════════════════
//  内部实现
// ═══════════════════════════════════════════

/**
 * 设置脚本说明信息
 */
function setScriptInfo(): void {
  try {
    if (typeof replaceScriptInfo === 'function') {
      replaceScriptInfo(
        '🔧 VarUpdate — 变量管理脚本\n' +
        '自动解析 <Var_Initial>/<Var_Update> 标签，管理变量状态。\n' +
        '通知等级: ' + notify.getLevel()
      );
    }
  } catch {
    // 静默
  }
}

/**
 * 注册快捷按钮
 */
function registerButtons(): void {
  try {
    if (typeof appendInexistentScriptButtons !== 'function') return;

    // 注册按钮
    appendInexistentScriptButtons([
      { name: '重解析当前楼层', visible: true },
      { name: '重置变量', visible: true },
    ]);

    // 绑定按钮点击事件
    if (typeof getButtonEvent !== 'function' || typeof eventOn !== 'function') return;

    eventOn(getButtonEvent('重解析当前楼层'), () => {
      callbacks.onManualUpdate?.();
    });

    eventOn(getButtonEvent('重置变量'), () => {
      callbacks.onReset?.();
    });

  } catch (e) {
    notify.debug('按钮注册', `失败: ${(e as Error).message}`);
  }
}

function loadSettings(): void {
  try {
    const globalData = readVariables('global');
    const settings = globalData._varupdate_settings;
    if (settings?.notifyLevel) {
      notify.setLevel(settings.notifyLevel);
    }
  } catch {
    // 首次使用无设置，忽略
  }
}

function saveSettings(): void {
  try {
    const globalData = readVariables('global');
    globalData._varupdate_settings = {
      notifyLevel: notify.getLevel(),
    };
    writeVariables('global', globalData);
  } catch {
    // 静默
  }
}
