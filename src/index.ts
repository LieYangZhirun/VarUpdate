/**
 * VarUpdate —— 主控制器
 *
 * 脚本入口与业务流程编排。《接口与契约集中定义》第四章约定各层形状摘要如下：
 * - message：`data`、`log`、可选 `isInitPoint`
 * - chat：`schema`、`default`、可选 `schemaStatus`（`not_loaded` | `compiled` | `error`）
 * - global：`VarUpdate_config`（`notifyLevel`、`autoInitialize`、`discardThreshold`、`retentionDepth`）
 */

import { extractVarTags } from './modules/tag-extractor.js';
import { parseStructuredText, FormatParseError, formatParseErrorDetails } from './modules/format-parser.js';
import {
  bindSafeParseWithContext,
  compileSchemaFromData,
  clearCache,
  getCachedSchema,
} from './modules/schema-compiler/index.js';
import { executeUpdate } from './modules/json-patch/index.js';
import {
  readVariables,
  writeVariables,
  clearMessageVariablesAfter,
  pruneOrphanMessageVariables,
  deepClone,
} from './modules/variable-store.js';
import * as eventBus from './modules/event-bus.js';
import { EVENTS } from './modules/event-bus.js';
import * as notify from './modules/notification.js';
import { registerMacros } from './modules/macro-engine.js';
import { renderPanel, registerWandButtons, destroyPanel, refreshDebugState, getPanelSettings } from './modules/ui-panel.js';
import { registerFilterHooks, unregisterFilterHooks } from './modules/native-filter.js';
import { getValueByPath } from './shared/path-utils.js';
import { mergeDeepWithConflictCheck, MergeConflictError } from './shared/merge-deep-conflict.js';
import type { ExtractedTag, MessageCompletePayload } from './types/index.js';
// z（Zod）由酒馆助手注入到 iframe 全局，无需 import

/**
 * 宿主 `registerVariableSchema` 校验的是 message 层整对象；本函数将业务 Schema 包在 `data` 下，
 * 使 `log`、`isInitPoint` 等约定字段不被误判为非法顶层键。
 */
function wrapValidatorForMessageLayer(validator: z.ZodTypeAny): z.ZodTypeAny {
  return z
    .object({
      data: validator,
      log: z.record(z.string(), z.any()).optional(),
      isInitPoint: z.boolean().optional(),
    })
    .passthrough();
}

/** 尝试向宿主注册 message 层 Zod 校验器（失败时静默）。 */
function tryRegisterMessageLayerVariableSchema(validator: z.ZodTypeAny): void {
  try {
    if (typeof registerVariableSchema === 'function') {
      registerVariableSchema(wrapValidatorForMessageLayer(validator), { type: 'message' });
    }
  } catch {
    /* 静默 */
  }
}

/**
 * 读取当前角色卡绑定的主世界书名称；无角色卡或未绑定时返回 null。
 * （`getCurrentCharPrimaryLorebook` 内部可能抛出「未找到当前打开的角色卡」，此处吞掉并视为无书。）
 */
function tryGetCurrentCharPrimaryLorebookName(): string | null {
  try {
    const fn = (globalThis as any).getCurrentCharPrimaryLorebook;
    if (typeof fn !== 'function') return null;
    const name = fn();
    if (name == null || name === '') return null;
    const s = String(name).trim();
    return s || null;
  } catch {
    return null;
  }
}

/**
 * 当前是否处于「已打开有效角色卡」语境（排除无绑定角色卡的默认助手会话等）。
 * 依据 `SillyTavern.getContext().characterId` 与角色条目是否有效判断。
 */
function isBoundCharacterCardOpen(): boolean {
  try {
    const ctx = (globalThis as any).SillyTavern?.getContext?.();
    if (!ctx?.characters) return false;
    if (ctx.groupId) return true;
    const id = ctx.characterId;
    if (id === undefined || id === null) return false;
    const ch = ctx.characters[id];
    if (!ch || ch.avatar === 'none') return false;
    return true;
  } catch {
    return false;
  }
}

/** 世界书条目正文：存在 Markdown 围栏代码块时取块内文本，否则使用全文。 */
function extractLorebookBody(content: string): string {
  const trimmed = (content || '').trim();
  const m = trimmed.match(/```.*\n([\s\S]*?)\n```/m);
  return m ? m[1] : trimmed;
}

