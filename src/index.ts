/**
 * VarUpdate —— 主控制器
 *
 * 脚本入口点和业务流程编排者。
 *
 * 变量存储结构（接口与契约 4.1-4.3）：
 * - message 层: { data: {...}, log: {...}, isInitPoint: boolean }
 * - chat 层:    { schema?: {...}, default?: {...}, schemaStatus: 'not_loaded'|'compiled'|'error' }
 * - global 层:  { VarUpdate_config: { notifyLevel, autoInitialize, discardThreshold, retentionDepth } }
 */

import { extractVarTags } from './modules/tag-extractor.js';
import { parseStructuredText } from './modules/format-parser.js';
import { compileSchemaFromData, clearCache, getCachedSchema } from './modules/schema-compiler/index.js';
import { executeUpdate } from './modules/json-patch/index.js';
import { readVariables, writeVariables, clearMessageVariablesAfter, pruneOrphanMessageVariables } from './modules/variable-store.js';
import * as eventBus from './modules/event-bus.js';
import { EVENTS } from './modules/event-bus.js';
import * as notify from './modules/notification.js';
import { registerMacros } from './modules/macro-engine.js';
import { renderPanel, registerWandButtons, refreshDebugState, getPanelSettings } from './modules/ui-panel.js';
import { getValueByPath } from './shared/path-utils.js';
import { mergeDeepWithConflictCheck, MergeConflictError } from './shared/merge-deep-conflict.js';
import type { ExtractedTag, MessageCompletePayload } from './types/index.js';

/** 世界书条目正文：若存在围栏代码块则取块内，否则用全文 */
function extractLorebookBody(content: string): string {
  const trimmed = (content || '').trim();
  const m = trimmed.match(/```.*\n([\s\S]*?)\n```/m);
  return m ? m[1] : trimmed;
}

// ═══════════════════════════════════════════
//  模块状态
// ═══════════════════════════════════════════

let unregisterMacros: (() => void) | null = null;
let isAgentsActive = false;
/** 接口与契约：MESSAGE_RECEIVED 与 agents:message_complete 互斥的备用时间窗（ms） */
let lastAgentsMessageCompleteAt = 0;

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

async function init(): Promise<void> {
  notify.debug('初始化', 'VarUpdate 脚本开始加载');

  renderPanel({
    onReloadRules: handleReloadRules,
    onReinitFromGreeting: handleReinitFromGreeting,
    onReparseFloor: handleReparseFloor,
    onSetCheckpoint: handleSetCheckpoint,
    onReparseFromCheckpoint: handleReparseFromCheckpoint,
  });

  registerWandButtons();
  unregisterMacros = registerMacros();
  bindEvents();
  await loadSchema();

  await autoInitGreeting();
  notify.success('初始化完成', 'VarUpdate 已就绪');
}

// ═══════════════════════════════════════════
//  事件绑定
// ═══════════════════════════════════════════

