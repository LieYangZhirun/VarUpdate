/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板
 *
 * 酒馆助手的脚本虽然运行在 iframe 中，但 iframe 与宿主同源，
 * 可通过 window.parent.document 操作宿主页面 DOM。
 *
 * 本模块负责：
 * 1. 在宿主页面 #extensions_settings 中渲染设置面板（inline-drawer）
 * 2. 在宿主页面 #extensionsMenu 中注册魔棒工具菜单项
 */

import * as notify from './notification.js';
import { readVariables, writeVariables } from './variable-store.js';
import type { NotifyLevel } from '../types/index.js';

// ═══════════════════════════════════════════
//  获取宿主文档
// ═══════════════════════════════════════════

function getHostDocument(): Document {
  try {
    return window.parent?.document || document;
  } catch {
    return document;
  }
}

// ═══════════════════════════════════════════
//  面板 HTML（使用 SillyTavern 标准 class）
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>🔧 VarUpdate</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

    <div class="section-divider">操作
      <hr class="sysHR" />
    </div>
    <div class="flex-container" style="gap:5px; flex-wrap:wrap;">
      <div id="varupdate-btn-init" class="menu_button menu_button_icon" title="手动初始化变量">
        <i class="fa-solid fa-play"></i>
        <small>初始化</small>
      </div>
      <div id="varupdate-btn-update" class="menu_button menu_button_icon" title="重解析当前楼层消息中的标签">
        <i class="fa-solid fa-rotate"></i>
        <small>重解析</small>
      </div>
      <div id="varupdate-btn-reset" class="menu_button menu_button_icon" title="清空所有变量并重置缓存">
        <i class="fa-solid fa-trash-can"></i>
        <small>重置</small>
      </div>
    </div>

    <div class="section-divider">通知设置
      <hr class="sysHR" />
    </div>
    <div class="flex-container alignItemsCenter" style="gap:8px;">
      <label for="varupdate-notify-level">通知等级</label>
      <select id="varupdate-notify-level" class="text_pole" style="flex:1;">
        <option value="debug">调试 (全部)</option>
        <option value="always">常规 (成功+警告+错误)</option>
        <option value="notice" selected>安静 (仅警告+错误)</option>
        <option value="error">最低 (仅错误)</option>
        <option value="silence">静默 (不弹窗)</option>
      </select>
    </div>

    <div class="section-divider">调试
      <hr class="sysHR" />
    </div>
    <small>当前变量状态 (只读)</small>
    <textarea id="varupdate-debug-state" class="text_pole" readonly rows="4"
      style="width:100%; font-family:monospace; font-size:11px; resize:vertical; margin-top:4px;"></textarea>

  </div>
</div>
`;

// ═══════════════════════════════════════════
//  回调容器
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
 * 渲染设置面板到宿主页面的 #extensions_settings
 */
export function renderPanel(cbs: PanelCallbacks = {}): void {
  callbacks = cbs;

  // 清除旧版本注册的快捷按钮
  try {
    if (typeof replaceScriptButtons === 'function') {
      replaceScriptButtons([]);
    }
  } catch { /* 静默 */ }

  try {
    const hostDoc = getHostDocument();

    // 防止重复注入
    if (hostDoc.getElementById('varupdate-settings')) return;

    const container = hostDoc.getElementById('extensions_settings');
    if (!container) {
      notify.debug('面板', '#extensions_settings 未找到');
      return;
    }

    // 注入 HTML
    const wrapper = hostDoc.createElement('div');
    wrapper.innerHTML = PANEL_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (panel) {
      container.appendChild(panel);
    }

    // 绑定折叠/展开（SillyTavern inline-drawer 标准行为）
    const header = hostDoc.querySelector('#varupdate-settings .inline-drawer-toggle');
    const content = hostDoc.querySelector('#varupdate-settings .inline-drawer-content') as HTMLElement | null;
    if (header && content) {
      header.addEventListener('click', () => {
        const icon = header.querySelector('.inline-drawer-icon');
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? '' : 'none';
        icon?.classList.toggle('down', !isHidden);
        icon?.classList.toggle('up', isHidden);
      });
    }

    // 绑定按钮
    hostDoc.getElementById('varupdate-btn-init')?.addEventListener('click', () => {
      callbacks.onManualInit?.();
    });
    hostDoc.getElementById('varupdate-btn-update')?.addEventListener('click', () => {
      callbacks.onManualUpdate?.();
    });
    hostDoc.getElementById('varupdate-btn-reset')?.addEventListener('click', () => {
      if (confirm('确定要重置所有变量吗？')) {
        callbacks.onReset?.();
      }
    });

    // 绑定通知等级
    hostDoc.getElementById('varupdate-notify-level')?.addEventListener('change', (e) => {
      const level = (e.target as HTMLSelectElement).value as NotifyLevel;
      notify.setLevel(level);
      saveSettings();
    });

    // 加载设置
    loadSettings();

  } catch (e) {
    notify.warning('面板', `渲染失败: ${(e as Error).message}`);
  }
}

/**
 * 注册魔棒工具菜单选项
 */
export function registerWandButtons(): void {
  try {
    const hostDoc = getHostDocument();
    const menu = hostDoc.getElementById('extensionsMenu');
    if (!menu) {
      notify.debug('魔棒', '#extensionsMenu 未找到');
      return;
    }

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-reparse',
      icon: 'fa-solid fa-rotate',
      label: '重解析当前楼层',
      onClick: () => callbacks.onManualUpdate?.(),
    });

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-reset',
      icon: 'fa-solid fa-eraser',
      label: '重置变量',
      onClick: () => {
        if (confirm('确定要重置所有变量吗？')) {
          callbacks.onReset?.();
        }
      },
    });

  } catch (e) {
    notify.debug('魔棒', `注册失败: ${(e as Error).message}`);
  }
}

/**
 * 刷新调试区的变量状态显示
 */
export function refreshDebugState(data: Record<string, any>): void {
  try {
    const hostDoc = getHostDocument();
    const textarea = hostDoc.getElementById('varupdate-debug-state') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = JSON.stringify(data, null, 2);
    }
  } catch {
    // 静默
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function addWandMenuItem(
  menu: HTMLElement,
  doc: Document,
  opts: { id: string; icon: string; label: string; onClick: () => void }
): void {
  if (doc.getElementById(opts.id)) return;

  const container = doc.createElement('div');
  container.className = 'extension_container';
  container.id = opts.id;

  const item = doc.createElement('div');
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.role = 'listitem';
  item.addEventListener('click', opts.onClick);

  const icon = doc.createElement('div');
  icon.className = `fa-fw ${opts.icon} extensionsMenuExtensionButton`;

  const span = doc.createElement('span');
  span.textContent = opts.label;

  item.appendChild(icon);
  item.appendChild(span);
  container.appendChild(item);
  menu.appendChild(container);
}

function loadSettings(): void {
  try {
    const globalData = readVariables('global');
    const settings = globalData._varupdate_settings;
    if (settings?.notifyLevel) {
      notify.setLevel(settings.notifyLevel);
      const hostDoc = getHostDocument();
      const select = hostDoc.getElementById('varupdate-notify-level') as HTMLSelectElement;
      if (select) select.value = settings.notifyLevel;
    }
  } catch {
    // 首次使用无设置
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
