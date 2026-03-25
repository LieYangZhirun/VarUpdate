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
 *   3. 设置区域（通知等级 + 自动从开场白初始化 + 容错阈值 + 楼层变量生命周期）
 *
 * H-2 魔棒快捷按钮 × 2：
 *   - 重新解析当前楼层
 *   - 设置变量检查点
 */

import * as notify from './notification.js';
import { readVariables, writeVariables } from './variable-store.js';
import type { NotifyLevel } from '../types/index.js';

// ═══════════════════════════════════════════
//  常量
// ═══════════════════════════════════════════

/** 持久化存储键名 */
const CONFIG_KEY = 'VarUpdate_config';

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
    content: `<b>VarUpdate</b> 是一个结构化变量管理框架，让角色卡能够自动跟踪和维护结构化状态（如 HP、好感度、库存等）。<br><br>
<b>核心概念：</b><br>
• <b>格式规则 (Schema)</b> — 在世界书中用 <code>[Var_Schema]</code> 标签定义变量的结构、类型约束和取值范围<br>
• <b>默认值 (Default)</b> — 在世界书中用 <code>[Var_Default]</code> 标签定义新变量的初始填充值<br>
• <b>初始化 (Initial)</b> — 在开场白中用 <code>&lt;Var_Initial&gt;</code> 标签设定变量的起始状态<br>
• <b>增量更新 (Update)</b> — 在消息中用 <code>&lt;Var_Update&gt;</code> 标签以 JSON Patch 格式修改变量<br><br>
<b>自动执行流程：</b><br>
1. 聊天开始时 → 加载世界书中的 Schema 和 Default → 编译校验器<br>
2. 开场白生成时 → 扫描 <code>&lt;Var_Initial&gt;</code> → 建立初始变量<br>
3. 每条消息生成后 → 扫描 <code>&lt;Var_Update&gt;</code> → 校验并执行增量修改<br>
4. 校验失败的指令被丢弃，成功的写入当前楼层<br><br>
<b>在提示词中引用变量：</b><br>
<code>{{getvar::变量名}}</code> 或 <code>{{message/data/变量路径}}</code> 即可在提示词中插入变量值。`,
  },
  reloadRules: {
    title: '🔄 重新加载格式规则',
    content: `<b>功能：</b>从世界书中重新读取 <code>[Var_Schema]</code>（结构定义）和 <code>[Var_Default]</code>（默认值），重新编译校验器并覆盖当前聊天中缓存的旧规则。<br><br>
<b>什么时候需要用？</b><br>
• 你刚修改了世界书中的变量定义（比如新增了一个字段、改了取值范围）<br>
• 聊天中的变量校验报错，你怀疑是旧 Schema 导致的<br><br>
<b>注意：</b><br>
⚠️ 只影响之后的变量校验，不会回溯修改已有楼层的变量值。<br>
💡 如果需要强制重算，请配合「重新解析当前楼层」或「从检查点逐层重新解析」使用。`,
  },
  reinitFromGreeting: {
    title: '📝 从开场白重新初始化',
    content: `<b>功能：</b>重新扫描开场白（第 0 层消息）中的 <code>&lt;Var_Initial&gt;</code> 标签，清空并重建初始变量。<br><br>
<b>什么时候需要用？</b><br>
• 你手动编辑了开场白中的初始变量值<br>
• 初始化时出了错，想重新执行一遍<br><br>
<b>注意：</b><br>
⚠️ 会清空第 0 层已有的变量数据并重新写入。<br>
💡 不影响后续楼层的变量，若需全量修复请配合「从检查点逐层重新解析」。`,
  },
  reparseFloor: {
    title: '🔁 重新解析当前楼层',
    content: `<b>功能：</b>清除当前最新楼层的变量数据，对该楼层的消息内容重新进行标签扫描和变量更新。<br><br>
<b>什么时候需要用？</b><br>
• 手动编辑了最新一条消息中的 <code>&lt;Var_Update&gt;</code> 标签<br>
• 怀疑变量状态不正确，想手动重跑一遍<br>
• AI 输出了截断的标签，你补全后需要重新解析<br><br>
💡 只对最新一层生效。如果需要修复多层，请使用「从检查点逐层重新解析」。`,
  },
  setCheckpoint: {
    title: '📌 将当前楼层设为检查点',
    content: `<b>功能：</b>将当前最新楼层标记为「检查点」，该楼层的变量数据在自动清理时会被保留。<br><br>
<b>什么时候需要用？</b><br>
• 对话到达了一个关键节点（如战斗开始、场景切换、重要分支）<br>
• 需要一个「存档点」以便后续回退和修复<br><br>
<b>工作原理：</b><br>
• 检查点是「链式重解析」的起点——从检查点开始逐层重算，恢复完整变量链<br>
• 变量清理策略会跳过检查点楼层，确保锚点数据不丢失<br><br>
💡 建议在每个重要剧情节点设置一个检查点，类似游戏存档。`,
  },
  reparseFromCheckpoint: {
    title: '⏩ 从检查点逐层重新解析',
    content: `<b>功能：</b>找到最近的检查点楼层，从该检查点的下一层开始，依次对后续每一层重新执行标签扫描和变量更新。<br><br>
<b>什么时候需要用？</b><br>
• 发现多个楼层的变量都不对，需要从一个已知正确的状态全量修复<br>
• 手动编辑了中间楼层的消息，需要重算后续影响<br><br>
<b>工作原理：</b><br>
1. 向前搜索最近的检查点楼层<br>
2. 从检查点的下一层开始，逐层重新解析<br>
3. 如果找不到检查点，则从第 0 层开始重算所有楼层<br><br>
⚠️ <b>操作不可撤销！</b>会覆盖检查点之后所有楼层的变量数据。<br>
💡 在执行前建议先确认检查点的位置是否正确。`,
  },
  notifyLevel: {
    title: '🔔 通知等级',
    content: `控制 VarUpdate 弹出通知（toastr）和控制台日志的信息级别：<br><br>
<table style="width:100%; border-collapse:collapse;">
<tr><td style="padding:4px;"><b>debug</b></td><td style="padding:4px;">显示所有信息：调试细节 + 成功 + 警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>always</b></td><td style="padding:4px;">显示操作结果：成功 + 警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>notice</b></td><td style="padding:4px;">（默认）仅显示需要注意的：警告 + 错误</td></tr>
<tr><td style="padding:4px;"><b>error</b></td><td style="padding:4px;">仅显示错误</td></tr>
<tr><td style="padding:4px;"><b>silence</b></td><td style="padding:4px;">完全静默，不弹出任何通知</td></tr>
</table><br>
💡 日常使用建议 <b>notice</b>；调试问题时切换为 <b>debug</b>。`,
  },
  autoInit: {
    title: '⚡ 自动从开场白初始化',
    content: `<b>开启（推荐）：</b><br>
新建聊天或切换聊天时，脚本会自动扫描开场白中的 <code>&lt;Var_Initial&gt;</code> 标签并执行变量初始化，无需手动操作。<br><br>
<b>关闭：</b><br>
不会自动初始化，你需要手动点击面板上的「从开场白重新初始化」按钮来触发。<br><br>
💡 大多数情况下建议保持开启。如果你的角色卡不需要开场白初始化（比如只在后续消息中写 Update），可以关闭。`,
  },
  toleranceThreshold: {
    title: '🎯 容错阈值',
    content: `控制一次变量更新中「可接受的丢弃指令数」：<br><br>
当 AI 输出的 <code>&lt;Var_Update&gt;</code> 中有部分指令因校验失败被丢弃时：<br>
• 丢弃数 <b>≤ 阈值</b> → 视为<b>警告</b>：变量正常更新，但会通知你检查<br>
• 丢弃数 <b>&gt; 阈值</b> → 视为<b>失败</b>：广播失败事件，可触发 Agents 自动重试<br><br>
<b>建议值：</b><br>
• <b>2</b>（默认）— 适合大多数场景，容忍少量格式错误<br>
• <b>0</b> — 严格模式，任何指令丢弃都视为失败<br>
• <b>5+</b> — 宽松模式，适合变量字段多、AI 容易犯错的场景`,
  },
  varLifecycle: {
    title: '📦 楼层变量生命周期',
    content: `控制保留最近多少层消息的完整变量数据：<br><br>
• 超出范围的旧楼层变量会被自动清理，以控制聊天文件体积<br>
• 被标记为<b>检查点</b>的楼层<b>始终保留</b>，不受清理影响<br>
• 清理只删除变量数据，<b>不影响消息内容</b><br><br>
<b>建议值：</b><br>
• <b>20</b>（默认）— 适合大多数场景<br>
• <b>50+</b> — 如果你经常回看历史变量<br>
• <b>9999</b> — 几乎不清理（注意文件体积）`,
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
.varupdate-settings-grid .varupdate-compact-pole {
  width: 6rem;
  flex-shrink: 0;
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
.varupdate-setting-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
}
`;

// ═══════════════════════════════════════════
//  面板 HTML
// ═══════════════════════════════════════════

const PANEL_HTML = `
<div id="varupdate-settings" class="inline-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>变量更新系统</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">

    <!-- 顶部快捷按钮区 -->
    <div class="varupdate-button-grid">
      <div class="varupdate-btn" id="varupdate-btn-reload" title="从世界书重新读取并编译 [Var_Schema] 和 [Var_Default]，覆盖当前聊天中的旧规则">
        <i class="fa-solid fa-arrows-rotate"></i> 重新加载格式规则
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reinit" title="重新扫描开场白（第0层）中的 <Var_Initial> 标签，清空并重建初始变量">
        <i class="fa-solid fa-file-import"></i> 从开场白重新初始化
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse" title="清除最新楼层的变量数据，重新扫描该层消息中的标签并执行更新">
        <i class="fa-solid fa-rotate-right"></i> 重新解析当前楼层
      </div>
      <div class="varupdate-btn" id="varupdate-btn-checkpoint" title="将最新楼层标记为检查点，变量清理时会保留该层数据，可作为链式重解析的起点">
        <i class="fa-solid fa-camera"></i> 将当前楼层设为检查点
      </div>
      <div class="varupdate-btn" id="varupdate-btn-reparse-chain" title="从最近的检查点开始，逐层重新扫描标签并重算变量，修复检查点之后的整条变量链">
        <i class="fa-solid fa-play"></i> 从检查点逐层重新解析
      </div>
    </div>

    <div class="varupdate-btn" id="varupdate-btn-guide" title="查看 VarUpdate 的完整使用说明" style="margin-bottom:10px;">
      <i class="fa-solid fa-book-open"></i> 使用指南
    </div>

    <hr />

    <!-- 设置区域 (2x2 grid) -->
    <div class="varupdate-settings-grid">
      <div class="varupdate-setting-item">
        <label for="varupdate-notify-level">通知等级</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-notify"></i>
        <select id="varupdate-notify-level" class="text_pole varupdate-compact-pole">
          <option value="debug">debug</option>
          <option value="always">always</option>
          <option value="notice" selected>notice</option>
          <option value="error">error</option>
          <option value="silence">silence</option>
        </select>
      </div>
      <div class="varupdate-setting-item">
        <label>自动从开场白初始化</label>
        <div class="varupdate-setting-right">
          <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-autoinit"></i>
          <input id="varupdate-auto-init" type="checkbox" checked />
        </div>
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-tolerance">容错阈值</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-tolerance"></i>
        <input id="varupdate-tolerance" type="number" class="text_pole varupdate-compact-pole" min="0" max="99" step="1" value="2" />
      </div>
      <div class="varupdate-setting-item">
        <label for="varupdate-lifecycle">楼层变量生命周期</label>
        <i class="fa-solid fa-circle-question fa-sm note-link-span varupdate-help-icon" id="varupdate-help-lifecycle"></i>
        <input id="varupdate-lifecycle" type="number" class="text_pole varupdate-compact-pole" min="1" max="9999" step="1" value="20" />
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
      label: '重新解析当前楼层',
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
    const s = globalData[CONFIG_KEY];
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
    globalData[CONFIG_KEY] = {
      notifyLevel: notify.getLevel(),
      autoInit: (hostDoc.getElementById('varupdate-auto-init') as HTMLInputElement)?.checked ?? true,
      toleranceThreshold: parseInt((hostDoc.getElementById('varupdate-tolerance') as HTMLInputElement)?.value || '2', 10),
      varLifecycle: parseInt((hostDoc.getElementById('varupdate-lifecycle') as HTMLInputElement)?.value || '20', 10),
    };
    writeVariables('global', globalData);
  } catch { /* 静默 */ }
}
