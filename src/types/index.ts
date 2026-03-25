/**
 * VarUpdate 全局类型定义
 *
 * 包含 iframe 全局变量声明和项目内部共用类型。
 */

// ═══════════════════════════════════════════
//  iframe 全局变量声明
// ═══════════════════════════════════════════

/** lodash（酒馆助手 iframe 全局注入） */
declare const _: typeof import('lodash');

/** js-yaml（酒馆助手 iframe 全局注入） */
declare const YAML: {
  load(input: string, options?: any): any;
  dump(input: any, options?: any): string;
};

/** Zod（酒馆助手 iframe 全局注入） */
declare const z: typeof import('zod');

/** toastr 通知弹窗（酒馆助手 iframe 全局注入） */
declare const toastr: {
  success(message: string, title?: string, options?: any): void;
  error(message: string, title?: string, options?: any): void;
  warning(message: string, title?: string, options?: any): void;
  info(message: string, title?: string, options?: any): void;
};

/** jQuery（酒馆助手 iframe 全局注入） */
declare const $: any;

// ═══════════════════════════════════════════
//  酒馆助手 API 声明
// ═══════════════════════════════════════════

declare function eventEmit(eventName: string, ...args: any[]): Promise<void>;
declare function eventOn(eventName: string, handler: Function): { stop: () => void };
declare function eventOnce(eventName: string, handler: Function): { stop: () => void };
declare function eventClearAll(): void;

// ── 脚本按钮 API ──

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

/** 通知等级数值映射 */
export const NOTIFY_LEVEL_VALUES: Record<NotifyLevel, number> = {
  debug: 0,
  always: 1,
  notice: 2,
  error: 3,
  silence: 4,
};

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