function bindEvents(): void {
  eventBus.on(EVENTS.PIPELINE_STARTED, () => { isAgentsActive = true; });
  eventBus.on(EVENTS.PIPELINE_ENDED, () => { isAgentsActive = false; });

  eventBus.on(EVENTS.MESSAGE_COMPLETE, (payload: MessageCompletePayload) => {
    lastAgentsMessageCompleteAt = Date.now();
    void (async () => {
      await handleMessageContent(payload.content, payload.messageIndex);
    })();
  });

  eventBus.on(EVENTS.MESSAGE_RECEIVED, (messageIndex: number) => {
    if (isAgentsActive) return;
    // 备用：管道标志异常时，避免与 Agents 通道重复处理同一条消息
    if (Date.now() - lastAgentsMessageCompleteAt < 400) return;
    try {
      const context = (globalThis as any).SillyTavern?.getContext?.();
      const message = context?.chat?.[messageIndex];
      if (message?.mes) {
        void (async () => { await handleMessageContent(message.mes, messageIndex); })();
      }
    } catch (e) {
      notify.error('消息读取失败', (e as Error).message);
    }
  });

  eventBus.on(EVENTS.CHAT_CHANGED, async () => {
    isAgentsActive = false;
    clearCache();
    await loadSchema();
    await autoInitGreeting();
  });

  eventBus.on(EVENTS.MESSAGE_EDITED, (messageIndex: number) => {
    try {
      const context = (globalThis as any).SillyTavern?.getContext?.();
      const message = context?.chat?.[messageIndex];
      if (message?.mes) {
        void (async () => { await handleMessageContent(message.mes, messageIndex); })();
      }
    } catch (e) {
      notify.error('消息编辑处理失败', (e as Error).message);
    }
  });

  eventBus.on(EVENTS.MESSAGE_SWIPED, (messageIndex: number) => {
    // 滑动常见两类情境（均不宜在此处对 mes 再跑 handleMessageContent）：
    // 1）滑到新分支 → 酒馆会重发上文/重新生成：变量应在「生成完成」通道里更新，而非滑动瞬间用未稳定正文重算。
    // 2）滑回已完成分支 → 应与该分支已持久化的变量快照一致；重扫 mes 可能覆盖按 swipe 存储的数据。
    // 此处仅同步读取当前 message 层（宿主应对应当前 swipe），供调试视图与宏/变量面板一致。
    try {
      const msgVars = readVariables('message', messageIndex);
      refreshDebugState((msgVars.data ?? {}) as Record<string, any>);
      notify.debug('消息滑动', `已切换到消息 ${messageIndex} 当前分支的变量快照`);
    } catch (e) {
      notify.error('消息滑动处理失败', (e as Error).message);
    }
  });

  // 负载为删除后的 chat.length（SillyTavern script.js），非被删消息下标
  eventBus.on(EVENTS.MESSAGE_DELETED, (newChatLength: number) => {
    pruneOrphanMessageVariables(newChatLength);
    void autoRecoverIfNeeded();
  });

  eventBus.on(EVENTS.RETRY_REQUESTED, (payload: { messageIndex: number }) => {
    clearMessageVariablesAfter(payload.messageIndex - 1);
    notify.debug('变量回退', `回退到消息 ${payload.messageIndex} 之前的状态`);
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanup);
  }
}

// ═══════════════════════════════════════════
//  核心消息处理流程
// ═══════════════════════════════════════════

/**
 * 面向用户 G-1：「仅解析」模式下 messageIndex 为 undefined 时，变量仍写入当前最新楼层
 */
function getLatestMessageIndex(): number | undefined {
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    const len = context?.chat?.length;
    if (typeof len === 'number' && len > 0) return len - 1;
  } catch { /* */ }
  return undefined;
}

/** 处理消息内容：提取标签 → 初始化/更新/继承；尽量保证当前层有与情境一致的 data / log */
async function handleMessageContent(content: string, messageIndex?: number): Promise<void> {
  const writeIndex = messageIndex ?? getLatestMessageIndex();

  const extraction = extractVarTags(content);

  // P5: 截断标签视为无效，略过不处理（面向用户 G-1）
  if (extraction.truncated) {
    notify.debug('标签截断', `检测到未闭合的 <Var_${extraction.truncatedType === 'update' ? 'Update' : 'Initial'}> 标签，略过`);
    if (writeIndex !== undefined) {
      inheritVariables(writeIndex);
    }
    return;
  }

  const initialTags = extraction.tags.filter(t => t.type === 'initial');
  const updateTags = extraction.tags.filter(t => t.type === 'update');

  if (initialTags.length > 0) {
    for (const tag of initialTags) {
      await handleInitial(tag, writeIndex);
    }
  }

  if (updateTags.length > 0) {
    await handleUpdate(updateTags, writeIndex);
  }

  if (initialTags.length === 0 && updateTags.length === 0 && writeIndex !== undefined) {
    inheritVariables(writeIndex);
  }

  if (writeIndex !== undefined) {
    cleanupOldVariables(writeIndex);
  }
}

/**
 * 从前一条消息继承变量数据（无标签消息专用）
 */
function inheritVariables(messageIndex: number): void {
  const prevData = getPreviousData(messageIndex);
  const msgVars = readVariables('message', messageIndex);
  msgVars.data = prevData;
  // 本层未执行 Update，log 应对应当次无变更（避免沿用旧楼层残留记录）
  msgVars.log = {};
  writeVariables('message', msgVars, messageIndex);
}

