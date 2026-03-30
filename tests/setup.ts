/**
 * Vitest 全局 setup
 *
 * 模拟酒馆助手 iframe 环境注入的全局变量，
 * 使依赖全局 z 的模块在测试中能正常运行。
 */
import { z } from 'zod';

// 注入全局 z（模拟酒馆助手 predefine.js 的行为）
(globalThis as any).z = z;
