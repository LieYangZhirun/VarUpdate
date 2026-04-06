/**
 * native-filter.test.ts
 *
 * 模块 11：原生过滤 Hook 的单元测试
 * 测试 registerFilterHooks / unregisterFilterHooks 及世界书过滤逻辑
 *
 * Hook 事件：worldinfo_entries_loaded
 * payload 结构：{ globalLore[], characterLore[], chatLore[], personaLore[] }
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
    WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
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
 * 构造 worldinfo_entries_loaded 的 payload
 * 酒馆实际结构：{ globalLore[], characterLore[], chatLore[], personaLore[] }
 */
function makeLoresPayload(entries: Array<{ comment?: string; content?: string }>, category: 'globalLore' | 'characterLore' | 'chatLore' | 'personaLore' = 'globalLore') {
  return {
    globalLore: category === 'globalLore' ? [...entries] : [],
    characterLore: category === 'characterLore' ? [...entries] : [],
    chatLore: category === 'chatLore' ? [...entries] : [],
    personaLore: category === 'personaLore' ? [...entries] : [],
  };
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
    expect(handlers.has('worldinfo_entries_loaded')).toBe(true);
  });

  it('注销后事件回调被移除', () => {
    registerFilterHooks();
    unregisterFilterHooks();
    expect(handlers.has('worldinfo_entries_loaded')).toBe(false);
  });

  it('重复注册不会挂载多个（先注销再注册）', () => {
    registerFilterHooks();
    registerFilterHooks();
    expect(handlers.has('worldinfo_entries_loaded')).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  世界书条目过滤
// ═══════════════════════════════════════════

describe('世界书条目过滤（worldinfo_entries_loaded）', () => {
  beforeEach(() => registerFilterHooks());

  it('无标签条目 → 保留', () => {
    const payload = makeLoresPayload([{ comment: '普通设定', content: '内容' }]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(1);
  });

  it('标签通过 → 保留', () => {
    mockData = { HP: 80 };
    const payload = makeLoresPayload([{ comment: '["HP" >= 60] 战斗设定' }]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(1);
  });

  it('标签不通过 → 移除', () => {
    mockData = { HP: 30 };
    const payload = makeLoresPayload([{ comment: '["HP" >= 60] 战斗设定' }]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(0);
  });

  it('混合条目的正确过滤', () => {
    mockData = { HP: 80, MP: 10 };
    const payload = makeLoresPayload([
      { comment: '["HP" >= 60] 高血量设定' },       // 通过
      { comment: '["MP" >= 50] 高魔力设定' },       // 不通过
      { comment: '普通设定' },                        // 无标签，保留
      { comment: '["HP" >= 100] 满血设定' },         // 不通过
    ]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(2);
    expect(payload.globalLore[0].comment).toContain('高血量');
    expect(payload.globalLore[1].comment).toBe('普通设定');
  });

  it('空 comment 条目 → 不过滤', () => {
    const payload = makeLoresPayload([{ comment: '', content: '无备注条目' }]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
//  多分类过滤
// ═══════════════════════════════════════════

describe('多分类过滤', () => {
  beforeEach(() => registerFilterHooks());

  it('characterLore 中的条目也被过滤', () => {
    mockData = { HP: 30 };
    const payload = makeLoresPayload(
      [{ comment: '["HP" >= 60] 角色专属' }],
      'characterLore',
    );
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.characterLore).toHaveLength(0);
  });

  it('chatLore 中的条目也被过滤', () => {
    mockData = { HP: 30 };
    const payload = makeLoresPayload(
      [{ comment: '["HP" >= 60] 聊天专属' }],
      'chatLore',
    );
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.chatLore).toHaveLength(0);
  });

  it('personaLore 中的条目也被过滤', () => {
    mockData = { HP: 30 };
    const payload = makeLoresPayload(
      [{ comment: '["HP" >= 60] 人设专属' }],
      'personaLore',
    );
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.personaLore).toHaveLength(0);
  });

  it('同时过滤多个分类', () => {
    mockData = { HP: 80 };
    const payload = {
      globalLore: [{ comment: '["HP" >= 60] 全局' }],       // 通过
      characterLore: [{ comment: '["HP" >= 100] 角色' }],   // 不通过
      chatLore: [{ comment: '普通聊天' }],                   // 无标签，保留
      personaLore: [{ comment: '["HP" >= 60] 人设' }],      // 通过
    };
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(1);
    expect(payload.characterLore).toHaveLength(0);
    expect(payload.chatLore).toHaveLength(1);
    expect(payload.personaLore).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
//  变量数据状态
// ═══════════════════════════════════════════

describe('变量数据状态', () => {
  beforeEach(() => registerFilterHooks());

  it('data 为空时 → 所有带标签条目被过滤', () => {
    mockData = {};
    const payload = makeLoresPayload([{ comment: '["HP" >= 60] 需要变量' }]);
    fireEvent('worldinfo_entries_loaded', payload);
    expect(payload.globalLore).toHaveLength(0);
  });

  it('data 更新后过滤结果随之变化', () => {
    // 第一次：HP 不足
    mockData = { HP: 30 };
    const payload1 = makeLoresPayload([{ comment: '["HP" >= 60] 高血量' }]);
    fireEvent('worldinfo_entries_loaded', payload1);
    expect(payload1.globalLore).toHaveLength(0);

    // 第二次：HP 恢复
    mockData = { HP: 80 };
    const payload2 = makeLoresPayload([{ comment: '["HP" >= 60] 高血量' }]);
    fireEvent('worldinfo_entries_loaded', payload2);
    expect(payload2.globalLore).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
//  边界情况
// ═══════════════════════════════════════════

describe('边界情况', () => {
  beforeEach(() => registerFilterHooks());

  it('payload 缺失分类字段 → 不报错', () => {
    expect(() => {
      fireEvent('worldinfo_entries_loaded', { globalLore: [] });
    }).not.toThrow();
  });

  it('payload 为 null → 不报错', () => {
    expect(() => {
      fireEvent('worldinfo_entries_loaded', null);
    }).not.toThrow();
  });

  it('payload 分类不是数组 → 跳过', () => {
    expect(() => {
      fireEvent('worldinfo_entries_loaded', {
        globalLore: 'not-an-array',
        characterLore: 42,
        chatLore: null,
        personaLore: undefined,
      });
    }).not.toThrow();
  });
});
