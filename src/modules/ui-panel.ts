/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板
 *
 * 脚本设置面板的渲染、按钮绑定、魔棒快捷按钮注册。
 * 使用 jQuery + 原生 DOM 操作构建面板 HTML，注入到酒馆助手的脚本扩展面板容器中。
 */

import * as notify from './notification.js';
import { readVariables, writeVariables } from './variable-store.js';
import type { NotifyLevel } from '../types/index.js';

// ═══════════════════════════════════════════
//  面板 HTML 模板
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-panel" class="varupdate-settings">
  <h4>🔧 VarUpdate 设置</h4>

  <!-- 操作按钮栏 -->
  <div class="varupdate-actions">
    <button id="varupdate-btn-init" class="menu_button">手动初始化</button>
    <button id="varupdate-btn-update" class="menu_button">手动触发更新</button>
    <button id="varupdate-btn-reset" class="menu_button">重置变量</button>
  </div>

  <!-- 设置项 -->
  <div class="varupdate-settings-group">
    <label>通知等级:
      <select id="varupdate-notify-level">
        <option value="debug">调试 (全部显示)</option>
        <option value="always">常规 (成功+警告+错误)</option>
        <option value="notice" selected>安静 (仅警告+错误)</option>
        <option value="error">最低 (仅错误)</option>
        <option value="silence">静默 (不弹窗)</option>
      </select>
    </label>
  </div>

  <!-- 调试区 -->
  <div class="varupdate-debug">
    <label>当前变量状态 (只读):</label>
    <textarea id="varupdate-debug-state" readonly rows="6" style="width:100%; font-family:monospace; font-size:12px;"></textarea>
  </div>
</div>
`;

// ═══════════════════════════════════════════
//  面板样式
// ═══════════════════════════════════════════

const PANEL_CSS = `
  #varupdate-panel {
    padding: 10px;
  }
  .varupdate-actions {
    display: flex;
    gap: 5px;
    margin-bottom: 10px;
  }
  .varupdate-settings-group {
    margin-bottom: 10px;
  }
  .varupdate-debug {
    margin-top: 10px;
  }
`;

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
 * 渲染 UI 面板
 *
 * @param cbs 按钮回调函数
 */
export function renderPanel(cbs: PanelCallbacks = {}): void {
  callbacks = cbs;

  try {
    // 注入样式
    if (!document.getElementById('varupdate-style')) {
      const style = document.createElement('style');
      style.id = 'varupdate-style';
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }

    // 注入 HTML（找到酒馆助手的脚本面板容器）
    const container = document.getElementById('extensions_settings') || document.body;
    const existing = document.getElementById('varupdate-panel');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML;
    container.appendChild(wrapper.firstElementChild!);

    // 绑定事件
    bindEvents();

    // 加载已保存的设置
    loadSettings();

  } catch (e) {
    notify.warning('UI 面板', `面板渲染失败: ${(e as Error).message}`);
  }
}

/**
 * 注册魔棒工具菜单选项
 *
 * 酒馆助手的魔棒工具菜单是 `#extensionsMenu` 容器。
 * 变量管理器/日志管理器等工具以列表项的形式存在于该容器中。
 * 脚本通过往宿主页面的 `#extensionsMenu` 追加 DOM 元素来注册入口。
 */
export function registerWandButtons(): void {
  try {
    // 获取宿主页面的 #extensionsMenu 容器
    const hostDoc = window.parent?.document || document;
    const menu = hostDoc.getElementById('extensionsMenu');
    if (!menu) {
      notify.debug('魔棒菜单', '#extensionsMenu 未找到，跳过注册');
      return;
    }

    // 注册「当前楼层重解析」
    addWandMenuItem(menu, hostDoc, {
      icon: 'fa-solid fa-rotate',
      label: '重解析当前楼层',
      onClick: () => callbacks.onManualUpdate?.(),
    });

    // 注册「设置变量检查点」— 暂定
    // addWandMenuItem(menu, hostDoc, {
    //   icon: 'fa-solid fa-bookmark',
    //   label: '设置变量检查点',
    //   onClick: () => { /* TODO */ },
    // });

  } catch (e) {
    notify.debug('魔棒菜单', `注册失败: ${(e as Error).message}`);
  }
}

/**
 * 向魔棒菜单追加一个选项
 */
function addWandMenuItem(
  menu: HTMLElement,
  doc: Document,
  opts: { icon: string; label: string; onClick: () => void }
): void {
  // 避免重复添加
  if (menu.querySelector(`[data-varupdate="${opts.label}"]`)) return;

  // 创建与酒馆助手已有菜单项相同结构的 DOM
  const container = doc.createElement('div');
  container.className = 'extension_container';
  container.setAttribute('data-varupdate', opts.label);

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

/**
 * 刷新调试区的变量状态显示
 */
export function refreshDebugState(data: Record<string, any>): void {
  const textarea = document.getElementById('varupdate-debug-state') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.value = JSON.stringify(data, null, 2);
  }
}

// ═══════════════════════════════════════════
//  内部实现
// ═══════════════════════════════════════════

function bindEvents(): void {
  document.getElementById('varupdate-btn-init')?.addEventListener('click', () => {
    callbacks.onManualInit?.();
  });

  document.getElementById('varupdate-btn-update')?.addEventListener('click', () => {
    callbacks.onManualUpdate?.();
  });

  document.getElementById('varupdate-btn-reset')?.addEventListener('click', () => {
    if (confirm('确定要重置所有变量吗？')) {
      callbacks.onReset?.();
    }
  });

  document.getElementById('varupdate-notify-level')?.addEventListener('change', (e) => {
    const level = (e.target as HTMLSelectElement).value as NotifyLevel;
    notify.setLevel(level);
    saveSettings();
  });
}

function loadSettings(): void {
  try {
    const globalData = readVariables('global');
    const settings = globalData._varupdate_settings;
    if (settings) {
      if (settings.notifyLevel) {
        notify.setLevel(settings.notifyLevel);
        const select = document.getElementById('varupdate-notify-level') as HTMLSelectElement;
        if (select) select.value = settings.notifyLevel;
      }
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
