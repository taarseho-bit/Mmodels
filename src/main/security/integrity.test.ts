import { describe, expect, it } from 'vitest';
import { digestMatches, parseIntegrityMeta } from './integrity';

const HASH = 'a'.repeat(64);

describe('发布包完整性元数据', () => {
  it('接受版本化的 app.asar 与资源清单', () => {
    const meta = parseIntegrityMeta(JSON.stringify({
      schema: 2, algo: 'sha256', hash: HASH, builtAt: '2026-09-28T00:00:00.000Z', version: '0.1.16',
      files: [{ path: 'algorithms/catalog.json', hash: HASH, size: 123 }],
    }));
    expect(meta.files[0]).toEqual({ path: 'algorithms/catalog.json', hash: HASH, size: 123 });
  });

  it('拒绝越界、重复和错误指纹', () => {
    const base = { schema: 2, algo: 'sha256', hash: HASH, builtAt: 'now', version: '0.1.16', files: [{ path: 'algorithms/catalog.json', hash: HASH, size: 1 }] };
    expect(() => parseIntegrityMeta(JSON.stringify({ ...base, files: [{ ...base.files[0], path: '../app.asar' }] }))).toThrow();
    expect(() => parseIntegrityMeta(JSON.stringify({ ...base, files: [{ ...base.files[0], hash: 'bad' }] }))).toThrow();
    expect(() => parseIntegrityMeta(JSON.stringify({ ...base, files: [base.files[0], base.files[0]] }))).toThrow();
  });

  it('比较指纹时不受大小写影响', () => {
    expect(digestMatches(HASH, HASH.toUpperCase())).toBe(true);
    expect(digestMatches(HASH, 'b'.repeat(64))).toBe(false);
  });
});
