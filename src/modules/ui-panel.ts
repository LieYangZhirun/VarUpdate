/**
 * modules/ui-panel.ts
 *
 * 模块 9：UI 面板
 *
 * 参考 MVU Panel.vue 的实现模式：
 * - 挂载到 #extensions_settings2（酒馆助手脚本面板区域）
 * - 使用 inline-drawer（由宿主 jQuery 自动处理折叠）
 * - 帮助图标 fa-circle-question + callGenericPopup 弹窗
 * - 样式通过 teleportStyle 传送到宿主 <head>
 *
 * H-1 独立面板：
 *   1. 使用指南按钮
 *   2. 操作按钮 × 5（完整文本，不缩写）
 *   3. 设置区域（通知等级 + 自动初始化 + 容错阈值 + 变量生命周期）
 *
 * H-2 魔棒快捷按钮 × 2：
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
//  帮助弹窗内容（HTML 格式，参考 MVU helpTexts）
// ═══════════════════════════════════════════

const HELP: Record<string, { title: string; content: string }> = {
  guide: {
    title: '📖 VarUpdate 使用指南',
    content: `<b>VarUpdate</b> 为角色卡提供结构化变量管理能力。<br><br>
<b>核心概念：</b><br>
• <b>Schema</b> — 在世界书 <code>[Var_Schema]</code> 中定义变量结构和约束<br>
• <b>Default</b> — 在世界书 <code>[Var_Default]</code> 中提供默认值<br>
• <b>Initial</b> — 在消息 <code>&lt;Var_Initial&gt;</code> 中设定初始状态<br>
• <b>Update</b> — 在消息 <code>&lt;Var_Update&gt;</code> 中增量修改变量<br><br>
<b>执行流程：</b><br>
1. 加载 Schema → 编译校验器<br>
2. 每条消息生成后自动扫描变量标签<br>
3. 先执行 Initial（清空并赋值），再执行 Update（增量修改）<br>
4. 用 Schema 校验最终状态<br><br>
<b>插值宏：</b><code>{{message/data/变量路径}}</code> 可在提示词中引用变量值。`,
  },
  reloadRules: {
    title: '重新加载格式规则',
    content: `从世界书重新读取 <code>[Var_Schema]</code> 和 <code>[Var_Default]</code> 条目，重新编译并覆盖当前聊天中的旧规则。<br><br>
<b>使用场景：</b>修改了世界书中的变量定义后，需要手动同步到当前聊天。<br><br>
⚠️ 新规则只影响之后的变量校验，不会自动修改已有变量值。`,
  },
  reinitFromGreeting: {
    title: '从开场白重新初始化',
    content: `重新读取开场白消息中的 <code>&lt;Var_Initial&gt;</code> 标签，重建第 0 层的变量状态。<br><br>
<b>使用场景：</b>修改了开场白的初始变量后，需要重新应用。`,
  },
  reparseFloor: {
    title: '重新解析当前楼层',
    content: `清除当前最新楼层的变量数据，重新解析该楼层消息中的变量标签并执行。<br><br>
<b>使用场景：</b>怀疑变量状态不正确时，手动重跑当前层的解析。`,
  },
  setCheckpoint: {
    title: '将当前楼层设为检查点',
    content: `将当前最新楼层标记为检查点，变量数据在自动清理时被保留。<br><br>
<b>使用场景：</b>对话关键节点（如战斗开始、场景切换）时设定回退锚点。<br><br>
💡 检查点配合「链式重解析」使用，可以从检查点恢复变量链。`,
  },
  reparseFromCheckpoint: {
    title: '从上个检查点逐层重新解析',
    content: `从最近的检查点楼层开始，依次对后续每层重新执行变量解析和更新。<br><br>
<b>使用场景：</b>检查点之后的变量链出了问题，需要全量修复。<br><br>
⚠️ 操作不可撤销，会覆盖检查点之后所有楼层的变量。`,
  },
  notifyLevel: {
    title: '通知等级',
    content: `控制 toastr 弹窗和控制台输出的信息级别：<br><br>
• <b>debug</b>：全部显示（调试+成功+警告+错误）<br>
• <b>always</b>：成功+警告+错误<br>
• <b>notice</b>（默认）：仅警告+错误<br>
• <b>error</b>：仅错误<br>
• <b>silence</b>：完全静默`,
  },
  autoInit: {
    title: '自动初始化',
    content: `<b>开启</b>：创建新聊天后，自动识别开场白中的 <code>&lt;Var_Initial&gt;</code> 标签并执行初始化。<br><br>
<b>关闭</b>：需手动点击「从开场白重新初始化」按钮触发。`,
  },
  toleranceThreshold: {
    title: '容错阈值',
    content: `单次解析中被丢弃的指令数：<br><br>
• <b>≤ 阈值</b> → 视为<b>警告</b>（变量更新完成，通知用户检查）<br>
• <b>&gt; 阈值</b> → 视为<b>失败</b>（广播失败事件，触发 Agents 重试）<br><br>
💡 默认值为 2，适合大多数场景。`,
  },
  varLifecycle: {
    title: '变量生命周期',
    content: `保留最近 N 层消息的完整变量数据，超出部分自动清理以控制聊天文件体积。<br><br>
• 被标记为<b>检查点</b>的楼层始终保留<br>
• 清理仅删除变量数据，不影响消息内容<br><br>
💡 建议设为 20，确保最近的对话有完整变量数据。`,
  },
};

function showHelp(key: string): void {
  const h = HELP[key];
  if (!h) return;
  try {
    // SillyTavern 是酒馆助手注入到 iframe 的直接全局变量
    const ST = (globalThis as any).SillyTavern;
    if (ST?.callGenericPopup) {
      ST.callGenericPopup(h.content, ST.POPUP_TYPE.TEXT, '', {
        wide: false, large: false, okButton: '了解', cancelButton: false,
      });
      return;
    }
  } catch { /* fallback */ }
  // fallback to toastr
  try {
    const t = (globalThis as any).toastr;
    if (t?.info) {
      t.info(h.content.replace(/<[^>]+>/g, ''), h.title, { timeOut: 10000, closeButton: true });
      return;
    }
  } catch { /* fallback */ }
  alert(`${h.title}\n\n${h.content.replace(/<[^>]+>/g, '')}`);
}

