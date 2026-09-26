/**
 * 技能插件物化器 —— 把技能摊成一份**完整的 Claude Code 插件目录**。
 *
 * 为什么必须物化：
 *   Claude Code 的斜杠命令（`/write-paper`、`/review-paper`…）**只由插件注册**
 *   （sdk.d.ts：*"Plugins provide custom commands, agents, skills, and hooks"*）。
 *   只把技能目录列在 systemPrompt 里，agent 侧根本不会注册命令，
 *   用户发出 `/write-paper …` 时会得到 `Unknown command`，等于该模式什么都没触发。
 *
 * 产物布局：
 *   <userData>/skills-plugin/
 *     .claude-plugin/plugin.json     ← {"name":"mathmodel","version":"1.0.0"}
 *     seeded-builtins.json           ← 内置技能的播种记录：目录名 → 内容摘要
 *     skills/<技能名>/SKILL.md …      ← 启用中的技能（SDK 只读这一层）
 *     skills-disabled/<技能名>/…      ← 被停用的技能：留在磁盘但不会被加载
 *
 * 踩过的坑（别重犯）：
 *   1. `plugins` 传 string[] → SDK 抛 `Unsupported plugin type: undefined`
 *      （只支持 `{ type: 'local', path }`，它会被翻译成 CLI 参数 `--plugin-dir`）。
 *   2. 传「只有 SKILL.md 的目录」→ 不报错，但命令**不注册**，
 *      因为 CLI 找不到 `.claude-plugin/plugin.json` 清单，不认它是插件。
 *
 * 播种策略（幂等，可反复执行）：
 *   - 内置技能：不存在就复制；物化副本仍是上次播种的原始内容（摘要 == 记录）且
 *     源目录变了就刷新；**物化副本被用户改过（摘要 != 记录）就一律不动**。
 *   - 用户技能：不参与播种记录，始终以用户技能目录为准（变了才重拷）。
 *   - 源目录里的技能被删掉后，物化目录里的残留副本会被清掉，避免"删了还能用"。
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { listSkills } from '../skills';

/** 插件清单。`name` 必须是合法插件名。 */
const PLUGIN_MANIFEST = { name: 'mathmodel', version: '1.0.0' } as const;

const SEEDED_FILE = 'seeded-builtins.json';

/** 插件根目录：<userData>/skills-plugin */
export function skillsPluginRoot(): string {
  return join(app.getPath('userData'), 'skills-plugin');
}

// ─────────────────────────────────────────────────────────────
// 内容摘要（播种比对用）
// ─────────────────────────────────────────────────────────────

/**
 * 目录内容摘要：按相对路径排序后，把 `路径\0文件内容摘要` 依次喂进 sha256。
 *
 * 这里只需要同一种算法前后一致，即可判断用户是否修改过物化副本。
 */
function hashDir(dir: string): string {
  const h = createHash('sha256');
  for (const rel of listRelativeFiles(dir)) {
    h.update(rel);
    h.update('\0');
    try {
      h.update(createHash('sha256').update(readFileSync(join(dir, rel))).digest());
    } catch {
      /* 读不到（权限/竞态）就当空文件参与，摘要仍稳定 */
    }
  }
  return h.digest('hex');
}