/**
 * 读取前一条消息的 data 字段
 */
function getPreviousData(messageIndex: number): Record<string, any> {
  if (messageIndex > 0) {
    const prevVars = readVariables('message', messageIndex - 1);
    if (prevVars.data) {
      return JSON.parse(JSON.stringify(prevVars.data));
    }
  }
  // P1: chat 层默认值键名为 default
  const chatData = readVariables('chat');
  return chatData.default ? JSON.parse(JSON.stringify(chatData.default)) : {};
}

/**
 * 处理变量初始化（面向用户 C-2）
 *
 * 流程：清空当前层 → Initial 赋值 → Default 补全缺失字段 → Schema 校验
 */
async function handleInitial(tag: ExtractedTag, messageIndex?: number): Promise<void> {
  try {
    const data = await parseStructuredText(tag.content);

    // Default 补全：用 chat 层 default 填充 Initial 中未提供的字段
    const chatData = readVariables('chat');
    const defaultValues = chatData.default || {};
    const merged = mergeDefaults(data, defaultValues);

    // Schema 校验 + $default 填充 + force 类型转换
    let finalData = merged;
    const schema = getCachedSchema();
    if (schema) {
      const validationResult = safeParse(schema, merged);
      if (validationResult.success) {
        // 使用 Zod 转换后的数据（含 $default 填充和 force 类型转换）
        finalData = validationResult.parsedData;
      } else {
        // F-1 / C-2：Initial 整体校验失败时不写入未校验数据（配置/数据错误，非单条 Patch 丢弃）
        const detail = validationResult.errors.map((e: any) => `${e.path}: ${e.message}`).join('; ');
        notify.error('初始化校验失败', detail || 'Schema 校验未通过');
        return;
      }
    }

    if (messageIndex !== undefined) {
      const msgVars = readVariables('message', messageIndex);
      msgVars.data = finalData;
      msgVars.log = {};
      msgVars.isInitPoint = true;
      writeVariables('message', msgVars, messageIndex);
    }

    // P7: 注册 Schema 到变量管理器
    if (schema) {
      try {
        if (typeof registerVariableSchema === 'function') {
          registerVariableSchema(schema.validator, { type: 'message' });
        }
      } catch { /* 静默 */ }
    }

    notify.success('变量初始化', `${Object.keys(finalData).length} 个顶层变量已初始化`);

    await eventBus.emit(EVENTS.INITIALIZED, {
      messageIndex: messageIndex ?? -1,
      data: finalData,
    });

    refreshDebugState(finalData);
  } catch (e) {
    notify.error('初始化失败', (e as Error).message);
  }
}

/**
 * 用 Default 值补全 data 中缺失的字段（递归合并，不覆盖已有值）
 */
function mergeDefaults(data: Record<string, any>, defaults: Record<string, any>): Record<string, any> {
  const result = JSON.parse(JSON.stringify(data));
  for (const key of Object.keys(defaults)) {
    if (result[key] === undefined) {
      result[key] = JSON.parse(JSON.stringify(defaults[key]));
    } else if (
      typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key]) &&
      typeof defaults[key] === 'object' && defaults[key] !== null && !Array.isArray(defaults[key])
    ) {
      result[key] = mergeDefaults(result[key], defaults[key]);
    }
  }
  return result;
}

/**
 * 同步 Schema 校验（Zod safeParse 包装）
 *
 * 返回 Zod 转换后的数据（含 $default 填充和 force 类型转换）。
 * 调用方应使用 parsedData 而非原始输入，以获得完整的 Schema 处理结果。
 */
