/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板
 *
 * 严格按照面向用户功能卡 H-1 / H-2 / J-1 实现。
 *
 * H-1 独立面板（注入到宿主 #extensions_settings）：
 *   1. 使用指南区域 — 总指南按钮 + 各功能项旁的 ℹ️
 *   2. 操作按钮区域 — 5 个按钮
 *   3. 设置区域 — 通知等级 + 自动初始化 + 容错阈值 + 变量生命周期
 *
 * H-2 魔棒快捷按钮（注入到宿主 #extensionsMenu）：
 *   - 当前楼层重解析
 *   - 设置变量检查点
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
//  提示文案
// ═══════════════════════════════════════════

const TIPS = {
  reloadRules:
    '从世界书重新读取 [Var_Schema] 和 [Var_Default] 条目，重新编译并覆盖当前聊天中的旧规则。\n\n使用场景：修改了世界书中的变量定义后，需要手动同步到当前聊天。',
  reinitFromGreeting:
    '重新读取开场白消息中的 <Var_Initial> 标签，重建第 0 层的变量状态。\n\n使用场景：修改了开场白的初始变量后需要重新生效。',
  reparseFloor:
    '清除当前最新楼层的变量数据，重新解析该楼层消息中的变量标签并执行。\n\n使用场景：怀疑变量状态不正确时，手动重跑当前层。',
  setCheckpoint:
    '将当前最新楼层标记为检查点，变量数据在自动清理时被保留。\n\n使用场景：对话关键节点（如战斗开始、场景切换）时设定回退锚点。',
  reparseFromCheckpoint:
    '从最近的检查点楼层开始，依次对后续每层重新执行变量解析和更新。\n\n使用场景：检查点之后的变量链出了问题，需要全量修复。',
  notifyLevel:
    '控制 toastr 弹窗和控制台输出的信息级别。\n• debug：全部显示\n• always：成功+警告+错误\n• notice（默认）：仅警告+错误\n• error：仅错误\n• silence：完全静默',
  autoInit:
    '开启时，创建新聊天后自动识别开场白中的 <Var_Initial> 标签并执行变量初始化。\n关闭时需手动点击「从开场白重新初始化」按钮。',
  toleranceThreshold:
    '单次解析中被丢弃的指令数 ≤ 此值 → 警告（继续）\n超过此值 → 失败（触发 Agents 重试）',
  varLifecycle:
    '保留最近 N 层消息的完整变量数据，超出部分自动清理以控制聊天文件体积。\n被标记为检查点的楼层始终保留。',
  guide:
    '📖 VarUpdate 使用指南\n\n本脚本为角色卡提供结构化变量管理能力。\n\n核心概念：\n• Schema — 在世界书 [Var_Schema] 中定义变量结构\n• Default — 在世界书 [Var_Default] 中提供默认值\n• Initial — 在消息 <Var_Initial> 中设定初始值\n• Update — 在消息 <Var_Update> 中增量修改\n\n变量数据存储在酒馆助手变量系统中，可通过变量管理器查看。\n插值宏：{{message/data/路径}} 可在提示词中引用变量值。',
};

