import type { z as ZodGlobal, ZodType, ZodTypeAny } from 'zod';

declare global {
  /**
   * z 命名空间/对象由宿主（酒馆助手）注入，并在 window 级别可用。
   * 此处用于提供全局完整的 TypeScript 类型提示。
   */
  const z: typeof ZodGlobal;
  
  namespace z {
    type ZodType<A=any, B=any, C=any> = import('zod').ZodType<A, B, C>;
    type ZodTypeAny = import('zod').ZodTypeAny;
  }
}