function safeParse(schema: any, data: Record<string, any>): {
  success: boolean;
  errors: any[];
  parsedData: Record<string, any>;
} {
  try {
    const result = schema.validator?.safeParse?.(data);
    if (!result) return { success: true, errors: [], parsedData: data };
    if (result.success) return { success: true, errors: [], parsedData: result.data };
    return {
      success: false,
      errors: result.error?.issues?.map((issue: any) => ({
        path: issue.path?.join('/') ?? '',
        message: issue.message ?? '',
      })) ?? [],
      parsedData: data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify.debug('Schema 校验异常', msg);
    return {
      success: false,
      errors: [{ path: '', message: msg }],
      parsedData: data,
    };
  }
}

/**
 * 处理变量更新（面向用户 D-1~D-4, 七·F-2）
 */
async function handleUpdate(tags: ExtractedTag[], messageIndex?: number): Promise<void> {
  const combinedText = tags.map(t => t.content).join('\n');

  let currentData: Record<string, any>;
  if (messageIndex !== undefined) {
    const msgVars = readVariables('message', messageIndex);
    currentData = msgVars.data
      ? JSON.parse(JSON.stringify(msgVars.data))
      : getPreviousData(messageIndex);
  } else {
    currentData = {};
  }

  const dataCopy = JSON.parse(JSON.stringify(currentData));

  const schema = getCachedSchema();
  const validationContext = schema ? {
    resolveRef: (path: string) => getValueByPath(dataCopy, path),
  } : undefined;

  try {
    const result = await executeUpdate(
      combinedText,
      dataCopy,
      schema || undefined,
      validationContext
    );

    if (messageIndex !== undefined) {
      const msgVars = readVariables('message', messageIndex);
      msgVars.data = result.data;
      msgVars.log = result.log;
      writeVariables('message', msgVars, messageIndex);
    }

    // P3: 使用设计字段名 discardThreshold
    const { discardThreshold } = getPanelSettings();
    const discardedCount = result.discarded.length;

    if (discardedCount <= discardThreshold) {
      await eventBus.emit(EVENTS.UPDATED, {
        messageIndex: messageIndex ?? -1,
        appliedCount: result.appliedCount,
        discardedCount,
        log: result.log,
      });

      if (discardedCount > 0) {
        notify.warning('变量更新', `${result.appliedCount} 条成功，${discardedCount} 条丢弃（≤ 阈值 ${discardThreshold}）`);
      }
    } else {
      await eventBus.emit(EVENTS.UPDATE_FAILED, {
        messageIndex: messageIndex ?? -1,
        reason: `丢弃 ${discardedCount} 条指令（超过阈值 ${discardThreshold}）`,
        discardedCount,
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
//  变量生命周期
// ═══════════════════════════════════════════

/**
 * 清除超出生命周期的旧楼层变量数据（面向用户 十·I-2）
 *
 * P2: 使用 isInitPoint 作为检查点标记名
 * P3: 使用 retentionDepth 作为设置字段名
 */
function cleanupOldVariables(currentIndex: number): void {
  try {
    const { retentionDepth } = getPanelSettings();
    const cutoff = currentIndex - retentionDepth;
    if (cutoff <= 0) return;

    for (let i = 0; i < cutoff; i++) {
      const msgVars = readVariables('message', i);
      if (msgVars.isInitPoint) continue;
      if (msgVars.data || msgVars.log) {
        delete msgVars.data;
        delete msgVars.log;
        writeVariables('message', msgVars, i);
      }
    }
  } catch {
    // 清理非关键
  }
}

/**
 * 自动从开场白初始化（面向用户 B-2）
 *
 * 受 autoInitialize 设置控制。在脚本初始化和切换聊天时调用。
 * 若开场白无 <Var_Initial>，inheritVariables 会使用 chat.default 作为初始状态。
 */
async function autoInitGreeting(): Promise<void> {
  const { autoInitialize } = getPanelSettings();
  if (!autoInitialize) return;
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    const greeting = context?.chat?.[0];
    if (!greeting?.mes) return;
    const msgVars = readVariables('message', 0);
    if (!msgVars.data) {
      await handleMessageContent(greeting.mes, 0);
    }
  } catch { /* 首次无聊天时静默 */ }
}

/**
 * 变量生命周期自动恢复（面向用户 I-2）
 */
async function autoRecoverIfNeeded(): Promise<void> {
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) return;

    const lastIndex = context.chat.length - 1;
    const lastVars = readVariables('message', lastIndex);
    if (lastVars.data) return;

    let recoverFrom = -1;
    for (let i = lastIndex - 1; i >= 0; i--) {
      const v = readVariables('message', i);
      if (v.data) {
        recoverFrom = i;
        break;
      }
    }

    const startIndex = recoverFrom >= 0 ? recoverFrom + 1 : 0;
    notify.debug('自动恢复', `从第 ${startIndex} 层开始恢复变量链`);

    // 严格按序恢复——消息 N 的变量依赖 N-1 的结果
    for (let i = startIndex; i <= lastIndex; i++) {
      const msg = context.chat[i];
      if (msg?.mes) {
        await handleMessageContent(msg.mes, i);
      }
    }
  } catch {
    // 恢复非关键
  }
}

// ═══════════════════════════════════════════
//  Schema / Default 管理
// ═══════════════════════════════════════════

/**
 * 从世界书扫描 [Var_Schema] 和 [Var_Default] 条目
 *
 * P1: chat 层键名 schema / default / schemaStatus
 */
async function loadSchemaAndDefaultFromWorldBook(): Promise<void> {
  try {
    const lorebookName = (globalThis as any).getCurrentCharPrimaryLorebook?.();
    if (!lorebookName) {
      notify.debug('世界书', '未找到角色主世界书');
      return;
    }

    const entries = await (globalThis as any).getLorebookEntries(lorebookName);
    if (!entries || !Array.isArray(entries)) {
      notify.debug('世界书', `无法读取世界书: ${lorebookName}`);
      return;
    }

    const schemaBodies: string[] = [];
    const defaultBodies: string[] = [];

    for (const entry of entries) {
      const comment: string = entry.comment || '';
      if (comment.includes('[Var_Schema]')) {
        schemaBodies.push(extractLorebookBody(entry.content || ''));
      }
      if (comment.includes('[Var_Default]')) {
        defaultBodies.push(extractLorebookBody(entry.content || ''));
      }
    }

    const chatData = readVariables('chat');

    let mergedSchema: Record<string, any> | null = null;
    try {
      for (const body of schemaBodies) {
        const trimmed = body.trim();
        if (!trimmed) continue;
        const obj = await parseStructuredText(trimmed);
        mergedSchema = mergedSchema ? mergeDeepWithConflictCheck(mergedSchema, obj) : obj;
      }
    } catch (e) {
      if (e instanceof MergeConflictError) {
        chatData.schemaStatus = 'error';
        notify.error('Schema 合并冲突', `${(e as MergeConflictError).message}（路径: ${(e as MergeConflictError).path}）`);
        mergedSchema = null;
      } else {
        throw e;
      }
    }

    if (mergedSchema) {
      try {
        const compiled = await compileSchemaFromData(mergedSchema);
        chatData.schema = compiled.raw;
        chatData.schemaStatus = 'compiled';
        notify.success('Schema', `编译成功（${schemaBodies.filter(b => b.trim()).length} 条合并），${compiled.defNames.length} 个 $defs 结构体`);

        try {
          if (typeof registerVariableSchema === 'function') {
            registerVariableSchema(compiled.validator, { type: 'message' });
          }
        } catch { /* 静默 */ }

        await eventBus.emit(EVENTS.SCHEMA_READY, { defNames: compiled.defNames });
      } catch (e) {
        chatData.schemaStatus = 'error';
        notify.error('Schema 编译失败', (e as Error).message);
      }
    }

    let mergedDefault: Record<string, any> | null = null;
    try {
      for (const body of defaultBodies) {
        const trimmed = body.trim();
        if (!trimmed) continue;
        const obj = await parseStructuredText(trimmed);
        mergedDefault = mergedDefault ? mergeDeepWithConflictCheck(mergedDefault, obj) : obj;
      }
    } catch (e) {
      if (e instanceof MergeConflictError) {
        notify.error('Default 合并冲突', `${(e as MergeConflictError).message}（路径: ${(e as MergeConflictError).path}）`);
        mergedDefault = null;
      } else {
        throw e;
      }
    }

    if (mergedDefault) {
      chatData.default = mergedDefault;
      notify.success('Default', `加载了 ${Object.keys(chatData.default).length} 个顶层键（${defaultBodies.filter(b => b.trim()).length} 条合并）`);
    }

    writeVariables('chat', chatData);

  } catch (e) {
    notify.error('世界书加载失败', (e as Error).message);
  }
}

async function loadSchema(): Promise<void> {
  try {
    const chatData = readVariables('chat');
    if (chatData.schema && chatData.schemaStatus === 'compiled') {
      const compiled = await compileSchemaFromData(chatData.schema);
      await eventBus.emit(EVENTS.SCHEMA_READY, { defNames: compiled.defNames });
      return;
    }
    // 含 schemaStatus===compiled 但缺 schema 等异常态，统一走世界书重载
    await loadSchemaAndDefaultFromWorldBook();
  } catch (e) {
    notify.error('Schema 加载失败', (e as Error).message);
  }
}

// ═══════════════════════════════════════════
//  手动操作回调
// ═══════════════════════════════════════════

async function handleReloadRules(): Promise<void> {
  notify.debug('手动操作', '重新加载格式规则');
  clearCache();
  const chatData = readVariables('chat');
  delete chatData.schema;
  delete chatData.default;
  chatData.schemaStatus = 'not_loaded';
  writeVariables('chat', chatData);
  await loadSchemaAndDefaultFromWorldBook();
  notify.feedback(true, '格式规则', '已从世界书重新加载');
}

async function handleReinitFromGreeting(): Promise<void> {
  notify.debug('手动操作', '从开场白重新初始化');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    const greeting = context?.chat?.[0];
    if (greeting?.mes) {
      await handleMessageContent(greeting.mes, 0);
      notify.feedback(true, '开场白初始化', '已按当前开场白内容重新处理变量');
    } else {
      notify.feedback(false, '开场白初始化', '未找到开场白消息');
    }
  } catch (e) {
    notify.error('初始化失败', (e as Error).message);
    notify.feedback(false, '开场白初始化', (e as Error).message);
  }
}

async function handleReparseFloor(): Promise<void> {
  notify.debug('手动操作', '重新解析当前楼层');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.feedback(false, '重解析', '当前无聊天消息');
      return;
    }
    const lastIndex = context.chat.length - 1;
    const lastMsg = context.chat[lastIndex];
    if (lastMsg?.mes) {
      const msgVars = readVariables('message', lastIndex);
      delete msgVars.data;
      delete msgVars.log;
      writeVariables('message', msgVars, lastIndex);
      await handleMessageContent(lastMsg.mes, lastIndex);
      notify.feedback(true, '重解析', `已重新解析第 ${lastIndex} 层`);
    }
  } catch (e) {
    notify.error('重解析失败', (e as Error).message);
    notify.feedback(false, '重解析', (e as Error).message);
  }
}