/** 递归列出目录内所有文件，返回 posix 风格的相对路径，已排序 */
function listRelativeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (cur: string): void => {
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

// ─────────────────────────────────────────────────────────────
// 读写清单与播种记录
// ─────────────────────────────────────────────────────────────

function writeIfChanged(file: string, content: string): boolean {
  try {
    if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
    writeFileSync(file, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function writeManifest(root: string): void {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeIfChanged(
    join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify(PLUGIN_MANIFEST, null, 2) + '\n',
  );
}

function readSeeded(root: string): Record<string, string> {
  const file = join(root, SEEDED_FILE);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    /* 记录损坏 → 当成"从没播种过"，下一轮会按源目录重建 */
  }
  return {};
}

function writeSeeded(root: string, seeded: Record<string, string>): void {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(seeded).sort()) sorted[key] = seeded[key];
  writeIfChanged(join(root, SEEDED_FILE), JSON.stringify(sorted, null, 2) + '\n');
}

// ─────────────────────────────────────────────────────────────
// 物化
// ─────────────────────────────────────────────────────────────

/** 删目录 + 复制（先删后拷，避免旧文件残留造成"混合技能"） */
function replaceDir(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

/** 技能当前应当待的目录：启用 → skills/，停用 → skills-disabled/ */
function targetFor(root: string, dirName: string, enabled: boolean): string {
  return join(root, enabled ? 'skills' : 'skills-disabled', dirName);
}

let cached: string | null = null;
let pending: Promise<string> | null = null;

/**
 * 启动预热：把物化提前做掉，别让它挂在「第一条消息」的延迟上。
 *
 * 注意这里并没有把活搬到别的线程 —— `setImmediate` 只是把这段同步 IO
 * 让到当前事件循环之后，好让 `bootstrap()` 先把窗口建起来（不 await 预热），
 * 用户看不到「点了发送却卡一下」。
 *
 * 会话侧 `await warmupSkillsPlugin()` 会等到同一个 promise：
 * 预热已跑完 → 立即返回缓存路径；还在跑 → 等它。
 * 预热失败不影响会话：这里清掉 pending，会话里会走同步兜底重试一次。
 */
export function warmupSkillsPlugin(): Promise<string> {
  if (pending) return pending;
  pending = new Promise<string>((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(materializeSkillsPlugin());
      } catch (err) {
        pending = null;
        reject(err);
      }
    });
  });
  return pending;
}

/**
 * 准备好 `<userData>/skills-plugin/` 并返回其绝对路径（同步）。
 *
 * 进程内只做一次（结果缓存）；反复调用安全，且不会重复堆积或覆盖用户改动。
 */
export function materializeSkillsPlugin(): string {
  if (cached && existsSync(cached)) return cached;

  const root = skillsPluginRoot();
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'skills-disabled'), { recursive: true });
  writeManifest(root);

  const seeded = readSeeded(root);
  const skills = listSkills();
  const live = new Set(skills.map((s) => s.dirName));

  for (const skill of skills) {
    const target = targetFor(root, skill.dirName, skill.enabled);
    const elsewhere = targetFor(root, skill.dirName, !skill.enabled);

    // 启用状态翻转：把副本搬过去，而不是删掉重拷 —— 用户改过的副本不会因此丢失
    if (existsSync(elsewhere)) {
      if (existsSync(target)) rmSync(elsewhere, { recursive: true, force: true });
      else renameSync(elsewhere, target);
    }

    if (skill.source === 'user') {
      // 用户技能：始终以用户目录为准，内容没变就不动
      if (!existsSync(target) || hashDir(target) !== hashDir(skill.path)) {
        replaceDir(skill.path, target);
      }
      continue;
    }

    // 内置技能：按播种记录决策
    const recorded = seeded[skill.dirName];
    const source = hashDir(skill.path);
    const exists = existsSync(target);

    // 快路径：源目录自上次播种后没变过 —— 副本无论是否被用户改过都不用动
    if (exists && recorded === source) continue;

    const installed = exists ? hashDir(target) : null;
    if (installed === null) {
      replaceDir(skill.path, target);
      seeded[skill.dirName] = source;
    } else if (installed !== recorded) {
      // 物化副本已不是我们播种时的内容 → 用户改过，尊重用户，不覆盖
      continue;
    } else {
      // 副本还是历史版本的原样，源已更新 → 刷新
      replaceDir(skill.path, target);
      seeded[skill.dirName] = source;
    }
  }

  // 清理残留：源目录里已经没有这个技能了（内置被移除 / 用户技能被删）
  for (const bucket of ['skills', 'skills-disabled']) {
    const dir = join(root, bucket);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (live.has(name)) continue;
      const full = join(dir, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      rmSync(full, { recursive: true, force: true });
    }
  }

  writeSeeded(root, seeded);
  cached = root;
  return root;
}

/** 丢掉进程内缓存（技能增删/启停后调用），强制下次重新物化 */
export function invalidateSkillsPluginCache(): void {
  cached = null;
  // pending 里可能是一个已完成的 promise —— 不清掉的话，下次会话会直接拿到
  // 它而不重新物化，用户的启停就白改了。
  pending = null;
}
