/**
 * VarUpdate 全局类型定义
 *
 * 包含 iframe 全局变量声明和项目内部共用类型。
 */

// ═══════════════════════════════════════════
//  iframe 全局变量声明（由酒馆助手 predefine.js 注入）
// ═══════════════════════════════════════════

/** lodash */
declare const _: typeof import('lodash');

/** js-yaml */
declare const YAML: {
  load(input: string, options?: any): any;
  dump(input: any, options?: any): string;
};

/** Zod */
declare const z: typeof import('zod');

/** toastr 通知弹窗 */
declare const toastr: {
  success(message: string, title?: string, options?: any): void;
  error(message: string, title?: string, options?: any): void;
  warning(message: string, title?: string, options?: any): void;
  info(message: string, title?: string, options?: any): void;
};

/** jQuery */
declare const $: any;

// ═══════════════════════════════════════════
//  酒馆助手事件 API（从 TavernHelper._bind 解构到 iframe window）
// ═══════════════════════════════════════════

declare function eventEmit(eventName: string, ...args: any[]): Promise<void>;
declare function eventOn(eventName: string, handler: Function): { stop: () => void };
declare function eventOnce(eventName: string, handler: Function): { stop: () => void };
declare function eventClearAll(): void;
declare function eventRemoveListener(eventName: string, handler: Function): void;

// ═══════════════════════════════════════════
//  酒馆助手变量 API（从 TavernHelper._bind 解构到 iframe window）
// ═══════════════════════════════════════════

type VariableOption =
  | { type: 'global' }
  | { type: 'chat' }
  | { type: 'character' }
  | { type: 'preset' }
  | { type: 'message'; message_id?: number | 'latest' }
  | { type: 'script'; script_id?: string }
  | { type: 'extension'; extension_id: string };

/** 读取指定作用域的变量（返回深拷贝） */
declare function getVariables(option?: VariableOption): Record<string, any>;

/** 全量替换指定作用域的变量 */
declare function replaceVariables(variables: Record<string, any>, option?: VariableOption): void;

/** 用 updater 函数读取→修改→写回变量 */
declare function updateVariablesWith(
  updater: (variables: Record<string, any>) => Record<string, any>,
  option?: VariableOption
): Record<string, any>;

/** 合并写入变量（已有键保留，新键插入） */
declare function insertOrAssignVariables(
  variables: Record<string, any>,
  option?: VariableOption
): Record<string, any>;

/** 获取合并后的全层变量表 */
declare function getAllVariables(): Record<string, any>;

// ═══════════════════════════════════════════
//  酒馆助手宏注册 API
// ═══════════════════════════════════════════

interface MacroLikeContext {
  message_id?: number;
  role?: 'user' | 'assistant' | 'system';
}

/** 注册自定义插值宏，iframe pagehide 时自动注销 */
declare function registerMacroLike(
  regex: RegExp,
  replace: (context: MacroLikeContext, substring: string, ...args: any[]) => string,
): { unregister: () => void };

/** 手动注销宏 */
declare function unregisterMacroLike(regex: RegExp): void;

// ═══════════════════════════════════════════
//  酒馆助手脚本按钮 API
// ═══════════════════════════════════════════

interface ScriptButton {
  name: string;
  visible: boolean;
}

/** 在魔棒菜单末尾追加不存在的按钮（不重复） */
declare function appendInexistentScriptButtons(buttons: ScriptButton[]): void;
/** 获取按钮对应的事件类型名 */
declare function getButtonEvent(button_name: string): string;
/** 获取当前脚本的按钮列表 */
declare function getScriptButtons(): ScriptButton[];
/** 完全替换脚本的按钮列表 */
declare function replaceScriptButtons(buttons: ScriptButton[]): void;

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
  value?: any;
}

/** 更新执行结果 */
export interface UpdateResult {
  data: Record<string, any>;
  appliedCount: number;
  discarded: Array<{ instruction: PatchInstruction; reason: string }>;
  log: Record<string, string>;
}

// ─── 事件负载 ───

export interface VarInitializedPayload {
  messageIndex: number;
  data: Record<string, any>;
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

export interface MessageCompletePayload {
  agentId: string;
  agentLabel: string;
  stepIndex: number;
  content: string;
  reasoning?: string;
  messageIndex?: number;
  writeMode: string;
}
