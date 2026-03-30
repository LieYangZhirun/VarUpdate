import { describe, it, expect, vi } from 'vitest';
import { setLevel, getLevel, notify, trace, bridgeError } from '../src/modules/notification';

describe('notification', () => {
  it('默认等级为 notice', () => {
    expect(getLevel()).toBe('notice');
  });

  it('setLevel 修改等级', () => {
    setLevel('debug');
    expect(getLevel()).toBe('debug');
    setLevel('notice'); // 重置
  });

  it('notify 不抛错', () => {
    // 在测试环境中 toastr 不可用，只验证不抛异常
    expect(() => notify('debug', '测试', '调试信息')).not.toThrow();
    expect(() => notify('always', '测试', '成功信息')).not.toThrow();
    expect(() => notify('notice', '测试', '警告信息')).not.toThrow();
    expect(() => notify('error', '测试', '错误信息')).not.toThrow();
    expect(() => notify('silence', '测试', '静默信息')).not.toThrow();
  });

  it('silence 等级不输出', () => {
    setLevel('silence');
    // 不抛异常
    expect(() => notify('error', '错误', '这不应该显示')).not.toThrow();
    setLevel('notice'); // 重置
  });

  it('notice 等级下 trace 不写控制台', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLevel('notice');
    trace('t', 'm', 'pat');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    setLevel('notice');
  });

  it('debug 等级下 trace 写控制台', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLevel('debug');
    trace('t', 'm', 'pat');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    setLevel('notice');
  });

  it('bridgeError 在 silence 仍调用 console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setLevel('silence');
    expect(() => bridgeError('测试桥接', new Error('x'))).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    setLevel('notice');
  });
});