// ═══════════════════════════════════════════
//  面板 CSS（参考 MVU scoped style）
// ═══════════════════════════════════════════

const PANEL_CSS = `
.varupdate-button-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 10px;
}
.varupdate-btn {
  background-color: var(--SmartThemeBlurTintColor);
  border: 1px solid var(--SmartThemeBorderColor);
  border-radius: 5px;
  padding: 5px 10px;
  text-align: center;
  cursor: pointer;
  flex: 1 1 45%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 0.9em;
  transition: background-color 0.2s;
}
.varupdate-btn:hover {
  background-color: var(--SmartThemeHoverColor);
}
.varupdate-button-grid .varupdate-btn:nth-child(n+3) {
  flex: 1 1 30%;
}
.varupdate-settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 5px;
}
.varupdate-settings-grid .varupdate-setting-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.varupdate-settings-grid label {
  white-space: nowrap;
  font-size: 0.9em;
}
.varupdate-settings-grid .text_pole {
  width: 100%;
}
.varupdate-settings-grid input[type="number"].text_pole {
  width: 5rem;
}
.varupdate-help-icon {
  cursor: pointer;
  margin-left: 3px;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.varupdate-help-icon:hover {
  opacity: 1;
}
`;

// ═══════════════════════════════════════════
//  面板 HTML（参考 MVU Panel.vue template）
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>VarUpdate 变量框架</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

    <!-- 顶部快捷按钮区 -->
    <div class="varupdate-button-grid">
      <div class="varupdate-btn" id="varupdate-btn-reload" title="从世界书重新读取 Schema 和 Default">
        <i class="fa-solid fa-arrows-rotate"></i> 重新加载格式规则
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reinit" title="重新读取开场白中的 Var_Initial 标签">
        <i class="fa-solid fa-file-import"></i> 从开场白重新初始化
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse" title="重新解析当前最新楼层的变量标签">
        <i class="fa-solid fa-rotate-right"></i> 重新解析当前楼层
      </div>
      <div class="varupdate-btn" id="varupdate-btn-checkpoint" title="将当前楼层设为快照锚点">
        <i class="fa-solid fa-camera"></i> 将当前楼层设为检查点
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse-chain" title="从最近的检查点逐层重新解析">
        <i class="fa-solid fa-play"></i> 从上个检查点逐层重新解析
      </div>
    </div>

    <div class="varupdate-btn" id="varupdate-btn-guide" title="查看脚本使用说明" style="margin-bottom:10px;">
      <i class="fa-solid fa-book-open"></i> 使用指南
    </div>

    <hr />

    <!-- 设置区域 (2x2 grid) -->
    <div class="varupdate-settings-grid">
      <div class="varupdate-setting-item">
        <label for="varupdate-notify-level">通知等级</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-notify"></i>
        <select id="varupdate-notify-level" class="text_pole">
          <option value="debug">debug</option>
          <option value="always">always</option>
          <option value="notice" selected>notice</option>
          <option value="error">error</option>
          <option value="silence">silence</option>
        </select>
      </div>
      <div class="varupdate-setting-item">
        <input id="varupdate-auto-init" type="checkbox" checked />
        <label for="varupdate-auto-init">自动读取开场白</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-autoinit"></i>
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-tolerance">容错阈值</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-tolerance"></i>
        <input id="varupdate-tolerance" type="number" class="text_pole" min="0" max="99" step="1" value="2" />
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-lifecycle">生命周期</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-lifecycle"></i>
        <input id="varupdate-lifecycle" type="number" class="text_pole" min="1" max="9999" step="1" value="20" />
        <span style="opacity:0.5; font-size:0.85em;">层</span>
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
//  样式传送（参考 MVU teleportStyle）
// ═══════════════════════════════════════════

