/** 发布包完整性元数据的纯校验工具。 */

export interface IntegrityFileEntry {
  path: string;
  hash: string;
  size: number;
}

export interface IntegrityMeta {
  schema: 2;
  algo: 'sha256';
  hash: string;
  builtAt: string;
  version: string;
  files: IntegrityFileEntry[];
}

const SHA256_RE = /^[a-f0-9]{64}$/i;

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_RE.test(value);
}

export function parseIntegrityMeta(text: string): IntegrityMeta {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('integrity.meta 不是对象');
  const record = raw as Record<string, unknown>;
  if (record.schema !== 2 || record.algo !== 'sha256') throw new Error('integrity.meta 版本或算法不受支持');
  if (!isSha256(record.hash)) throw new Error('integrity.meta 的 app.asar 指纹无效');
  if (typeof record.builtAt !== 'string' || typeof record.version !== 'string') throw new Error('integrity.meta 缺少构建信息');
  if (!Array.isArray(record.files)) throw new Error('integrity.meta 缺少资源清单');

  const files = record.files.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`资源清单第 ${index + 1} 项无效`);
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/') || entry.path.includes('\\')) throw new Error(`资源清单第 ${index + 1} 项路径无效`);
    const normalized = entry.path.replaceAll('\\', '/');
    if (normalized.split('/').some((part) => part === '..' || part === '.')) throw new Error(`资源清单第 ${index + 1} 项越界`);
    const size = entry.size;
    if (!isSha256(entry.hash) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error(`资源清单第 ${index + 1} 项指纹无效`);
    return { path: normalized, hash: entry.hash.toLowerCase(), size };
  });

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`资源清单重复：${file.path}`);
    seen.add(file.path);
  }
  return { schema: 2, algo: 'sha256', hash: record.hash.toLowerCase(), builtAt: record.builtAt, version: record.version, files };
}

export function digestMatches(expected: string, actual: string): boolean {
  return isSha256(expected) && isSha256(actual) && expected.toLowerCase() === actual.toLowerCase();
}
