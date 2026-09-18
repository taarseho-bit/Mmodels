/** Locate files shipped beside the Electron application across installed and portable builds. */
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

export interface ResourceLocationOverrides {
  resourcesPath?: string | null;
  appPath?: string | null;
  exePath?: string | null;
  cwd?: string | null;
}

function runtimeLocations(): ResourceLocationOverrides {
  let appPath: string | null = null;
  let exePath: string | null = null;
  try {
    appPath = app.getAppPath();
  } catch {
    /* Electron app is not ready, or a plain Node test is importing this module. */
  }
  try {
    exePath = app.getPath('exe');
  } catch {
    /* Same as above. */
  }
  return {
    resourcesPath: process.resourcesPath || null,
    appPath,
    exePath,
    cwd: process.cwd(),
  };
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    if (!value) continue;
    const path = normalize(resolve(value));
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

/** Candidates ordered from the authoritative packaged location to development fallbacks. */
export function resourceRoots(overrides?: ResourceLocationOverrides): string[] {
  const loc = overrides ?? runtimeLocations();
  const appPath = loc.appPath || null;
  const exeDir = loc.exePath ? dirname(loc.exePath) : null;
  const appParent = appPath ? dirname(appPath) : null;
  return uniquePaths([
    loc.resourcesPath,
    exeDir ? join(exeDir, 'resources') : null,
    // Packaged appPath is normally <resources>/app.asar.
    appPath?.toLowerCase().endsWith('.asar') ? appParent : null,
    appPath && !appPath.toLowerCase().endsWith('.asar') ? join(appPath, 'resources') : null,
    appPath && appPath.toLowerCase().endsWith('resources') ? appPath : null,
    loc.cwd ? join(loc.cwd, 'resources') : null,
  ]);
}

/** Find a concrete bundled file or directory without leaking candidate paths to the UI. */
export function resolveResource(
  parts: string[],
  overrides?: ResourceLocationOverrides,
): string | null {
  for (const root of resourceRoots(overrides)) {
    const candidate = join(root, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Find the resources root that contains a required bundled path. */
export function resolveResourcesRoot(
  requiredParts: string[],
  friendlyName: string,
  overrides?: ResourceLocationOverrides,
): string {
  for (const root of resourceRoots(overrides)) {
    if (existsSync(join(root, ...requiredParts))) return root;
  }
  throw new Error(`没有找到内置${friendlyName}。请重新打开应用；如果仍未恢复，请重新下载最新版免安装包。`);
}
