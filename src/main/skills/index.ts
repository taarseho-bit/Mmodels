/**
 * 技能（Skill）扫描与管理。
 *
 * 技能的形态（复刻原版约定）：
 *   <skill-root>/<dir-name>/
 *     SKILL.md              ← 必需，YAML frontmatter 带 name / description
 *     scripts/              ← 可选，可执行脚本
 *     references/           ← 可选，参考文档
 *     assets/               ← 可选，模板/图片等
 *     .disabled-by-default  ← 可选空文件，存在则默认不启用
 *
 * ⚠️ 设计取舍：为什么用「禁用列表 + 显式启用列表」而不是单一启用列表
 *    原版的约定是：技能目录一放进去就自动生效，除非有 `.disabled-by-default`。
 *    我们的持久化反过来记 —— 默认态不写配置，只记**用户动过的开关**：
 *      - disabledSkills：用户关掉的目录名；
 *      - enabledSkills：用户显式打开的目录名（用来压过技能自带的 .disabled-by-default）。
 *    好处：新增技能目录（比如用户从扩展市场下载）不需要改配置就自动可用，
 *    符合「零配置」的产品直觉；而带 `.disabled-by-default` 的内置技能
 *    （data-search、metaheuristic-optimization）用户点开关也能真正打开。
 *
 * ⚠️ 为什么不用 gray-matter 之类的依赖
 *    frontmatter 的解析需求极窄（只要 name 和 description 两个标量），
 *    手写 20 行比引一个包更省事，而且零依赖对主进程打包更友好。
 */
import { app } from 'electron';
import { join, basename } from 'node:path';
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  mkdirSync,
  cpSync,
  rmSync,
} from 'node:fs';
import type { SkillMeta } from '@shared/types';
import { disabledSkillDirs, enabledSkillDirs, setSkillDisabled } from '../store/config';
import { resolveResource } from '../resources';

// ─────────────────────────────────────────────────────────────
// 技能根目录
// ─────────────────────────────────────────────────────────────

/**
 * 内置技能目录。
 * 开发态：<projectRoot>/resources/builtin-skills
 * 打包后：<appPath>/resources/builtin-skills  （由 electron-builder 的 extraResources 放进去）
 */
export function builtinSkillsRoot(): string {
  const found = resolveResource(['builtin-skills']);
  if (found) return found;
  throw new Error('没有找到内置技能。请重新打开应用；如果仍未恢复，请重新下载最新版免安装包。');
}

/** 用户技能目录（可写） */
export function userSkillsRoot(): string {
  const dir = join(app.getPath('userData'), 'skills');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────
// frontmatter 解析
// ─────────────────────────────────────────────────────────────

interface Frontmatter {
  name?: string;
  description?: string;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 *
 * 只处理最简单的 `key: value` 形态，支持值被引号包裹、
 * 以及 `key: |` 或 `key: >` 的多行块（description 常常很长）。
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const result: Frontmatter = {};
  if (!raw.startsWith('---')) return result;

  const end = raw.indexOf('\n---', 3);
  if (end < 0) return result;
  const body = raw.slice(3, end);

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();

    // 多行块：`description: |` 后面缩进的内容
    if (value === '|' || value === '>' || value === '|-') {
      const chunks: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === '') {
          chunks.push('');
          continue;
        }
        if (!/^\s/.test(next)) break;
        chunks.push(next.replace(/^\s{1,2}/, ''));
      }
      i = j - 1;
      value = chunks.join(value === '>' ? ' ' : '\n').trim();
    } else {
      // 去掉包裹引号
      value = value.replace(/^["'](.*)["']$/, '$1').trim();
    }

    if (key === 'name') result.name = value;
    else if (key === 'description') result.description = value;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 扫描
// ─────────────────────────────────────────────────────────────

/** 递归统计文件数与体积（用于界面提示"重"技能） */
function measure(dir: string): { fileCount: number; byteSize: number } {
  let fileCount = 0;
  let byteSize = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else {
        fileCount += 1;
        byteSize += st.size;
      }
    }
  }
  return { fileCount, byteSize };
}

