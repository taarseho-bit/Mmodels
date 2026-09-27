import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type LocalComputeName = 'r' | 'octave';

/** Prefer a working PATH command, then reuse an installation in common Windows locations. */
export function localComputeCandidates(
  name: LocalComputeName,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform !== 'win32') return [name === 'r' ? 'Rscript' : 'octave'];
  const command = name === 'r' ? 'Rscript.exe' : 'octave-cli.exe';
  const candidates = [command];
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter((value): value is string => Boolean(value));
  for (const root of roots) {
    const parent = join(root, name === 'r' ? 'R' : 'GNU Octave');
    if (!existsSync(parent)) continue;
    let versions: string[];
    try { versions = readdirSync(parent).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
    catch { continue; }
    for (const version of versions) {
      const base = join(parent, version);
      const paths = name === 'r'
        ? [join(base, 'bin', command), join(base, 'bin', 'x64', command)]
        : [join(base, 'mingw64', 'bin', command), join(base, 'bin', command)];
      candidates.push(...paths.filter(existsSync));
    }
  }
  return [...new Set(candidates)];
}

export async function findLocalCompute(name: LocalComputeName): Promise<{ command: string; version: string } | null> {
  for (const command of localComputeCandidates(name)) {
    const result = await new Promise<{ ok: boolean; version: string }>(resolve => {
      execFile(command, ['--version'], { timeout: 8_000, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ ok: !error, version: String(stdout || stderr || '').split(/\r?\n/).find(Boolean)?.trim() ?? '' });
      });
    });
    if (result.ok && (name === 'r' ? /Rscript|R version/i : /octave/i).test(result.version)) {
      return { command, version: result.version };
    }
  }
  return null;
}
