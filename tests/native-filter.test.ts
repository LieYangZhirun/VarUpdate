/**
 * native-filter.test.ts
 *
 * 模块 11：原生过滤 Hook 的单元测试
 * 测试 registerFilterHooks / unregisterFilterHooks 及过滤逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── stub event-bus ──
const handlers = new Map<string, Function>();
const stopFns = new Map<string, () => void>();

vi.mock('../src/modules/event-bus.js', () => ({
  on: (name: string, handler: Function) => {
    handlers.set(name, handler);
    const stopper = {
      stop: () => { handlers.delete(name); },
    };
    stopFns.set(name, stopper.stop);
    return stopper;
  },
  EVENTS: {
    WORLDINFO_SCAN_DONE: 'worldinfo_scan_done',
    SENDING_MESSAGE: 'sending_message',
  },
}));

// stub variable-store：通过修改 mockData 控制返回值
let mockData: Record<string, any> = {};
vi.mock('../src/modules/variable-store.js', () => ({
  readVariables: () => ({ data: mockData }),
}));

import { registerFilterHooks, unregisterFilterHooks } from '../src/modules/native-filter.js';

// ═══════════════════════════════════════════
//  辅助
// ═══════════════════════════════════════════

function fireEvent(name: string, data: any) {
  const handler = handlers.get(name);
  if (handler) handler(data);
}

/**
 * 构造 WORLDINFO_SCAN_DONE 的 payload
 * 酒馆实际结构：{ activated: { entries: Map<string, entry> }, sortedEntries: entry[] }
 */
function makeWorldInfoPayload(entries: Array<{ comment?: string; content?: string }>) {
  const map = new Map<string, any>();
  const sortedEntries: any[] = [];
  entries.forEach((entry, i) => {
    const key = `world.${i}`;
    map.set(key, entry);
    sortedEntries.push(entry);
  });
  return { activated: { entries: map }, sortedEntries };
}

/** 从 payload 中读取剩余条目为数组（方便断言） */
function getActivatedEntries(payload: any): any[] {
  return [...payload.activated.entries.values()];
}

beforeEach(() => {
  handlers.clear();
  stopFns.clear();
  mockData = {};
  unregisterFilterHooks();
});

afterEach(() => {
  unregisterFilterHooks();
});

// ═══════════════════════════════════════════
//  注册 / 注销
// ═══════════════════════════════════════════

