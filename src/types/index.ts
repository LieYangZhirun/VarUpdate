/**
 * VarUpdate 类型定义
 *
 * 本文件为 ES 模块：iframe 注入的全局符号必须写在 `declare global` 内，否则不会合并到全局作用域。
 */

// ═══════════════════════════════════════════
//  与宿主 API 共用的类型（导出供模块内使用）
// ═══════════════════════════════════════════

/** 变量存储选项（酒馆助手 getVariables / replaceVariables） */
export type VariableOption =
  | { type: 'global' }
  | { type: 'chat' }
  | { type: 'character' }
  | { type: 'preset' }
  | { type: 'message'; message_id?: number | 'latest' }
  | { type: 'script'; script_id?: string }
  | { type: 'extension'; extension_id: string };

/** registerMacroLike 回调上下文 */
export interface MacroLikeContext {
  message_id?: number;
  role?: 'user' | 'assistant' | 'system';
}

/** 脚本工具栏按钮 */
export interface ScriptButton {
  name: string;
  visible: boolean;
}

// ═══════════════════════════════════════════
//  iframe / 宿主注入的全局（declare global）
// ═══════════════════════════════════════════

declare global {
  /** lodash（可选） */
  const _: {
    cloneDeep?: <T>(obj: T) => T;
    [key: string]: unknown;
  } | undefined;

  const YAML: {
    load(input: string, options?: unknown): unknown;
    dump?(input: unknown, options?: unknown): string;
  };

  const toastr: {
    success(message: string, title?: string, options?: unknown): void;
    error(message: string, title?: string, options?: unknown): void;
    warning(message: string, title?: string, options?: unknown): void;
    info(message: string, title?: string, options?: unknown): void;
  };

  const $: unknown;

  function eventEmit(eventName: string, ...args: unknown[]): Promise<void>;
  function eventOn(eventName: string, handler: (...args: unknown[]) => void): { stop: () => void };
  function eventOnce(eventName: string, handler: (...args: unknown[]) => void): { stop: () => void };
  function eventClearAll(): void;
  function eventRemoveListener(eventName: string, handler: (...args: unknown[]) => void): void;

  function getVariables(option?: VariableOption): Record<string, unknown>;
  function replaceVariables(variables: Record<string, unknown>, option?: VariableOption): void;
  function updateVariablesWith(
    updater: (variables: Record<string, unknown>) => Record<string, unknown>,
    option?: VariableOption,
  ): Record<string, unknown>;
  function insertOrAssignVariables(
    variables: Record<string, unknown>,
    option?: VariableOption,
  ): Record<string, unknown>;
  function getAllVariables(): Record<string, unknown>;

  function registerMacroLike(
    regex: RegExp,
    replace: (context: MacroLikeContext, substring: string, ...args: any[]) => string,
  ): { unregister: () => void };
  function unregisterMacroLike(regex: RegExp): void;

  function appendInexistentScriptButtons(buttons: ScriptButton[]): void;
  function getButtonEvent(button_name: string): string;
  function getScriptButtons(): ScriptButton[];
  function replaceScriptButtons(buttons: ScriptButton[]): void;

  /** 变量管理器 Schema 注册（部分宿主提供） */
  function registerVariableSchema(validator: unknown, option?: { type?: string }): void;
}

// ═══════════════════════════════════════════
//  VarUpdate 内部类型
// ═══════════════════════════════════════════

/** 存储层级 */
export type StoreLayer = 'global' | 'chat' | 'message';

/** 通知等级 */
export type NotifyLevel = 'debug' | 'always' | 'notice' | 'error' | 'silence';

// ─── 标签提取 ───

/** 提取出的变量标签 */
export interface ExtractedTag {
  type: 'initial' | 'update';
  /** 标签内的原始文本内容 */
  content: string;
  /** 标签在消息中的起始位置 */
  startIndex: number;
  /** 标签在消息中的结束位置 */
  endIndex: number;
}

/** 标签提取结果 */
export interface ExtractionResult {
  tags: ExtractedTag[];
  /** 是否检测到截断（有开标签但无对应闭标签） */
  truncated: boolean;
  /** 截断的标签类型 */
  truncatedType?: 'initial' | 'update';
}

// ─── JSON Patch ───

/** 标准化后的 Patch 指令 */
export interface PatchInstruction {
  op: 'replace' | 'insert' | 'delete';
  path: string;
  value?: unknown;
}

/** 更新执行结果 */
export interface UpdateResult {
  data: Record<string, unknown>;
  appliedCount: number;
  discarded: Array<{ instruction: PatchInstruction; reason: string }>;
  log: Record<string, string>;
}

// ─── 事件负载 ───

export interface VarInitializedPayload {
  messageIndex: number;
  data: Record<string, unknown>;
}

export interface VarUpdatedPayload {
  messageIndex: number;
  appliedCount: number;
  discardedCount: number;
  log: Record<string, string>;
}

export interface VarUpdateFailedPayload {
  messageIndex: number;
  reason: string;
  discardedCount: number;
}

export interface SchemaReadyPayload {
  defNames: string[];
}

export interface RetryRequestedPayload {
  messageIndex: number;
}

/**
 * Agents 通过 `agents:message_complete` 传入。
 *
 * **messageIndex**：目标聊天楼层下标（message 层变量按此 id 读写）。
 * 即便「仅解析 / 预览」尚未把正文写入该楼层的持久化消息，只要逻辑上在生成/预览第 N 楼，
 * 也应传入 **N**；与是否落库 mes 无关。缺省时 VarUpdate 会回退为当前 chat 最后一楼（可能偏题）。
 *
 * **writeMode**：宿主/Agents 对写回模式的标记；VarUpdate 当前不据此跳过变量写入（变量与 mes 持久化解耦）。
 */
export interface MessageCompletePayload {
  agentId: string;
  agentLabel: string;
  stepIndex: number;
  content: string;
  reasoning?: string;
  messageIndex?: number;
  writeMode: string;
}
