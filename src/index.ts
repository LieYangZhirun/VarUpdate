/**
 * VarUpdate —— 主控制器
 *
 * 脚本入口点和业务流程编排者。
 * 负责：
 * 1. 初始化：渲染面板、注册宏、绑定事件
 * 2. 消息处理：标签提取 → 格式解析 → 变量初始化/更新
 * 3. Schema 管理：加载、编译、缓存
 * 4. 生命周期：聊天切换、消息编辑/删除/滑动
 */

import { extractVarTags } from './modules/tag-extractor.js';
import { parseStructuredTextSync } from './modules/format-parser.js';
import { compileSchemaFromText, compileSchemaFromData, validate, clearCache, getCachedSchema } from './modules/schema-compiler/index.js';
import { executeUpdate, executeUpdateSync } from './modules/json-patch/index.js';
import { readVariables, writeVariables, clearMessageVariablesAfter } from './modules/variable-store.js';
import * as eventBus from './modules/event-bus.js';
import { EVENTS } from './modules/event-bus.js';
import * as notify from './modules/notification.js';
import { registerMacros } from './modules/macro-engine.js';
import { renderPanel, registerWandButtons, refreshDebugState } from './modules/ui-panel.js';
import { getValueByPath } from './shared/path-utils.js';
import type { ExtractedTag, MessageCompletePayload } from './types/index.js';

// ═══════════════════════════════════════════
//  模块状态
// ═══════════════════════════════════════════

let unregisterMacros: (() => void) | null = null;
let isAgentsActive = false; // Agents 脚本是否活跃

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

/**
 * 脚本初始化
 */
async function init(): Promise<void> {
  notify.debug('初始化', 'VarUpdate 脚本开始加载');

  // 1. 渲染 UI 面板
  renderPanel({
    onReloadRules: handleReloadRules,
    onReinitFromGreeting: handleReinitFromGreeting,
    onReparseFloor: handleReparseFloor,
    onSetCheckpoint: handleSetCheckpoint,
    onReparseFromCheckpoint: handleReparseFromCheckpoint,
  });

  // 2. 注册魔棒快捷按钮
  registerWandButtons();

  // 3. 注册插值宏
  unregisterMacros = registerMacros();

  // 4. 绑定事件监听
  bindEvents();

  // 5. 加载 Schema（如果当前聊天已有）
  await loadSchema();

  notify.success('初始化完成', 'VarUpdate 已就绪');
}

// ═══════════════════════════════════════════
//  事件绑定
// ═══════════════════════════════════════════

function bindEvents(): void {
  // ─── 通道 A：Agents 事件 ───
  eventBus.on(EVENTS.MESSAGE_COMPLETE, (payload: MessageCompletePayload) => {
    isAgentsActive = true;
    handleMessageContent(payload.content, payload.messageIndex);
  });

  // ─── 通道 B：酒馆原生事件 ───
  eventBus.on(EVENTS.MESSAGE_RECEIVED, (messageIndex: number) => {
    // Agents 活跃时不重复处理
    if (isAgentsActive) return;

    try {
      const context = (globalThis as any).SillyTavern?.getContext?.();
      const message = context?.chat?.[messageIndex];
      if (message?.mes) {
        handleMessageContent(message.mes, messageIndex);
      }
    } catch (e) {
      notify.error('消息读取失败', (e as Error).message);
    }
  });

  // ─── 聊天切换 ───
  eventBus.on(EVENTS.CHAT_CHANGED, async () => {
    isAgentsActive = false;
    clearCache();
    await loadSchema();
  });

  // ─── 消息编辑 ───
  eventBus.on(EVENTS.MESSAGE_EDITED, (messageIndex: number) => {
    try {
      const context = (globalThis as any).SillyTavern?.getContext?.();
      const message = context?.chat?.[messageIndex];
      if (message?.mes) {
        handleMessageContent(message.mes, messageIndex);
      }
    } catch (e) {
      notify.error('消息编辑处理失败', (e as Error).message);
    }
  });

  // ─── 消息删除 ───
  eventBus.on(EVENTS.MESSAGE_DELETED, (messageIndex: number) => {
    clearMessageVariablesAfter(messageIndex);
  });

  // ─── 重试请求 ───
  eventBus.on(EVENTS.RETRY_REQUESTED, (payload: { messageIndex: number }) => {
    clearMessageVariablesAfter(payload.messageIndex - 1);
    notify.debug('变量回退', `回退到消息 ${payload.messageIndex} 之前的状态`);
  });

  // ─── 脚本卸载 ───
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanup);
  }
}