// ═══════════════════════════════════════════
//  面板 HTML
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>🔧 VarUpdate</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

    <!-- 使用指南 -->
    <div class="flex-container" style="margin-bottom:4px;">
      <div id="varupdate-btn-guide" class="menu_button menu_button_icon" title="查看使用指南">
        <i class="fa-solid fa-book-open"></i>
        <small>使用指南</small>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="section-divider">操作<hr class="sysHR" /></div>
    <div class="flex-container" style="gap:4px; flex-wrap:wrap;">
      <div id="varupdate-btn-reload" class="menu_button menu_button_icon" title="重新加载格式规则">
        <i class="fa-solid fa-arrows-rotate"></i>
        <small>加载规则</small>
      </div>
      <div id="varupdate-tip-reload" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>
    <div class="flex-container" style="gap:4px; flex-wrap:wrap; margin-top:4px;">
      <div id="varupdate-btn-reinit" class="menu_button menu_button_icon" title="从开场白重新初始化">
        <i class="fa-solid fa-play"></i>
        <small>初始化</small>
      </div>
      <div id="varupdate-tip-reinit" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>
    <div class="flex-container" style="gap:4px; flex-wrap:wrap; margin-top:4px;">
      <div id="varupdate-btn-reparse" class="menu_button menu_button_icon" title="重新解析当前楼层">
        <i class="fa-solid fa-rotate"></i>
        <small>重解析</small>
      </div>
      <div id="varupdate-tip-reparse" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>
    <div class="flex-container" style="gap:4px; flex-wrap:wrap; margin-top:4px;">
      <div id="varupdate-btn-checkpoint" class="menu_button menu_button_icon" title="将当前楼层设为检查点">
        <i class="fa-solid fa-bookmark"></i>
        <small>设检查点</small>
      </div>
      <div id="varupdate-tip-checkpoint" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>
    <div class="flex-container" style="gap:4px; flex-wrap:wrap; margin-top:4px;">
      <div id="varupdate-btn-reparse-chain" class="menu_button menu_button_icon" title="从上个检查点逐层重新解析">
        <i class="fa-solid fa-forward"></i>
        <small>链式重解析</small>
      </div>
      <div id="varupdate-tip-reparse-chain" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>

    <!-- 设置 -->
    <div class="section-divider">设置<hr class="sysHR" /></div>

    <div class="flex-container alignItemsCenter" style="gap:8px; margin-top:4px;">
      <label for="varupdate-notify-level">通知等级</label>
      <select id="varupdate-notify-level" class="text_pole" style="flex:1;">
        <option value="debug">debug (全部)</option>
        <option value="always">always (成功+警告+错误)</option>
        <option value="notice" selected>notice (仅警告+错误)</option>
        <option value="error">error (仅错误)</option>
        <option value="silence">silence (静默)</option>
      </select>
      <div id="varupdate-tip-notify" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>

    <div class="flex-container alignItemsCenter" style="gap:8px; margin-top:4px;">
      <input type="checkbox" id="varupdate-auto-init" checked />
      <label for="varupdate-auto-init">自动初始化</label>
      <div id="varupdate-tip-autoinit" class="menu_button menu_button_icon" style="padding:2px 6px; margin-left:auto;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>

    <div class="flex-container alignItemsCenter" style="gap:8px; margin-top:4px;">
      <label for="varupdate-tolerance">容错阈值</label>
      <input id="varupdate-tolerance" type="number" class="text_pole" min="0" max="99" step="1" value="2" style="width:5rem;" />
      <div id="varupdate-tip-tolerance" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>

    <div class="flex-container alignItemsCenter" style="gap:8px; margin-top:4px;">
      <label for="varupdate-lifecycle">变量生命周期</label>
      <input id="varupdate-lifecycle" type="number" class="text_pole" min="1" max="9999" step="1" value="20" style="width:5rem;" />
      <div id="varupdate-tip-lifecycle" class="menu_button menu_button_icon" style="padding:2px 6px;" title="说明">
        <i class="fa-solid fa-circle-info"></i>
      </div>
    </div>

  </div>