interface LoreTaggedBody {
  comment: string;
  body: string;
}

// ═══════════════════════════════════════════
//  模块状态
// ═══════════════════════════════════════════

let unregisterMacros: (() => void) | null = null;
let isAgentsActive = false;
/** 与 `agents:message_complete` 去重：`MESSAGE_RECEIVED` 在此时间窗内视为已由 Agents 通道处理（毫秒）。 */
let lastAgentsMessageCompleteAt = 0;

// ═══════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════

async function init(): Promise<void> {
  notify.debug('初始化', '变量系统 开始加载', { category: 'boot' });

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
  registerFilterHooks();
  await loadSchema();

  await autoInitGreeting();
  notify.success('初始化完成', '变量系统 已就绪', { category: 'boot' });
}

// ═══════════════════════════════════════════
//  事件绑定
// ═══════════════════════════════════════════

function bindEvents(): void {
  eventBus.on(EVENTS.PIPELINE_STARTED, () => { isAgentsActive = true; });
  eventBus.on(EVENTS.PIPELINE_ENDED, () => { isAgentsActive = false; });

  eventBus.on(EVENTS.MESSAGE_COMPLETE, (payload: MessageCompletePayload) => {
    if (!payload || typeof payload.content !== 'string') {
      notify.debug('Agents', 'message_complete 负载无效，已忽略', { category: 'msg' });
      return;
    }
    lastAgentsMessageCompleteAt = Date.now();
    void (async () => {
      await handleMessageContent(payload.content, payload.messageIndex);
    })();
  });

  eventBus.on(EVENTS.MESSAGE_RECEIVED, (messageIndex: number, reason?: string) => {
    if (isAgentsActive) return;
    // 双通道去重：管道标志未及时更新时，仍避免与 `message_complete` 重复处理
    if (Date.now() - lastAgentsMessageCompleteAt < 400) return;
    try {
      const context = (globalThis as any).SillyTavern?.getContext?.();
      const message = context?.chat?.[messageIndex];
      if (message?.mes) {
        // SillyTavern 在保存角色卡等场景可能再次派发 first_message，与手动初始化去重
        const quiet = reason === 'first_message';
        void (async () => { await handleMessageContent(message.mes, messageIndex, { quiet }); })();
      }
    } catch (e) {
      notify.error('消息读取失败', (e as Error).message, { category: 'msg' });
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
      notify.error('消息编辑处理失败', (e as Error).message, { category: 'msg' });
    }
  });

  eventBus.on(EVENTS.MESSAGE_SWIPED, (messageIndex: number) => {
    // swipe 时不重扫正文：新分支应由生成完成事件更新变量；回退分支应使用已持久化的该 swipe 快照。
    // 此处仅按宿主当前 swipe 读取 message 层，刷新调试视图与面板展示。
    try {
      const msgVars = readVariables('message', messageIndex);
      refreshDebugState((msgVars.data ?? {}) as Record<string, any>);
      notify.debug('消息滑动', `已切换到消息 ${messageIndex} 当前分支的变量快照`, { category: 'msg' });
    } catch (e) {
      notify.error('消息滑动处理失败', (e as Error).message, { category: 'msg' });
    }
  });

  // 负载为删除后的 chat.length（SillyTavern script.js），非被删消息下标
  eventBus.on(EVENTS.MESSAGE_DELETED, (newChatLength: number) => {
    pruneOrphanMessageVariables(newChatLength);
    void autoRecoverIfNeeded();
  });

  eventBus.on(EVENTS.RETRY_REQUESTED, (payload: { messageIndex: number }) => {
    const n = payload?.messageIndex;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      notify.debug('变量回退', 'retry_requested 负载缺少有效 messageIndex，已忽略', { category: 'life' });
      return;
    }
    clearMessageVariablesAfter(n - 1);
    notify.debug('变量回退', `自第 ${n} 层起清空 message 变量（含该层）`, { category: 'life' });
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', cleanup);
  }
}

// ═══════════════════════════════════════════
//  核心消息处理流程
// ═══════════════════════════════════════════