// ═══════════════════════════════════════════
//  核心消息处理流程
// ═══════════════════════════════════════════

/**
 * 处理消息内容：提取标签 → 初始化/更新
 */
async function handleMessageContent(content: string, messageIndex?: number): Promise<void> {
  // 步骤 1：标签提取
  const extraction = extractVarTags(content);

  // 截断检测
  if (extraction.truncated) {
    notify.error('标签截断', `检测到未闭合的 <Var_${extraction.truncatedType === 'update' ? 'Update' : 'Initial'}> 标签`);

    // 广播失败事件
    if (messageIndex !== undefined) {
      await eventBus.emit(EVENTS.UPDATE_FAILED, {
        messageIndex,
        reason: '标签截断（未闭合）',
        discardedCount: 0,
      });
    }
    return;
  }

  if (extraction.tags.length === 0) return;

  // 步骤 2：分类处理
  const initialTags = extraction.tags.filter(t => t.type === 'initial');
  const updateTags = extraction.tags.filter(t => t.type === 'update');

  // 处理 <Var_Initial>
  for (const tag of initialTags) {
    await handleInitial(tag, messageIndex);
  }

  // 处理 <Var_Update>
  if (updateTags.length > 0) {
    await handleUpdate(updateTags, messageIndex);
  }
}

/**
 * 处理变量初始化
 */
async function handleInitial(tag: ExtractedTag, messageIndex?: number): Promise<void> {
  try {
    const data = parseStructuredTextSync(tag.content);

    if (messageIndex !== undefined) {
      writeVariables('message', data, messageIndex);
    }

    notify.success('变量初始化', `${Object.keys(data).length} 个顶层变量已初始化`);

    await eventBus.emit(EVENTS.INITIALIZED, {
      messageIndex: messageIndex ?? -1,
      data,
    });

    refreshDebugState(data);

  } catch (e) {
    notify.error('初始化失败', (e as Error).message);
  }
}

/**
 * 处理变量更新
 */
async function handleUpdate(tags: ExtractedTag[], messageIndex?: number): Promise<void> {
  // 合并所有 Update 标签的内容
  const combinedText = tags.map(t => t.content).join('\n');

  // 获取当前变量状态
  let currentData: Record<string, any> = {};
  if (messageIndex !== undefined) {
    // 从最近的消息层读取
    currentData = readVariables('message', messageIndex);
    if (Object.keys(currentData).length === 0) {
      // 回退到 chat 层
      currentData = readVariables('chat');
    }
  }

  // 深拷贝
  const dataCopy = JSON.parse(JSON.stringify(currentData));

  // 获取 Schema（如有）
  const schema = getCachedSchema();
  const context = schema ? {
    resolveRef: (path: string) => {
      return getValueByPath(dataCopy, path);
    }
  } : undefined;

  try {
    const result = await executeUpdate(
      combinedText,
      dataCopy,
      schema || undefined,
      schema && context ? (s, d, c) => {
        // 同步校验（validateWithSchema 在 schema-to-zod 中是同步的）
        return (globalThis as any).__schemaValidateSync?.(s, d, c) ?? { success: true, errors: [] };
      } : undefined,
      context
    );

    // 写回变量状态
    if (messageIndex !== undefined) {
      writeVariables('message', result.data, messageIndex);
    }

    // 广播结果
    if (result.appliedCount > 0) {
      await eventBus.emit(EVENTS.UPDATED, {
        messageIndex: messageIndex ?? -1,
        appliedCount: result.appliedCount,
        discardedCount: result.discarded.length,
        log: result.log,
      });
    }

    if (result.discarded.length > 0 && result.appliedCount === 0) {
      await eventBus.emit(EVENTS.UPDATE_FAILED, {
        messageIndex: messageIndex ?? -1,
        reason: result.discarded.map(d => d.reason).join('; '),
        discardedCount: result.discarded.length,
      });
    }

    refreshDebugState(result.data);

  } catch (e) {
    notify.error('更新执行失败', (e as Error).message);
    if (messageIndex !== undefined) {
      await eventBus.emit(EVENTS.UPDATE_FAILED, {
        messageIndex,
        reason: (e as Error).message,
        discardedCount: 0,
      });
    }
  }
}

