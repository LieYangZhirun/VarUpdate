/**
 * 酒馆助手 iframe 全局变量的 TypeScript 声明
 *
 * 酒馆助手的 predefine.js 在 iframe window 中注入以下全局对象，
 * 本文件为开发时提供类型支持。
 */

// ─── 第三方库（由酒馆助手注入）───
declare const _: typeof import('lodash');
declare const YAML: typeof import('js-yaml');
declare const z: typeof import('zod');
declare const toastr: {
  success(message: string, title?: string): void;
  info(message: string, title?: string): void;
  warning(message: string, title?: string): void;
  error(message: string, title?: string): void;
};
declare const $: typeof import('jquery');

// ─── 酒馆助手变量 API ───
declare function getVariables(option?: import('./index').VariableOption): Record<string, any>;
declare function replaceVariables(variables: Record<string, any>, option?: import('./index').VariableOption): void;
declare function updateVariablesWith(
  updater: (variables: Record<string, any>) => Record<string, any>,
  option?: import('./index').VariableOption
): Record<string, any>;
declare function insertOrAssignVariables(
  variables: Record<string, any>,
  option?: import('./index').VariableOption
): Record<string, any>;
declare function registerVariableSchema(
  schema: import('zod').ZodType<any>,
  option: { type: 'global' | 'preset' | 'character' | 'chat' | 'message' }
): void;
declare function getAllVariables(): Record<string, any>;

// ─── 酒馆助手事件 API ───
declare function eventOn(event_type: string, listener: (...args: any[]) => any): { stop: () => void };
declare function eventOnce(event_type: string, listener: (...args: any[]) => any): { stop: () => void };
declare function eventEmit(event_type: string, ...data: any[]): Promise<void>;
declare function eventRemoveListener(event_type: string, listener: (...args: any[]) => any): void;
declare function eventClearAll(): void;
declare function eventClearEvent(event_type: string): void;

// ─── 酒馆助手宏注册 ───
interface MacroLikeContext {
  message_id?: number;
  role?: 'user' | 'assistant' | 'system';
}
declare function registerMacroLike(
  regex: RegExp,
  replace: (context: MacroLikeContext, substring: string, ...args: any[]) => string
): { unregister: () => void };

// ─── 酒馆助手按钮 ───
interface ScriptButton {
  name: string;
  visible: boolean;
}
declare function getButtonEvent(button_name: string): string;
declare function appendInexistentScriptButtons(buttons: ScriptButton[]): void;
declare function replaceScriptButtons(buttons: ScriptButton[]): void;