/**
 * G-1 兜底：未传入 messageIndex 时，假定写入当前 chat 最后一楼。
 *
 * Agents 在 `message_complete` 里应尽可能带上 **逻辑楼层**（含仅解析/预览：不持久化 mes 也可有目标下标）。
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
async function handleMessageContent(
  content: string,
  messageIndex?: number,
  opts?: { quiet?: boolean },
): Promise<void> {
  const writeIndex = messageIndex ?? getLatestMessageIndex();

  const extraction = extractVarTags(content);

  // 截断标签视为无效，略过不处理（面向用户 G-1）
  if (extraction.truncated) {
    notify.debug('标签截断', `检测到未闭合的 <Var_${extraction.truncatedType === 'update' ? 'Update' : 'Initial'}> 标签，略过`, { category: 'msg' });
    if (writeIndex !== undefined) {
      inheritVariables(writeIndex);
    }
    return;
  }

  const initialTags = extraction.tags.filter(t => t.type === 'initial');
  const updateTags = extraction.tags.filter(t => t.type === 'update');

  // 多条 Var_Initial：与各标签正文先解析为对象，再深度合并；同路径定义不一致 → 报错（与世界书 Schema/Default 相同策略）
  let initialPipelineOk = initialTags.length === 0;
  if (initialTags.length > 0) {
    try {
      let mergedInitial: Record<string, any> | null = null;
      for (const tag of initialTags) {
        const obj = parseStructuredText(tag.content);
        mergedInitial =
          mergedInitial === null ? obj : mergeDeepWithConflictCheck(mergedInitial, obj);
      }
      if (mergedInitial !== null) {
        initialPipelineOk = await applyInitialMergedData(mergedInitial, writeIndex, opts);
      }
    } catch (e) {
      if (e instanceof MergeConflictError) {
        notify.error(
          'Var_Initial 合并冲突',
          `${e.message}（路径: ${e.path}）`,
          { category: 'msg' },
        );
      } else if (e instanceof FormatParseError) {
        notify.error('Var_Initial 解析失败', formatParseErrorDetails(e), { category: 'msg' });
      } else {
        notify.error('Var_Initial 处理失败', (e as Error).message, { category: 'msg' });
      }
      initialPipelineOk = false;
    }
  }

  // 同条消息先 Initial 再 Update（面向用户 C-3）；Initial 解析/校验/合并任一步失败则不得在同一基线上跑 Update
  if (updateTags.length > 0 && initialPipelineOk) {
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
      return deepClone(prevVars.data);
    }
  }
  // chat 层默认值键名为 default（接口与契约 4.2）
  const chatData = readVariables('chat');
  return chatData.default ? deepClone(chatData.default) : {};
}

/**
 * 应用已合并的 Initial 对象（面向用户 C-2）
 *
 * 流程：Default 补全 → Schema 校验 → 写入 message 层
 *
 * @returns 是否完成可写入的初始化（校验失败或异常时为 false；同条消息内后续 Var_Update 仅在此为 true 时执行）
 */
async function applyInitialMergedData(
  data: Record<string, any>,
  messageIndex?: number,
  opts?: { quiet?: boolean },
): Promise<boolean> {
  try {
    // Default 补全：用 chat 层 default 填充 Initial 中未提供的字段
    const chatData = readVariables('chat');
    const defaultValues = chatData.default || {};
    const merged = mergeDefaults(data, defaultValues);

    // Schema 校验 + $default 填充 + force 类型转换
    let finalData = merged;
    const schema = getCachedSchema();
    if (schema) {
      // 须走 safeParseWithContext，否则 Schema 中 refer() 不会在 Initial 阶段生效
      const parseFn = bindSafeParseWithContext(schema, {
        resolveRef: (path: string) => getValueByPath(merged, path),
      });
      const zResult = parseFn(merged);
      if (zResult.success) {
        finalData = (zResult.data ?? merged) as Record<string, any>;
      } else {
        const detail =
          zResult.error?.issues
            ?.map((issue: { path: (string | number)[]; message: string }) =>
              `${issue.path?.join('/') ?? ''}: ${issue.message}`,
            )
            .join('; ') ?? 'Schema 校验未通过';
        notify.error('初始化校验失败', detail, { category: 'sch' });
        return false;
      }
    }

    if (messageIndex !== undefined) {
      const msgVars = readVariables('message', messageIndex);
      msgVars.data = finalData;
      msgVars.log = {};
      msgVars.isInitPoint = true;
      writeVariables('message', msgVars, messageIndex);
    }

    // 向酒馆变量管理器注册 message 层校验器（与 Schema 编译结果一致）
    if (schema) {
      tryRegisterMessageLayerVariableSchema(schema.validator as z.ZodTypeAny);
    }

    if (opts?.quiet) {
      notify.debug('变量初始化', `${Object.keys(finalData).length} 个顶层变量已初始化（静默）`, { category: 'msg' });
    } else {
      notify.success('变量初始化', `${Object.keys(finalData).length} 个顶层变量已初始化`, { category: 'msg' });
    }

    await eventBus.emit(EVENTS.VAR_INITIALIZED, {
      messageIndex: messageIndex ?? -1,
      data: finalData,
    });

    refreshDebugState(finalData);
    return true;
  } catch (e) {
    notify.error('初始化失败', (e as Error).message, { category: 'sch' });
    return false;
  }
}

