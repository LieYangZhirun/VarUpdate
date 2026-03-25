/**
 * 深度合并对象：同一路径出现不一致定义时抛出，不静默覆盖。
 * 用于多条世界书 [Var_Schema] / [Var_Default] 条目合并。
 */

export class MergeConflictError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly existing: unknown,
    public readonly incoming: unknown,
  ) {
    super(message);
    this.name = 'MergeConflictError';
  }
}

function isPlainObject(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function stableJson(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/**
 * 将 `next` 合并进 `base` 的副本；若同一路径已有值且与 `next` 不一致则抛 MergeConflictError。
 * `path` 为用于报错的人类可读路径（用 `/` 分隔）。
 */
export function mergeDeepWithConflictCheck(
  base: Record<string, any>,
  next: Record<string, any>,
  pathPrefix = '',
): Record<string, any> {
  const out: Record<string, any> = JSON.parse(JSON.stringify(base));

  for (const key of Object.keys(next)) {
    const path = pathPrefix ? `${pathPrefix}/${key}` : key;
    const nv = next[key];
    if (nv === undefined) continue;

    if (!(key in out) || out[key] === undefined) {
      out[key] = JSON.parse(JSON.stringify(nv));
      continue;
    }

    const bv = out[key];

    if (isPlainObject(bv) && isPlainObject(nv)) {
      out[key] = mergeDeepWithConflictCheck(bv, nv, path);
      continue;
    }

    if (Array.isArray(bv) && Array.isArray(nv)) {
      if (stableJson(bv) !== stableJson(nv)) {
        throw new MergeConflictError(
          `合并冲突：路径 "${path}" 上数组定义不一致`,
          path,
          bv,
          nv,
        );
      }
      out[key] = JSON.parse(JSON.stringify(nv));
      continue;
    }

    if (stableJson(bv) !== stableJson(nv)) {
      throw new MergeConflictError(
        `合并冲突：路径 "${path}" 上定义不一致`,
        path,
        bv,
        nv,
      );
    }

    out[key] = JSON.parse(JSON.stringify(nv));
  }

  return out;
}