function teleportStyle(): void {
  try {
    const hostDoc = getHostDocument();
    const styleId = 'varupdate-teleported-style';
    if (hostDoc.getElementById(styleId)) return;

    const styleEl = hostDoc.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = PANEL_CSS;
    hostDoc.head.appendChild(styleEl);
  } catch { /* 静默 */ }
}

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

    // 传送样式到宿主 <head>
    teleportStyle();

    // 挂载到 #extensions_settings2（参考 MVU）
    const container = hostDoc.getElementById('extensions_settings2')
      || hostDoc.getElementById('extensions_settings');
    if (!container) {
      notify.debug('面板', '#extensions_settings2 未找到');
      return;
    }

    const wrapper = hostDoc.createElement('div');
    wrapper.innerHTML = PANEL_HTML.trim();
    const panel = wrapper.firstElementChild;
    if (panel) container.appendChild(panel);

    // ─── 不手动绑定 inline-drawer toggle ───
    // SillyTavern 宿主的 jQuery 自动处理 inline-drawer 折叠逻辑

    // 操作按钮
    bind(hostDoc, 'varupdate-btn-guide', () => showHelp('guide'));
    bind(hostDoc, 'varupdate-btn-reload', () => callbacks.onReloadRules?.());
    bind(hostDoc, 'varupdate-btn-reinit', () => callbacks.onReinitFromGreeting?.());
    bind(hostDoc, 'varupdate-btn-reparse', () => callbacks.onReparseFloor?.());
    bind(hostDoc, 'varupdate-btn-checkpoint', () => callbacks.onSetCheckpoint?.());
    bind(hostDoc, 'varupdate-btn-reparse-chain', () => callbacks.onReparseFromCheckpoint?.());

    // 帮助图标
    bind(hostDoc, 'varupdate-help-notify', () => showHelp('notifyLevel'));
    bind(hostDoc, 'varupdate-help-autoinit', () => showHelp('autoInit'));
    bind(hostDoc, 'varupdate-help-tolerance', () => showHelp('toleranceThreshold'));
    bind(hostDoc, 'varupdate-help-lifecycle', () => showHelp('varLifecycle'));

    // 设置项变更
    hostDoc.getElementById('varupdate-notify-level')?.addEventListener('change', (e) => {
      const level = (e.target as HTMLSelectElement).value as NotifyLevel;
      notify.setLevel(level);
      saveSettings(hostDoc);
    });
    hostDoc.getElementById('varupdate-auto-init')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-tolerance')?.addEventListener('change', () => saveSettings(hostDoc));
    hostDoc.getElementById('varupdate-lifecycle')?.addEventListener('change', () => saveSettings(hostDoc));

    loadSettings(hostDoc);

  } catch (e) {
    notify.warning('面板', `渲染失败: ${(e as Error).message}`);
  }
}

/**
 * H-2 魔棒快捷按钮
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
      icon: 'fa-solid fa-rotate-right',
      label: '当前楼层重解析',
      onClick: () => callbacks.onReparseFloor?.(),
    });

    addWandMenuItem(menu, hostDoc, {
      id: 'varupdate-wand-checkpoint',
      icon: 'fa-solid fa-camera',
      label: '设置变量检查点',
      onClick: () => callbacks.onSetCheckpoint?.(),
    });

  } catch (e) {
    notify.debug('魔棒', `注册失败: ${(e as Error).message}`);
  }
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

/**
 * 调试输出（功能卡未定义调试区，仅控制台）
 */
export function refreshDebugState(data: Record<string, any>): void {
  console.log('%c[VarUpdate] 变量状态:', 'color: #50C878; font-weight: bold;', data);
}

// ═══════════════════════════════════════════
//  内部工具
// ═══════════════════════════════════════════

function bind(doc: Document, id: string, handler: () => void): void {
  doc.getElementById(id)?.addEventListener('click', handler);
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
  } catch { /* 首次使用 */ }
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
  } catch { /* 静默 */ }
}
