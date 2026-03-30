/**
 * chat 楼层下标规范化（写入 message 层变量前使用）。
 *
 * 用于 `agents:message_complete`、宿主 `message_received` / `message_edited` / `message_swiped`、`varupdate:retry_requested` 等。
 *
 * 返回 `undefined`：`message_complete` 可由主控制器回退最后一楼；宿主类事件应在 `notify.debug` 后忽略（见《接口与契约》「VarUpdate 双通道消息处理」）。
 */
export function sanitizeMessageIndexForWrite(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    n = parseInt(raw.trim(), 10);
  } else {
    return undefined;
  }
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}
