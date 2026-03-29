/**
 * shared/path-utils.ts
 *
 * 变量路径解析与读写（JSON Patch、变量存储、插值宏共用）。
 * 路径为 `/` 分隔的段序列，例如 `角色/HP`、`背包/0/名称`。
 */

/**
 * 将 / 分隔的路径字符串转为段数组
 *
 * "角色/HP"       → ["角色", "HP"]
 * "背包/0/名称"   → ["背包", "0", "名称"]
 * ""              → []
 * "单独"          → ["单独"]
 */
export function parsePath(path: string): string[] {
  if (!path || path.trim() === '') return [];
  // 去除首尾 /
  const cleaned = path.replace(/^\/+|\/+$/g, '');
  if (cleaned === '') return [];
  return cleaned.split('/');
}

/**
 * 按路径从对象中取值
 *
 * @param data 数据对象
 * @param path / 分隔的路径字符串
 * @returns 路径对应的值，不存在时返回 undefined
 */
export function getValueByPath(data: any, path: string): any {
  const segments = parsePath(path);
  if (segments.length === 0) return data;

  let current = data;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;

    // 数字索引 → 尝试数组访问
    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }
  return current;
}

/**
 * 按路径向对象中写值
 *
 * 中间路径不存在时自动创建（数字键名 → 数组，其他 → 对象）
 *
 * @param data 数据对象（会被就地修改）
 * @param path / 分隔的路径字符串
 * @param value 要写入的值
 */
export function setValueByPath(data: any, path: string, value: any): void {
  const segments = parsePath(path);
  if (segments.length === 0) return;

  let current = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];

    if (current[seg] === undefined || current[seg] === null || typeof current[seg] !== 'object') {
      // 自动创建中间节点
      current[seg] = /^\d+$/.test(nextSeg) ? [] : {};
    }

    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
    current[parseInt(lastSeg, 10)] = value;
  } else if (lastSeg === '-' && Array.isArray(current)) {
    // "-" → 数组末尾追加
    current.push(value);
  } else {
    current[lastSeg] = value;
  }
}

/**
 * 按路径删除对象中的值
 *
 * @param data 数据对象（会被就地修改）
 * @param path / 分隔的路径字符串
 * @returns 是否成功删除
 */
export function deleteByPath(data: any, path: string): boolean {
  const segments = parsePath(path);
  if (segments.length === 0) return false;

  let current = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return false;
    }
    if (Array.isArray(current) && /^\d+$/.test(seg)) {
      current = current[parseInt(seg, 10)];
    } else {
      current = current[seg];
    }
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    return false;
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && /^\d+$/.test(lastSeg)) {
    const idx = parseInt(lastSeg, 10);
    if (idx >= 0 && idx < current.length) {
      current.splice(idx, 1);
      return true;
    }
    return false;
  } else if (lastSeg in current) {
    delete current[lastSeg];
    return true;
  }
  return false;
}

/**
 * 在对象中递归搜索所有叶子键名匹配的完整路径
 *
 * 用于反向路径解析的第一步（全局搜索候选集）
 *
 * @param data 数据对象
 * @param leafKey 要搜索的叶子键名
 * @param currentPath 当前路径前缀（递归用）
 * @returns 所有匹配的完整路径数组
 */
export function findAllPaths(data: any, leafKey: string, currentPath: string = ''): string[] {
  const results: string[] = [];

  if (data === null || data === undefined || typeof data !== 'object') {
    return results;
  }

  const entries = Array.isArray(data)
    ? data.map((v, i) => [String(i), v] as [string, any])
    : Object.entries(data);

  for (const [key, value] of entries) {
    const fullPath = currentPath ? `${currentPath}/${key}` : key;

    if (key === leafKey) {
      results.push(fullPath);
    }

    // 递归搜索子对象
    if (value !== null && typeof value === 'object') {
      results.push(...findAllPaths(value, leafKey, fullPath));
    }
  }

  return results;
}
