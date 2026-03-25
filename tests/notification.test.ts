import { describe, it, expect } from 'vitest';
import { setLevel, getLevel, notify } from '../src/modules/notification';

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
});
