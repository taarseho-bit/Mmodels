import { resolve, relative, isAbsolute, sep } from 'node:path';
import { realpathSync } from 'node:fs';
const canonical = (path: string): string => { try { return realpathSync.native(resolve(path)); } catch { return resolve(path); } };
export function projectPathRelation(parent: string, child: string): 'same' | 'inside' | 'separate' {
  const path = relative(canonical(parent), canonical(child));
  if (!path) return 'same';
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) ? 'inside' : 'separate';
}