// ═══════════════════════════════════════════
//  Schema / Default 管理（从世界书加载）
// ═══════════════════════════════════════════

/**
 * 从世界书扫描 [Var_Schema] 和 [Var_Default] 条目
 * 并存入 chat 层
 */
async function loadSchemaAndDefaultFromWorldBook(): Promise<void> {
  try {
    // 获取角色主世界书名
    const lorebookName = (globalThis as any).getCurrentCharPrimaryLorebook?.();
    if (!lorebookName) {
      notify.debug('世界书', '未找到角色主世界书');
      return;
    }

    // 读取世界书所有条目
    const entries = await (globalThis as any).getLorebookEntries(lorebookName);
    if (!entries || !Array.isArray(entries)) {
      notify.debug('世界书', `无法读取世界书: ${lorebookName}`);
      return;
    }

    let schemaText: string | null = null;
    let defaultText: string | null = null;

    for (const entry of entries) {
      const comment: string = entry.comment || '';
      if (comment.includes('[Var_Schema]')) {
        schemaText = entry.content || '';
        // 去除 code block 包裹（如 ```yaml ... ```）
        const codeMatch = schemaText.trim().match(/```.*\n([\s\S]*)\n```/m);
        if (codeMatch) schemaText = codeMatch[1];
      }
      if (comment.includes('[Var_Default]')) {
        defaultText = entry.content || '';
        const codeMatch = defaultText.trim().match(/```.*\n([\s\S]*)\n```/m);
        if (codeMatch) defaultText = codeMatch[1];
      }
    }

    // 存入 chat 层
    const chatData = readVariables('chat');

    if (schemaText) {
      chatData._schema_text = schemaText;
      notify.debug('世界书', `找到 [Var_Schema]（${schemaText.length} 字符）`);
    }
    if (defaultText) {
      chatData._default_text = defaultText;
      notify.debug('世界书', `找到 [Var_Default]（${defaultText.length} 字符）`);
    }

    if (schemaText || defaultText) {
      writeVariables('chat', chatData);
    }

    // 编译 Schema
    if (schemaText) {
      const compiled = await compileSchemaFromText(schemaText);
      notify.success('Schema', `编译成功，定义了 ${compiled.defNames.length} 个结构体`);
      await eventBus.emit(EVENTS.SCHEMA_READY, {
        defNames: compiled.defNames,
      });
    }

    // 解析 Default
    if (defaultText) {
      try {
        const defaultData = parseStructuredTextSync(defaultText);
        chatData._default_data = defaultData;
        writeVariables('chat', chatData);
        notify.success('Default', `加载了 ${Object.keys(defaultData).length} 个默认值`);
      } catch (e) {
        notify.error('Default 解析失败', (e as Error).message);
      }
    }

  } catch (e) {
    notify.error('世界书加载失败', (e as Error).message);
  }
}

/**
 * 尝试从 chat 层缓存加载 Schema（切换聊天时调用）
 * 如果缓存为空则触发世界书扫描
 */
async function loadSchema(): Promise<void> {
  try {
    const chatData = readVariables('chat');
    const schemaText = chatData._schema_text;
    if (schemaText) {
      // chat 层有缓存，直接编译
      const compiled = await compileSchemaFromText(schemaText);
      await eventBus.emit(EVENTS.SCHEMA_READY, {
        defNames: compiled.defNames,
      });
      return;
    }
    // 缓存为空，从世界书加载
    await loadSchemaAndDefaultFromWorldBook();
  } catch (e) {
    notify.error('Schema 加载失败', (e as Error).message);
  }
}

