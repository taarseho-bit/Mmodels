import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localComputeCandidates } from './local-compute';

describe('本地计算连接器路径', () => {
  it('Windows 已安装 R 但未加入 PATH 时仍找到 Rscript', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-r-path-'));
    try {
      const executable = join(root, 'R', 'R-4.6.1', 'bin', 'Rscript.exe');
      mkdirSync(join(root, 'R', 'R-4.6.1', 'bin'), { recursive: true });
      writeFileSync(executable, '');
      expect(existsSync(executable)).toBe(true);
      expect(localComputeCandidates('r', 'win32', { ProgramFiles: root })).toContain(executable);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('Windows Octave 的 mingw64 目录可被找到', () => {
    const root = mkdtempSync(join(tmpdir(), 'mm-octave-path-'));
    try {
      const executable = join(root, 'GNU Octave', 'Octave-11.3.0', 'mingw64', 'bin', 'octave-cli.exe');
      mkdirSync(join(root, 'GNU Octave', 'Octave-11.3.0', 'mingw64', 'bin'), { recursive: true });
      writeFileSync(executable, '');
      expect(localComputeCandidates('octave', 'win32', { ProgramFiles: root })).toContain(executable);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('其他平台保持系统命令，不依赖 Windows 目录', () => {
    expect(localComputeCandidates('r', 'linux', {})).toEqual(['Rscript']);
    expect(localComputeCandidates('octave', 'darwin', {})).toEqual(['octave']);
  });
});