</div>
`;

// ═══════════════════════════════════════════
//  回调容器
// ═══════════════════════════════════════════

interface PanelCallbacks {
  onReloadRules?: () => void;
  onReinitFromGreeting?: () => void;
  onReparseFloor?: () => void;
  onSetCheckpoint?: () => void;
  onReparseFromCheckpoint?: () => void;
}

let callbacks: PanelCallbacks = {};

// ═══════════════════════════════════════════
//  公开接口
// ═══════════════════════════════════════════

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
    if (hostDoc.getElementById('varupdate-settings')) return;

    const container = hostDoc.getElementById('extensions_settings');
    if (!container) {
      notify.debug('面板', '#extensions_settings 未找到');
      return;
    }

    const wrapper = hostDoc.createElement('div');
    wrapper.innerHTML = PANEL_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (panel) container.appendChild(panel);

    // 折叠/展开
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

    // 操作按钮
    bindClick(hostDoc, 'varupdate-btn-guide', () => showTip(TIPS.guide));
    bindClick(hostDoc, 'varupdate-btn-reload', () => callbacks.onReloadRules?.());
    bindClick(hostDoc, 'varupdate-btn-reinit', () => callbacks.onReinitFromGreeting?.());
    bindClick(hostDoc, 'varupdate-btn-reparse', () => callbacks.onReparseFloor?.());
    bindClick(hostDoc, 'varupdate-btn-checkpoint', () => callbacks.onSetCheckpoint?.());
    bindClick(hostDoc, 'varupdate-btn-reparse-chain', () => callbacks.onReparseFromCheckpoint?.());

    // 提示按钮
    bindClick(hostDoc, 'varupdate-tip-reload', () => showTip(TIPS.reloadRules));
    bindClick(hostDoc, 'varupdate-tip-reinit', () => showTip(TIPS.reinitFromGreeting));
    bindClick(hostDoc, 'varupdate-tip-reparse', () => showTip(TIPS.reparseFloor));
    bindClick(hostDoc, 'varupdate-tip-checkpoint', () => showTip(TIPS.setCheckpoint));
    bindClick(hostDoc, 'varupdate-tip-reparse-chain', () => showTip(TIPS.reparseFromCheckpoint));
    bindClick(hostDoc, 'varupdate-tip-notify', () => showTip(TIPS.notifyLevel));
    bindClick(hostDoc, 'varupdate-tip-autoinit', () => showTip(TIPS.autoInit));
    bindClick(hostDoc, 'varupdate-tip-tolerance', () => showTip(TIPS.toleranceThreshold));
    bindClick(hostDoc, 'varupdate-tip-lifecycle', () => showTip(TIPS.varLifecycle));

    // 设置项变更
    hostDoc.getElementById('varupdate-notify-level')?.addEventListener('change', (e) => {
      const level = (e.target as HTMLSelectElement).value as NotifyLevel;
      notify.setLevel(level);
      saveSettings(hostDoc);
    });
    hostDoc.getElementById('varupdate-auto-init')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-tolerance')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-lifecycle')?.addEventListener('change', () => saveSettings(hostDoc));

    // 加载已保存设置
    loadSettings(hostDoc);

  } catch (e) {
    notify.warning('面板', `渲染失败: ${(e as Error).message}`);
  }
}

/**
 * H-2 魔棒快捷按钮
 * - 当前楼层重解析
 * - 设置变量检查点
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
      label: '当前楼层重解析',
      onClick: () => callbacks.onReparseFloor?.(),
    });

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-checkpoint',
      icon: 'fa-solid fa-bookmark',
      label: '设置变量检查点',
      onClick: () => callbacks.onSetCheckpoint?.(),
    });

  } catch (e) {
    notify.debug('魔棒', `注册失败: ${(e as Error).message}`);
  }
}

/**
 * 刷新调试面板中的变量状态
 * （功能卡未定义调试区，但保留用于控制台输出）
 */
export function refreshDebugState(data: Record<string, any>): void {
  console.log('%c[VarUpdate] 当前变量状态:', 'color: #50C878; font-weight: bold;', data);
}

/**
 * 读取面板中的设置值
 */
export function getPanelSettings(): {
  autoInit: boolean;
  toleranceThreshold: number;
  varLifecycle: number;
} {
  try {
    const hostDoc = getHostDocument();
    return {
      autoInit: (hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement)?.checked ?? true,
      toleranceThreshold: parseInt((hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement)?.value || '2', 10),
      varLifecycle: parseInt((hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement)?.value || '20', 10),
    };
  } catch {
    return { autoInit: true, toleranceThreshold: 2, varLifecycle: 20 };
  }
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function bindClick(doc: Document, id: string, handler: () => void): void {
  doc.getElementById(id)?.addEventListener('click', handler);
}

function showTip(text: string): void {
  try {
    const t = typeof toastr !== 'undefined' ? toastr : (typeof parent !== 'undefined' ? (parent as any).toastr : null);
    if (t?.info) {
      t.info(text, '[VarUpdate]', { timeOut: 8000, extendedTimeOut: 4000, closeButton: true });
    } else {
      alert(text);
    }
  } catch {
    alert(text);
  }
}

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

function loadSettings(hostDoc: Document): void {
  try {
    const globalData = readVariables('global');
    const s = globalData._varupdate_settings;
    if (!s) return;

    if (s.notifyLevel) {
      notify.setLevel(s.notifyLevel);
      const sel = hostDoc.getElementById('varupdate-notify-level') as HTMLSelectElement;
      if (sel) sel.value = s.notifyLevel;
    }
    if (s.autoInit !== undefined) {
      const cb = hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement;
      if (cb) cb.checked = s.autoInit;
    }
    if (s.toleranceThreshold !== undefined) {
      const inp = hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement;
      if (inp) inp.value = String(s.toleranceThreshold);
    }
    if (s.varLifecycle !== undefined) {
      const inp = hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement;
      if (inp) inp.value = String(s.varLifecycle);
    }
  } catch {
    // 首次使用无设置
  }
}

function saveSettings(hostDoc: Document): void {
  try {
    const globalData = readVariables('global');
    globalData._varupdate_settings = {
      notifyLevel: notify.getLevel(),
      autoInit: (hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement)?.checked ?? true,
      toleranceThreshold: parseInt((hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement)?.value || '2', 10),
      varLifecycle: parseInt((hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement)?.value || '20', 10),
    };
    writeVariables('global', globalData);
  } catch {
    // 静默
  }
}