function readSkill(baseDir: string, source: 'builtin' | 'user'): SkillMeta | null {
  const mdPath = join(baseDir, 'SKILL.md');
  if (!existsSync(mdPath)) return null;

  let raw = '';
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch {
    return null;
  }
  const fm = parseFrontmatter(raw);
  const dirName = basename(baseDir);

  const disabledByDefault = existsSync(join(baseDir, '.disabled-by-default'));
  const hasScripts = existsSync(join(baseDir, 'scripts'));
  const { fileCount, byteSize } = measure(baseDir);

  // 生效状态：用户显式禁用 > 用户显式启用 > 技能自带的 .disabled-by-default 默认值
  const disabled = disabledSkillDirs();
  const forcedOn = enabledSkillDirs();
  const enabled = disabled.has(dirName) ? false : forcedOn.has(dirName) ? true : !disabledByDefault;

  return {
    dirName,
    name: fm.name || dirName,
    description: fm.description || '（SKILL.md 未提供 description）',
    source,
    path: baseDir,
    disabledByDefault,
    enabled,
    fileCount,
    byteSize,
    hasScripts,
  };
}

/** 扫描一个根目录下的所有技能 */
function scanRoot(root: string, source: 'builtin' | 'user'): SkillMeta[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const meta = readSkill(full, source);
    if (meta) out.push(meta);
  }
  return out;
}

/** 列出全部技能（内置 + 用户），用户技能同名时覆盖内置 */
export function listSkills(): SkillMeta[] {
  const builtin = scanRoot(builtinSkillsRoot(), 'builtin');
  const user = scanRoot(userSkillsRoot(), 'user');

  const byDir = new Map<string, SkillMeta>();
  for (const s of builtin) byDir.set(s.dirName, s);
  // 用户的覆盖内置的
  for (const s of user) byDir.set(s.dirName, s);

  return [...byDir.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

// ─────────────────────────────────────────────────────────────
// 操作
// ─────────────────────────────────────────────────────────────

export function toggleSkill(dirName: string, enabled: boolean): SkillMeta[] {
  setSkillDisabled(dirName, !enabled);
  return listSkills();
}

/** 读取 SKILL.md 全文（界面预览用） */
export function readSkillDoc(dirName: string): string {
  const skill = listSkills().find((s) => s.dirName === dirName);
  if (!skill) throw new Error(`技能 ${dirName} 不存在`);
  return readFileSync(join(skill.path, 'SKILL.md'), 'utf8');
}

/**
 * 导入用户技能。
 *
 * 只接受**目录**：技能必须带 SKILL.md，否则导入了也不会被识别，
 * 与其让用户困惑不如当场拒绝。
 */
export function importSkill(srcDir: string): SkillMeta[] {
  if (!existsSync(join(srcDir, 'SKILL.md'))) {
    throw new Error('所选目录不含 SKILL.md，不是合法的技能目录');
  }
  const name = basename(srcDir);
  const dest = join(userSkillsRoot(), name);

  if (existsSync(dest)) {
    // 覆盖前先删干净，避免旧文件残留造成"混合技能"
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(srcDir, dest, { recursive: true });
  return listSkills();
}

/**
 * 删除技能（原版 `deleteConfirm` 语义：只删用户技能目录下的这个文件夹）。
 *
 * 内置技能随包分发，删了会在重新扫描时又出现，所以直接拒绝并给明确原因。
 */
export function deleteSkill(dirName: string): SkillMeta[] {
  const skill = listSkills().find((s) => s.dirName === dirName);
  if (!skill) throw new Error(`技能 ${dirName} 不存在`);
  if (skill.source === 'builtin') throw new Error('内置技能不可删除');

  // 只允许删用户技能根目录的直接子目录，避免 dirName 里带路径分隔符时越界
  if (dirName.includes('/') || dirName.includes('\\') || dirName === '..' || dirName === '.') {
    throw new Error(`非法的技能目录名：${dirName}`);
  }
  const dest = join(userSkillsRoot(), dirName);
  if (!existsSync(dest)) throw new Error(`技能目录不存在：${dest}`);

  rmSync(dest, { recursive: true, force: true });
  return listSkills();
}