// ═══════════════════════════════════════════
//  手动操作回调
// ═══════════════════════════════════════════

/**
 * 重新加载格式规则
 * 从世界书重新读取 [Var_Schema] 和 [Var_Default]，重新编译。
 */
async function handleReloadRules(): Promise<void> {
  notify.debug('手动操作', '重新加载格式规则');
  clearCache();
  // 清除旧缓存
  const chatData = readVariables('chat');
  delete chatData._schema_text;
  delete chatData._default_text;
  delete chatData._default_data;
  writeVariables('chat', chatData);
  // 从世界书重新加载
  await loadSchemaAndDefaultFromWorldBook();
  notify.success('格式规则', '已从世界书重新加载');
}

/**
 * 从开场白重新初始化
 * 重新读取开场白消息中的 <Var_Initial>，重建第 0 层变量。
 */
function handleReinitFromGreeting(): void {
  notify.debug('手动操作', '从开场白重新初始化');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    const greeting = context?.chat?.[0];
    if (greeting?.mes) {
      handleMessageContent(greeting.mes, 0);
    } else {
      notify.warning('初始化', '未找到开场白消息');
    }
  } catch (e) {
    notify.error('初始化失败', (e as Error).message);
  }
}

/**
 * 重新解析当前楼层
 * 清除当前最新楼层变量，重新解析标签并执行。
 */
function handleReparseFloor(): void {
  notify.debug('手动操作', '重新解析当前楼层');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.warning('重解析', '当前无聊天消息');
      return;
    }
    const lastIndex = context.chat.length - 1;
    const lastMsg = context.chat[lastIndex];
    if (lastMsg?.mes) {
      // 清除当前层变量后重新解析
      writeVariables('message', {}, lastIndex);
      handleMessageContent(lastMsg.mes, lastIndex);
    }
  } catch (e) {
    notify.error('重解析失败', (e as Error).message);
  }
}

/**
 * 将当前楼层设为检查点
 */
function handleSetCheckpoint(): void {
  notify.debug('手动操作', '设置变量检查点');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.warning('检查点', '当前无聊天消息');
      return;
    }
    const lastIndex = context.chat.length - 1;
    const data = readVariables('message', lastIndex);
    data._checkpoint = true;
    writeVariables('message', data, lastIndex);
    notify.success('检查点', `已将第 ${lastIndex} 层设为检查点`);
  } catch (e) {
    notify.error('检查点设置失败', (e as Error).message);
  }
}

/**
 * 从上个检查点逐层重新解析
 */
function handleReparseFromCheckpoint(): void {
  notify.debug('手动操作', '从检查点逐层重新解析');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.warning('链式重解析', '当前无聊天消息');
      return;
    }

    // 找最近的检查点
    let checkpointIndex = -1;
    for (let i = context.chat.length - 1; i >= 0; i--) {
      const d = readVariables('message', i);
      if (d._checkpoint) {
        checkpointIndex = i;
        break;
      }
    }

    const startIndex = checkpointIndex >= 0 ? checkpointIndex + 1 : 0;
    notify.debug('链式重解析', `从第 ${startIndex} 层开始`);

    for (let i = startIndex; i < context.chat.length; i++) {
      const msg = context.chat[i];
      if (msg?.mes) {
        handleMessageContent(msg.mes, i);
      }
    }

    notify.success('链式重解析', `已重新解析第 ${startIndex} ~ ${context.chat.length - 1} 层`);
  } catch (e) {
    notify.error('链式重解析失败', (e as Error).message);
  }
}

// ═══════════════════════════════════════════
//  清理
// ═══════════════════════════════════════════

function cleanup(): void {
  unregisterMacros?.();
  eventBus.removeAll();
  notify.debug('卸载', 'VarUpdate 脚本已卸载');
}

// ═══════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════

init().catch(e => {
  console.error('[VarUpdate] 初始化失败:', e);
});
