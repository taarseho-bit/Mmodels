/**
 * Git 操作层 —— 项目版本历史与代码变更。
 *
 * 设计要点：
 *  1. **只用 `execFile` + 参数数组**，不拼命令行字符串 —— 避免路径/消息里的
 *     空格与引号被 shell 解析（Windows 上尤其容易出错）
 *  2. **版本用 commit 承载**：commit message 带结构化前缀
 *     `[mm-version] kind=manual name=<名称>`，列表时再解析回来
 *  3. **恢复前先备份当前状态**（`kind=restore-backup`），否则用户一点恢复就
 *     把自己的改动弄丢了 —— 原版明确要求「恢复前会先保存当前状态」
 *  4. 所有函数对「不是 git 仓库」都要给出**可读结论**，而不是抛原始错误
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 版本 commit 的标识前缀 */
const MARK = '[mm-version]';

export type VersionKind = 'manual' | 'auto' | 'restore' | 'restore-backup';

export interface VersionRecord {
  /** commit sha */
  sha: string;
  /** 版本名称（用户填的，或自动生成） */
  name: string;
  kind: VersionKind;
  /** 毫秒时间戳 */
  at: number;
  /** 作者名 */
  author: string;
}

export interface ChangedFile {
  /** 相对项目根的路径 */
  path: string;
  /** git 状态码：M/A/D/R/? */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  /** 老路径（重命名时） */
  from?: string;
}

export interface DiffHunkLine {
  kind: 'add' | 'del' | 'ctx' | 'meta';
  text: string;
}

export interface FileDiff {
  path: string;
  status: ChangedFile['status'];
  lines: DiffHunkLine[];
  /** 差异过大被截断 */
  truncated?: boolean;
}

/** 单次 git 调用的结果 */
interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

const MAX_BUFFER = 24 * 1024 * 1024;

function run(cwd: string, args: string[], timeoutMs = 30000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number }) | null;
        resolve({
          ok: !err,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: typeof e?.code === 'number' ? e.code : err ? 1 : 0,
        });
      },
    );
  });
}