function handleSetCheckpoint(): void {
  notify.debug('手动操作', '设置变量检查点');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.warning('检查点', '当前无聊天消息');
      return;
    }
    const lastIndex = context.chat.length - 1;
    const msgVars = readVariables('message', lastIndex);
    // P2: 使用 isInitPoint 作为检查点标记
    msgVars.isInitPoint = true;
    writeVariables('message', msgVars, lastIndex);
    notify.feedback(true, '检查点', `已将第 ${lastIndex} 层设为检查点`);
  } catch (e) {
    notify.error('检查点设置失败', (e as Error).message);
  }
}

async function handleReparseFromCheckpoint(): Promise<void> {
  notify.debug('手动操作', '从检查点逐层重新解析');
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.warning('链式重解析', '当前无聊天消息');
      return;
    }

    let checkpointIndex = -1;
    for (let i = context.chat.length - 1; i >= 0; i--) {
      const msgVars = readVariables('message', i);
      if (msgVars.isInitPoint) {
        checkpointIndex = i;
        break;
      }
    }

    const startIndex = checkpointIndex >= 0 ? checkpointIndex + 1 : 0;
    notify.debug('链式重解析', `从第 ${startIndex} 层开始`);

    for (let i = startIndex; i < context.chat.length; i++) {
      const msg = context.chat[i];
      if (msg?.mes) {
        await handleMessageContent(msg.mes, i);
      }
    }

    notify.feedback(true, '链式重解析', `已重新解析第 ${startIndex} ~ ${context.chat.length - 1} 层`);
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