describe('registerFilterHooks / unregisterFilterHooks', () => {
  it('注册后事件回调被挂载', () => {
    registerFilterHooks();
    expect(handlers.has('worldinfo_scan_done')).toBe(true);
    expect(handlers.has('sending_message')).toBe(true);
  });

  it('注销后事件回调被移除', () => {
    registerFilterHooks();
    unregisterFilterHooks();
    expect(handlers.has('worldinfo_scan_done')).toBe(false);
    expect(handlers.has('sending_message')).toBe(false);
  });

  it('重复注册不会挂载多个（先注销再注册）', () => {
    registerFilterHooks();
    registerFilterHooks();
    // 由于 mock 中每次 on 会覆盖，不会出现多个
    expect(handlers.has('worldinfo_scan_done')).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  世界书条目过滤
// ═══════════════════════════════════════════

describe('世界书条目过滤（worldinfo_scan_done）', () => {
  beforeEach(() => registerFilterHooks());

  it('无标签条目 → 保留', () => {
    const payload = makeWorldInfoPayload([{ comment: '普通设定', content: '内容' }]);
    fireEvent('worldinfo_scan_done', payload);
    expect(getActivatedEntries(payload)).toHaveLength(1);
  });

  it('标签通过 → 保留', () => {
    mockData = { HP: 80 };
    const payload = makeWorldInfoPayload([{ comment: '["HP" >= 60] 战斗设定' }]);
    fireEvent('worldinfo_scan_done', payload);
    expect(getActivatedEntries(payload)).toHaveLength(1);
  });

  it('标签不通过 → 移除', () => {
    mockData = { HP: 30 };
    const payload = makeWorldInfoPayload([{ comment: '["HP" >= 60] 战斗设定' }]);
    fireEvent('worldinfo_scan_done', payload);
    expect(getActivatedEntries(payload)).toHaveLength(0);
  });

  it('混合条目的正确过滤', () => {
    mockData = { HP: 80, MP: 10 };
    const payload = makeWorldInfoPayload([
      { comment: '["HP" >= 60] 高血量设定' },       // 通过
      { comment: '["MP" >= 50] 高魔力设定' },       // 不通过
      { comment: '普通设定' },                        // 无标签，保留
      { comment: '["HP" >= 100] 满血设定' },         // 不通过
    ]);
    fireEvent('worldinfo_scan_done', payload);
    const remaining = getActivatedEntries(payload);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].comment).toContain('高血量');
    expect(remaining[1].comment).toBe('普通设定');
  });

  it('被过滤的条目同时从 sortedEntries 中移除', () => {
    mockData = { HP: 30 };
    const payload = makeWorldInfoPayload([{ comment: '["HP" >= 60] 战斗设定' }]);
    fireEvent('worldinfo_scan_done', payload);
    expect(payload.sortedEntries).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════
//  预设条目过滤
// ═══════════════════════════════════════════

describe('预设条目过滤（sending_message）', () => {
  beforeEach(() => registerFilterHooks());

  it('name 字段中的标签求值通过 → 保留', () => {
    mockData = { 地点: '酒馆' };
    const data = { prompts: [{ name: '["地点" == "酒馆"] 酒馆氛围' }] };
    fireEvent('sending_message', data);
    expect(data.prompts).toHaveLength(1);
  });

  it('name 字段中的标签不通过 → 移除', () => {
    mockData = { 地点: '森林' };
    const data = { prompts: [{ name: '["地点" == "酒馆"] 酒馆氛围' }] };
    fireEvent('sending_message', data);
    expect(data.prompts).toHaveLength(0);
  });

  it('无 name 字段 → 不过滤', () => {
    const data = { prompts: [{ content: '无名预设' }] };
    fireEvent('sending_message', data);
    expect(data.prompts).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
//  正则脚本过滤
// ═══════════════════════════════════════════

describe('正则脚本过滤（sending_message）', () => {
  beforeEach(() => registerFilterHooks());

  it('scriptName 中的标签求值通过 → 保留', () => {
    mockData = { HP: 80 };
    const data = { regexScripts: [{ scriptName: '["HP" >= 60] 战斗正则' }] };
    fireEvent('sending_message', data);
    expect(data.regexScripts).toHaveLength(1);
  });

  it('scriptName 中的标签不通过 → 移除', () => {
    mockData = { HP: 30 };
    const data = { regexScripts: [{ scriptName: '["HP" >= 60] 战斗正则' }] };
    fireEvent('sending_message', data);
    expect(data.regexScripts).toHaveLength(0);
  });

  it('无标签脚本 → 不过滤', () => {
    const data = { regexScripts: [{ scriptName: '通用正则' }] };
    fireEvent('sending_message', data);
    expect(data.regexScripts).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
//  变量数据状态
// ═══════════════════════════════════════════

describe('变量数据状态', () => {
  beforeEach(() => registerFilterHooks());

  it('data 为空时 → 所有带标签条目被过滤', () => {
    mockData = {};
    const payload = makeWorldInfoPayload([{ comment: '["HP" >= 60] 需要变量' }]);
    fireEvent('worldinfo_scan_done', payload);
    expect(getActivatedEntries(payload)).toHaveLength(0);
  });

  it('data 更新后过滤结果随之变化', () => {
    // 第一次：HP 不足
    mockData = { HP: 30 };
    const payload1 = makeWorldInfoPayload([{ comment: '["HP" >= 60] 高血量' }]);
    fireEvent('worldinfo_scan_done', payload1);
    expect(getActivatedEntries(payload1)).toHaveLength(0);

    // 第二次：HP 恢复
    mockData = { HP: 80 };
    const payload2 = makeWorldInfoPayload([{ comment: '["HP" >= 60] 高血量' }]);
    fireEvent('worldinfo_scan_done', payload2);
    expect(getActivatedEntries(payload2)).toHaveLength(1);
  });
});