/**
 * 用 Default 值补全 data 中缺失的字段（递归合并，不覆盖已有值）
 */
function mergeDefaults(data: Record<string, any>, defaults: Record<string, any>): Record<string, any> {
  const result = deepClone(data);
  for (const key of Object.keys(defaults)) {
    if (result[key] === undefined) {
      result[key] = deepClone(defaults[key]);
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
 * 处理变量更新（面向用户 D-1~D-4, 七·F-2）
 */
async function handleUpdate(tags: ExtractedTag[], messageIndex?: number): Promise<void> {
  if (messageIndex === undefined) {
    notify.warning(
      'Var_Update 已跳过',
      '无法确定目标消息楼层（例如当前无聊天记录，或 Agents 未传入 messageIndex）。未执行补丁、未写入 message 层。',
      { category: 'pat' },
    );
    return;
  }

  const combinedText = tags.map(t => t.content).join('\n');

  const msgVarsForRead = readVariables('message', messageIndex);
  const currentData = msgVarsForRead.data
    ? deepClone(msgVarsForRead.data)
    : getPreviousData(messageIndex);

  const dataCopy = deepClone(currentData);

  const schema = getCachedSchema();
  const validationContext = schema ? {
    resolveRef: (path: string) => getValueByPath(dataCopy, path),
  } : undefined;

  try {
    const result = executeUpdate(
      combinedText,
      dataCopy,
      schema || undefined,
      validationContext
    );

    // 丢弃数超过容错阈值则整次更新失败，不得写入 message 层（与 varupdate:update_failed 语义一致）
    const { discardThreshold } = getPanelSettings();
    const discardedCount = result.discarded.length;
    const rejectedByThreshold = discardedCount > discardThreshold;

    if (!rejectedByThreshold) {
      const msgVars = readVariables('message', messageIndex);
      msgVars.data = result.data;
      msgVars.log = result.log;
      writeVariables('message', msgVars, messageIndex);
    }

    if (!rejectedByThreshold) {
      await eventBus.emit(EVENTS.VAR_UPDATED, {
        messageIndex,
        appliedCount: result.appliedCount,
        discardedCount,
        log: result.log,
      });

      if (discardedCount > 0) {
        notify.warning('变量更新', `${result.appliedCount} 条成功，${discardedCount} 条丢弃（≤ 阈值 ${discardThreshold}）`, { category: 'pat' });
      }
      refreshDebugState(result.data);
    } else {
      notify.error(
        '变量更新未应用',
        `丢弃 ${discardedCount} 条指令，超过阈值 ${discardThreshold}，本层变量保持原状`,
        { category: 'pat' },
      );
      await eventBus.emit(EVENTS.VAR_UPDATE_FAILED, {
        messageIndex,
        reason: `丢弃 ${discardedCount} 条指令（超过阈值 ${discardThreshold}）`,
        discardedCount,
      });
      const prev = readVariables('message', messageIndex);
      refreshDebugState((prev.data ?? {}) as Record<string, any>);
    }

  } catch (e) {
    notify.error('更新执行失败', (e as Error).message, { category: 'pat' });
    await eventBus.emit(EVENTS.VAR_UPDATE_FAILED, {
      messageIndex,
      reason: (e as Error).message,
      discardedCount: 0,
    });
  }
}

// ═══════════════════════════════════════════
//  变量生命周期
// ═══════════════════════════════════════════

/**
 * 清除超出生命周期的旧楼层变量数据（面向用户 十·I-2）。
 *
 * 跳过带 `isInitPoint` 的检查点楼层；`retentionDepth` 来自面板设置（global 层配置）。
 *
 * @param currentIndex 当前正在处理的消息下标（以此为基准计算保留窗口）
 */
function cleanupOldVariables(currentIndex: number): void {
  try {
    const { retentionDepth } = getPanelSettings();
    const cutoff = currentIndex - retentionDepth;
    if (cutoff <= 0) return;

    for (let i = 0; i < cutoff; i++) {
      const msgVars = readVariables('message', i);
      if (msgVars.isInitPoint) continue;
      if (msgVars.data !== undefined || msgVars.log !== undefined) {
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
  if (!isBoundCharacterCardOpen()) return;
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
    notify.debug('自动恢复', `从第 ${startIndex} 层开始恢复变量链`, { category: 'life' });

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
 * chat 层键名：schema / default / schemaStatus（接口与契约 4.2）。
 *
 * @param opts.expectLorebook 为 true 时（如用户点击「重新加载格式规则」）：无角色卡/无主世界书视为失败并 warning；否则仅 debug 跳过（初始化/切聊天等）。
 * @returns 是否未出现阻塞性错误（解析/合并/编译失败则为 false）
 */
async function loadSchemaAndDefaultFromWorldBook(opts?: { expectLorebook?: boolean }): Promise<boolean> {
  const chatData = readVariables('chat');
  let ok = true;

  const announceSchemaOk = (msg: string) => notify.debug('Schema', msg, { category: 'sch' });
  const announceDefaultOk = (msg: string) => notify.debug('Default', msg, { category: 'wb' });

  try {
    const lorebookName = tryGetCurrentCharPrimaryLorebookName();
    if (!lorebookName) {
      if (opts?.expectLorebook) {
        notify.warning(
          '格式规则',
          '未打开角色卡或未绑定主世界书，无法从世界书加载 [Var_Schema] / [Var_Default]。',
          { category: 'wb' },
        );
      } else {
        notify.debug(
          '世界书',
          '当前无角色卡或未绑定主世界书，跳过从世界书加载格式规则',
          { category: 'wb' },
        );
      }
      writeVariables('chat', chatData);
      return !opts?.expectLorebook;
    }

    const entries = await (globalThis as any).getLorebookEntries(lorebookName);
    if (!entries || !Array.isArray(entries)) {
      notify.debug('世界书', `无法读取世界书: ${lorebookName}`, { category: 'wb' });
      writeVariables('chat', chatData);
      return true;
    }

    const schemaTagged: LoreTaggedBody[] = [];
    const defaultTagged: LoreTaggedBody[] = [];

    for (const entry of entries) {
      const comment: string = entry.comment || '';
      const raw = String((entry as { content?: unknown }).content ?? '');
      if (comment.includes('[Var_Schema]')) {
        schemaTagged.push({ comment, body: extractLorebookBody(raw) });
      }
      if (comment.includes('[Var_Default]')) {
        defaultTagged.push({ comment, body: extractLorebookBody(raw) });
      }
    }

    let mergedSchema: Record<string, any> | null = null;
    try {
      for (const { comment, body } of schemaTagged) {
        const trimmed = body.trim();
        if (!trimmed) continue;
        try {
          const obj = parseStructuredText(trimmed);
          mergedSchema = mergedSchema ? mergeDeepWithConflictCheck(mergedSchema, obj) : obj;
        } catch (e) {
          if (e instanceof FormatParseError) {
            ok = false;
            chatData.schemaStatus = 'error';
            delete chatData.schema;
            notify.error(
              'Schema 条目无法解析',
              `世界书「${lorebookName}」\n备注含 [Var_Schema] 的条目：${comment.slice(0, 80)}${comment.length > 80 ? '…' : ''}\n\n${formatParseErrorDetails(e)}`,
              { category: 'wb' },
            );
            mergedSchema = null;
            break;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof MergeConflictError) {
        ok = false;
        chatData.schemaStatus = 'error';
        delete chatData.schema;
        notify.error('Schema 合并冲突', `${(e as MergeConflictError).message}（路径: ${(e as MergeConflictError).path}）`, { category: 'wb' });
        mergedSchema = null;
      } else {
        ok = false;
        chatData.schemaStatus = 'error';
        delete chatData.schema;
        notify.error('世界书 / Schema', (e as Error).message, { category: 'wb' });
        mergedSchema = null;
      }
    }

    if (mergedSchema) {
      try {
        const compiled = compileSchemaFromData(mergedSchema);
        chatData.schema = compiled.raw;
        chatData.schemaStatus = 'compiled';
        const n = schemaTagged.filter(t => t.body.trim()).length;
        announceSchemaOk(`编译成功（${n} 条合并），${compiled.defNames.length} 个 $defs 结构体`);

        tryRegisterMessageLayerVariableSchema(compiled.validator as z.ZodTypeAny);

        await eventBus.emit(EVENTS.VAR_SCHEMA_READY, { defNames: compiled.defNames });
      } catch (e) {
        ok = false;
        chatData.schemaStatus = 'error';
        delete chatData.schema;
        notify.error('Schema 编译失败', (e as Error).message, { category: 'wb' });
      }
    } else if (schemaTagged.some(t => t.body.trim()) && chatData.schemaStatus !== 'error') {
      // 有条目但正文全空等：不覆盖 compiled，仅保持现状
    }

    let mergedDefault: Record<string, any> | null = null;
    try {
      for (const { comment, body } of defaultTagged) {
        const trimmed = body.trim();
        if (!trimmed) continue;
        try {
          const obj = parseStructuredText(trimmed);
          mergedDefault = mergedDefault ? mergeDeepWithConflictCheck(mergedDefault, obj) : obj;
        } catch (e) {
          if (e instanceof FormatParseError) {
            ok = false;
            notify.error(
              'Default 条目无法解析',
              `世界书「${lorebookName}」\n备注含 [Var_Default] 的条目：${comment.slice(0, 80)}${comment.length > 80 ? '…' : ''}\n\n${formatParseErrorDetails(e)}`,
              { category: 'wb' },
            );
            mergedDefault = null;
            break;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof MergeConflictError) {
        ok = false;
        notify.error('Default 合并冲突', `${(e as MergeConflictError).message}（路径: ${(e as MergeConflictError).path}）`, { category: 'wb' });
        mergedDefault = null;
      } else {
        ok = false;
        notify.error('世界书 / Default', (e as Error).message, { category: 'wb' });
        mergedDefault = null;
      }
    }

    if (mergedDefault) {
      chatData.default = mergedDefault;
      const n = defaultTagged.filter(t => t.body.trim()).length;
      announceDefaultOk(`已加载 ${Object.keys(chatData.default).length} 个顶层键（${n} 条合并）`);
    }

    writeVariables('chat', chatData);
    return ok;

  } catch (e) {
    ok = false;
    chatData.schemaStatus = 'error';
    notify.error('世界书加载失败', (e as Error).message, { category: 'wb' });
    writeVariables('chat', chatData);
    return false;
  }
}

async function loadSchema(): Promise<void> {
  try {
    const chatData = readVariables('chat');
    if (chatData.schema && chatData.schemaStatus === 'compiled') {
      const compiled = compileSchemaFromData(chatData.schema);
      tryRegisterMessageLayerVariableSchema(compiled.validator as z.ZodTypeAny);
      await eventBus.emit(EVENTS.VAR_SCHEMA_READY, { defNames: compiled.defNames });
      return;
    }
    // 含 schemaStatus===compiled 但缺 schema 等异常态，统一走世界书重载
    await loadSchemaAndDefaultFromWorldBook();
  } catch (e) {
    notify.error('Schema 加载失败', (e as Error).message, { category: 'sch' });
  }
}

// ═══════════════════════════════════════════
//  手动操作回调
// ═══════════════════════════════════════════

/** 面板「重新加载格式规则」：清空编译缓存并从世界书重载 Schema / Default。 */
async function handleReloadRules(): Promise<void> {
  notify.debug('手动操作', '重新加载格式规则', { category: 'man' });
  clearCache();
  const chatData = readVariables('chat');
  delete chatData.schema;
  delete chatData.default;
  chatData.schemaStatus = 'not_loaded';
  writeVariables('chat', chatData);
  const ok = await loadSchemaAndDefaultFromWorldBook({ expectLorebook: true });
  if (ok) {
    notify.feedback(true, '格式规则', '已从世界书重新加载 [Var_Schema] / [Var_Default]');
  } else {
    notify.feedback(
      false,
      '格式规则',
      '未能完成加载：若无角色卡请先打开角色卡；若有红/橙提示请按其说明处理条目或世界书。',
    );
  }
}

/** 面板「从开场白重新初始化」：仅重跑第 0 层消息上的 Var 标签逻辑。 */
async function handleReinitFromGreeting(): Promise<void> {
  notify.debug('手动操作', '从开场白重新初始化', { category: 'man' });
  if (!isBoundCharacterCardOpen()) {
    notify.feedback(false, '开场白初始化', '请先打开一张角色卡后再使用（默认助手聊天无绑定世界书，变量规则不适用）。');
    return;
  }
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
    notify.error('初始化失败', (e as Error).message, { category: 'man' });
    notify.feedback(false, '开场白初始化', (e as Error).message);
  }
}

/** 面板「重新解析当前楼层」：清空最后一层 message 的 data/log 后按正文重算。 */
async function handleReparseFloor(): Promise<void> {
  notify.debug('手动操作', '重新解析当前楼层', { category: 'man' });
  if (!isBoundCharacterCardOpen()) {
    notify.feedback(false, '重解析', '请先打开一张角色卡后再使用。');
    return;
  }
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
    } else {
      notify.feedback(false, '重解析', '当前楼层没有可解析的消息正文');
    }
  } catch (e) {
    notify.error('重解析失败', (e as Error).message, { category: 'man' });
    notify.feedback(false, '重解析', (e as Error).message);
  }
}

/** 魔棒「设置变量检查点」：将当前最后一层标记为 `isInitPoint`，供链式重解析起点。 */
function handleSetCheckpoint(): void {
  notify.debug('手动操作', '设置变量检查点', { category: 'man' });
  if (!isBoundCharacterCardOpen()) {
    notify.feedback(false, '检查点', '请先打开一张角色卡后再使用。');
    return;
  }
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.feedback(false, '检查点', '当前无聊天消息');
      return;
    }
    const lastIndex = context.chat.length - 1;
    const msgVars = readVariables('message', lastIndex);
    // 面向用户：检查点由 message 层 isInitPoint 标记
    msgVars.isInitPoint = true;
    writeVariables('message', msgVars, lastIndex);
    notify.feedback(true, '检查点', `已将第 ${lastIndex} 层设为检查点`);
  } catch (e) {
    notify.error('检查点设置失败', (e as Error).message, { category: 'man' });
    notify.feedback(false, '检查点', (e as Error).message);
  }
}

/** 魔棒「从检查点逐层重新解析」：从最近检查点下一层起顺序重跑各层正文。 */
async function handleReparseFromCheckpoint(): Promise<void> {
  notify.debug('手动操作', '从检查点逐层重新解析', { category: 'man' });
  if (!isBoundCharacterCardOpen()) {
    notify.feedback(false, '链式重解析', '请先打开一张角色卡后再使用。');
    return;
  }
  try {
    const context = (globalThis as any).SillyTavern?.getContext?.();
    if (!context?.chat?.length) {
      notify.feedback(false, '链式重解析', '当前无聊天消息');
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
    notify.debug('链式重解析', `从第 ${startIndex} 层开始`, { category: 'man' });

    for (let i = startIndex; i < context.chat.length; i++) {
      const msg = context.chat[i];
      if (msg?.mes) {
        await handleMessageContent(msg.mes, i);
      }
    }

    notify.feedback(true, '链式重解析', `已重新解析第 ${startIndex} ~ ${context.chat.length - 1} 层`);
  } catch (e) {
    notify.error('链式重解析失败', (e as Error).message, { category: 'man' });
    notify.feedback(false, '链式重解析', (e as Error).message);
  }
}

// ═══════════════════════════════════════════
//  清理
// ═══════════════════════════════════════════

function cleanup(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', cleanup);
  }
  destroyPanel();
  unregisterFilterHooks();
  unregisterMacros?.();
  eventBus.removeAll();
  notify.debug('卸载', '变量系统 已卸载', { category: 'boot' });
}

// ═══════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════

init().catch((e) => {
  notify.bootstrapError(e);
});