/** 该目录是否是 git 仓库（向上查找也认，交给 git 自己判断） */
export async function isRepo(cwd: string): Promise<boolean> {
  if (!existsSync(cwd)) return false;
  const r = await run(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/** git 是否可用 */
export async function gitAvailable(): Promise<boolean> {
  const r = await run(process.cwd(), ['--version']);
  return r.ok;
}

/** 首次使用时初始化仓库 */
export async function ensureRepo(cwd: string): Promise<{ created: boolean }> {
  if (await isRepo(cwd)) return { created: false };
  await run(cwd, ['init']);
  // 不设 user.name/email 的话 commit 会失败（尤其在没有全局配置的机器上）
  await run(cwd, ['config', 'user.name', 'MModels']);
  await run(cwd, ['config', 'user.email', 'agent@mmodels.local']);
  // 中文路径不要加引号，否则解析要处理转义
  await run(cwd, ['config', 'core.quotepath', 'false']);
  // ⚠️ 关键：关掉换行符转换。
  //    默认 autocrlf 会在 checkout 时把 LF 变 CRLF，
  //    导致「恢复到某版本」后文件字节与当时不一致 —— 对 .tex/.py 是不可接受的。
  await run(cwd, ['config', 'core.autocrlf', 'false']);

  const gi = join(cwd, '.gitignore');
  if (!existsSync(gi)) {
    writeFileSync(gi, GITIGNORE, 'utf8');
  }
  return { created: true };
}

/**
 * 仓库默认忽略项。
 * 刻意**不忽略** agent 的产物（论文、代码、图表、数据）—— 那些正是要版本化的东西。
 * 只忽略构建缓存与 LaTeX 中间文件。
 */
const GITIGNORE = `# MModels 自动生成
node_modules/
__pycache__/
.venv/
venv/
.ipynb_checkpoints/
.DS_Store
Thumbs.db

# LaTeX 中间产物
*.aux
*.log
*.out
*.toc
*.lof
*.lot
*.bbl
*.blg
*.fls
*.fdb_latexmk
*.synctex.gz
*.nav
*.snm
*.vrb

# 编辑器
.vscode/
.idea/
`;

// ─────────────────────────────────────────────────────────────
// 变更
// ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, ChangedFile['status']> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
  '?': 'untracked',
  T: 'modified',
};

export async function status(cwd: string): Promise<ChangedFile[]> {
  if (!(await isRepo(cwd))) return [];
  // -z：用 NUL 分隔，避免文件名里的空格/换行破坏解析
  const r = await run(cwd, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (!r.ok) return [];

  const out: ChangedFile[] = [];
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    let path = rec.slice(3);
    const st = STATUS_MAP[xy[1]] ?? STATUS_MAP[xy[0]] ?? 'modified';

    // 重命名会有两条记录（新路径 + 老路径）
    let from: string | undefined;
    if (xy[0] === 'R' || xy[1] === 'R') {
      const next = parts[i + 1];
      if (next) {
        from = next;
        i++;
      }
    }
    // git 对含非 ASCII 的路径可能加引号
    path = unquote(path);
    if (from) from = unquote(from);
    out.push({ path, status: st, from });
  }
  return out;
}

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** 单文件差异。未跟踪文件用 `--no-index` 与 /dev/null 对比。 */
export async function diffFile(cwd: string, path: string, maxLines = 4000): Promise<FileDiff> {
  const st = (await status(cwd)).find((f) => f.path === path);
  const kind = st?.status ?? 'modified';

  if (kind === 'untracked') {
    // 新文件：整个文件都是新增
    const r = await run(cwd, ['diff', '--no-index', '--no-color', '--', '/dev/null', path]);
    const lines = parseUnified(r.stdout, maxLines);
    return { path, status: kind, lines: lines.lines, truncated: lines.truncated };
  }

  const r = await run(cwd, ['diff', '--no-color', '-U3', '--', path]);
  const lines = parseUnified(r.stdout, maxLines);
  return { path, status: kind, lines: lines.lines, truncated: lines.truncated };
}

/** 把 unified diff 正文解析成带颜色语义的行 */
function parseUnified(text: string, maxLines: number): { lines: DiffHunkLine[]; truncated: boolean } {
  const out: DiffHunkLine[] = [];
  let truncated = false;
  for (const raw of text.split(/\r?\n/)) {
    if (out.length >= maxLines) {
      truncated = true;
      break;
    }
    if (!raw) continue;
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('diff ') || raw.startsWith('index ')) {
      out.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('@@')) {
      out.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('+')) out.push({ kind: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) out.push({ kind: 'del', text: raw.slice(1) });
    else out.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return { lines: out, truncated };
}

// ─────────────────────────────────────────────────────────────
// 版本
// ─────────────────────────────────────────────────────────────

/** 把版本元数据编码进 commit message */
function encode(kind: VersionKind, name: string): string {
  // 名称里可能有换行，压成单行
  const safe = name.replace(/[\r\n]+/g, ' ').trim() || '未命名版本';
  return `${MARK} kind=${kind} name=${safe}`;
}

/** 解析 commit message */
function decode(subject: string): { kind: VersionKind; name: string } | null {
  if (!subject.startsWith(MARK)) return null;
  const km = /kind=(\S+)/.exec(subject);
  const nm = /name=(.*)$/.exec(subject);
  const kind = (km?.[1] ?? 'manual') as VersionKind;
  return { kind, name: (nm?.[1] ?? '未命名版本').trim() };
}

/** 列出全部版本（新→旧）。非版本 commit 不算。 */
export async function listVersions(cwd: string): Promise<VersionRecord[]> {
  if (!(await isRepo(cwd))) return [];
  // %x1f = 单元分隔符，避免作者名里含空格干扰
  const r = await run(cwd, [
    'log',
    '--grep=' + MARK,
    '--fixed-strings',
    '--pretty=format:%H%x1f%ct%x1f%an%x1f%s',
    '--max-count=200',
  ]);
  if (!r.ok) return [];

  const out: VersionRecord[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const [sha, ct, author, subject] = line.split('\x1f');
    if (!sha || !subject) continue;
    const d = decode(subject);
    if (!d) continue;
    out.push({ sha, name: d.name, kind: d.kind, at: Number(ct) * 1000, author: author ?? '' });
  }
  return out;
}

/** 提交一个版本。工作区干净时返回 committed:false。 */
export async function saveVersion(
  cwd: string,
  name: string,
  kind: VersionKind = 'manual',
): Promise<{ committed: boolean; sha?: string; reason?: string }> {
  await ensureRepo(cwd);

  const st = await status(cwd);
  if (st.length === 0) {
    return { committed: false, reason: 'clean' };
  }

  await run(cwd, ['add', '-A']);
  const r = await run(cwd, ['commit', '-m', encode(kind, name), '--no-verify']);
  if (!r.ok) {
    return { committed: false, reason: r.stderr || r.stdout || 'commit failed' };
  }
  const shaR = await run(cwd, ['rev-parse', 'HEAD']);
  return { committed: true, sha: shaR.stdout.trim() };
}

/**
 * 恢复到某个版本。
 *
 * ⚠️ 三个必须做对的点：
 *
 *  1. **先备份当前状态**（`restore-backup`），否则用户一点恢复就丢失自己的改动。
 *
 *  2. **「回到那个状态」需要删掉后来才新增的文件** ——
 *     `git checkout <sha> -- .` 只还原目标版本里存在的文件，不会删除多余的。
 *
 *  3. ⚠️ **要删的文件清单必须在备份之前取**。
 *     备份走的是 `git add -A`，它会把**未跟踪文件也纳入索引**；
 *     如果备份后再取「当前被跟踪文件」，用户那些从未版本化的文件
 *     （自己下载的数据、临时笔记）就会被当成「目标版本没有」而**误删**。
 *     所以这里先快照 `ls-files`，备份后只删「当时就被跟踪」的那些。
 */
export async function restoreVersion(
  cwd: string,
  sha: string,
): Promise<{ ok: boolean; backupSha?: string; removed?: number; reason?: string }> {
  if (!(await isRepo(cwd))) return { ok: false, reason: 'not-repo' };

  // 校验目标 commit 存在
  const check = await run(cwd, ['cat-file', '-e', sha + '^{commit}']);
  if (!check.ok) return { ok: false, reason: 'version-not-found' };

  // ① 备份**之前**先记录「已纳入版本管理」的文件
  const trackedBefore = await trackedFiles(cwd);

  // ② 备份当前状态
  let backupSha: string | undefined;
  const st = await status(cwd);
  if (st.length > 0) {
    const b = await saveVersion(cwd, '恢复前自动保存', 'restore-backup');
    backupSha = b.sha;
  }

  // ③ 目标版本的文件清单
  const targetR = await run(cwd, ['ls-tree', '-r', '--name-only', sha]);
  const targetFiles = new Set(targetR.stdout.split(/\r?\n/).filter(Boolean));

  // ④ 还原目标版本的文件
  const co = await run(cwd, ['checkout', sha, '--', '.']);
  if (!co.ok) return { ok: false, reason: co.stderr || 'checkout failed' };

  // ⑤ 删掉「恢复前已被跟踪、但目标版本里没有」的文件。
  //    用 trackedBefore 而不是当前索引 —— 见上面第 3 条。
  let removed = 0;
  for (const f of trackedBefore) {
    if (targetFiles.has(f)) continue;
    const abs = join(cwd, f);
    try {
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        removed++;
      }
    } catch {
      /* 单个文件删不掉不阻断整体恢复 */
    }
  }
  if (removed > 0) pruneEmptyDirs(cwd);

  // ⑥ 把恢复动作本身也记一笔，便于回看
  await saveVersion(cwd, '恢复完成', 'restore');
  return { ok: true, backupSha, removed };
}

/** 当前被 git 跟踪的文件（相对路径，正斜杠） */
async function trackedFiles(cwd: string): Promise<string[]> {
  const r = await run(cwd, ['ls-files']);
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map(unquote);
}

/** 递归删除空目录（不碰 .git） */
function pruneEmptyDirs(cwd: string): void {
  const walk = (dir: string): boolean => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const e of entries) {
      if (e.name === '.git') {
        empty = false;
        continue;
      }
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (walk(p)) {
          try {
            rmdirSync(p);
          } catch {
            /* 非空或被占用，忽略 */
          }
        } else empty = false;
      } else {
        empty = false;
      }
    }
    return empty;
  };
  walk(cwd);
}
