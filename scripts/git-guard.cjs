#!/usr/bin/env node
/*
 * Local-only Git checkpoint helper.
 *
 * The helper deliberately works on the index only when creating a commit. It
 * never stages files, pushes a remote, or rewrites history. This makes it safe
 * to use in a workspace where several agents may leave temporary files beside
 * the source tree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  cwd: process.cwd(),
}).trim();

const MASTER_DOC = 'plans/00-协作主文档-所有AI从这里开始.md';
const BUSINESS_PATH = /^(?:src|server|docs|scripts)\//u;
const GENERATED_PATH = /^(?:dist|dist-[^/]+|out|release|build|\.playwright-cli)(?:\/|$)|^scripts\/\..+\.(?:json|log)$/u;
const BINARY_ARTIFACT = /(?:^|\/)[^/]+\.(?:exe|asar|zip|7z)$/iu;
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\..*)?|.*(?:secret|credential|password|token|private[-_]?key).*)$/iu;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----|\b(?:MM_SERVER_PASS|SSH_PASSWORD|SMTP_PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY|SECRET_KEY)\s*[:=]\s*["']?[^\s"'`]{12,}|\b(?:sk|pk)-[A-Za-z0-9_-]{20,})/iu;
const CONVENTIONAL_COMMIT = /^(?:feat|fix|docs|refactor|test|build|chore|perf|ci|revert)(?:\([^\r\n()]+\))?!?:\s+\S.{7,}$/u;

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function gitStatus() {
  return runGit(['status', '--porcelain=v1']).split(/\r?\n/u).filter(Boolean);
}

function stagedPaths() {
  return runGit(['diff', '--cached', '--name-only', '-z'])
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stagedAddedPaths() {
  return runGit(['diff', '--cached', '--diff-filter=A', '--name-only', '-z'])
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stagedDiff() {
  return runGit(['diff', '--cached', '--no-ext-diff', '--unified=0']);
}

function printHeader(title) {
  console.log(`\n[git] ${title}`);
}

function workingTreeReport() {
  const lines = gitStatus();
  const tracked = lines.filter((line) => !line.startsWith('?? '));
  const untracked = lines.filter((line) => line.startsWith('?? '));
  const staged = lines.filter((line) => /^[MADRCU!?][MADRCU ]/u.test(line));

  console.log(`仓库: ${ROOT}`);
  console.log(`分支: ${runGit(['branch', '--show-current']).trim() || '(detached HEAD)'}`);
  console.log(`状态: ${lines.length ? `${lines.length} 项待处理` : '工作区干净'}`);
  if (staged.length) console.log(`已暂存: ${staged.length} 项`);
  if (tracked.length - staged.length > 0) console.log(`未暂存/冲突: ${tracked.length - staged.length} 项`);
  if (untracked.length) console.log(`未跟踪: ${untracked.length} 项（不会被自动加入提交）`);
  return { lines, tracked, untracked, staged };
}

function findRepositoryProblems() {
  const gitDir = runGit(['rev-parse', '--git-dir']).trim();
  const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(ROOT, gitDir);
  const conflictMarkers = [
    ['MERGE_HEAD', path.join(absoluteGitDir, 'MERGE_HEAD')],
    ['CHERRY_PICK_HEAD', path.join(absoluteGitDir, 'CHERRY_PICK_HEAD')],
    ['REVERT_HEAD', path.join(absoluteGitDir, 'REVERT_HEAD')],
    ['rebase-merge', path.join(absoluteGitDir, 'rebase-merge')],
    ['rebase-apply', path.join(absoluteGitDir, 'rebase-apply')],
  ];
  return conflictMarkers.filter(([, marker]) => fs.existsSync(marker)).map(([name]) => name);
}

function inspectStagedFiles(paths, { allowGenerated = false } = {}) {
  const problems = [];
  const warnings = [];
  const added = new Set(stagedAddedPaths());

  for (const file of paths) {
    const normalized = file.replaceAll('\\', '/');
    if (SENSITIVE_PATH.test(normalized)) {
      problems.push(`疑似敏感文件：${normalized}`);
    }
    if (!allowGenerated && (GENERATED_PATH.test(normalized) || BINARY_ARTIFACT.test(normalized))) {
      problems.push(`疑似运行产物：${normalized}（请移出暂存区；确需发布时使用 --allow-generated）`);
    }
    if (added.has(file) && /\.(?:png|jpe?g|gif|webp|exe|zip|7z)$/iu.test(normalized) && !normalized.startsWith('docs/assets/')) {
      warnings.push(`新增二进制文件：${normalized}（确认它是发布必需资源）`);
    }
  }

  const diff = stagedDiff();
  if (SECRET_VALUE.test(diff)) {
    problems.push('暂存差异中疑似包含密钥/密码/私钥，请改用环境变量或本地密钥文件');
  }
  return { problems, warnings };
}

function check({ strict = false, allowGenerated = false } = {}) {
  printHeader('提交前检查');
  const report = workingTreeReport();
  const problems = [];
  const warnings = [];

  const conflicts = findRepositoryProblems();
  if (conflicts.length) problems.push(`仓库存在未完成操作：${conflicts.join(', ')}`);

  const staged = stagedPaths();
  if (staged.length) {
    const inspected = inspectStagedFiles(staged, { allowGenerated });
    problems.push(...inspected.problems);
    warnings.push(...inspected.warnings);
  }

  const businessStaged = staged.some((file) => BUSINESS_PATH.test(file) || /^(?:package\.json|electron-builder\.yml)$/u.test(file));
  if (businessStaged && !staged.includes(MASTER_DOC)) {
    const message = `业务代码已暂存，但协作主文档未暂存：${MASTER_DOC}`;
    if (strict) problems.push(message);
    else warnings.push(`${message}（建议同步追加改动日志）`);
  }

  if (warnings.length) {
    console.log('\n提醒:');
    warnings.forEach((item) => console.log(`  - ${item}`));
  }
  if (problems.length) {
    console.error('\n阻止提交:');
    problems.forEach((item) => console.error(`  - ${item}`));
    return false;
  }
  console.log('\n检查通过：未发现会阻止本地提交的问题。');
  return true;
}

function verify() {
  printHeader('提交后验证');
  const report = workingTreeReport();
  const trackedChanges = report.tracked;
  if (trackedChanges.length) {
    console.error('验证失败：仍有已跟踪文件未提交。先检查 diff，再创建下一次本地提交。');
    return false;
  }
  const head = runGit(['log', '-1', '--format=%H%n%s']).trim().split(/\r?\n/u);
  console.log(`最近提交: ${head[0] || '(无)'} ${head.slice(1).join(' ')}`);
  console.log('验证通过：已跟踪工作区干净；未跟踪文件仍保持原状，不会被删除。');
  return true;
}

function checkpoint(message, { strict = true, allowGenerated = false } = {}) {
  if (!message || !CONVENTIONAL_COMMIT.test(message)) {
    console.error('提交信息格式应为：type: 简短说明，例如 `fix: 修复反馈审核状态`。');
    return false;
  }
  if (!check({ strict, allowGenerated })) return false;
  const staged = stagedPaths();
  if (!staged.length) {
    console.error('没有已暂存文件。此命令不会自动 git add，请先精确暂存本次改动。');
    return false;
  }

  console.log(`\n创建本地提交：${message}`);
  const result = spawnSync('git', ['commit', '-m', message], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return false;
  console.log('本地提交完成。脚本不会执行 push。');
  return true;
}

function usage() {
  console.log(`用法：
  node scripts/git-guard.cjs check [--strict] [--allow-generated]
  node scripts/git-guard.cjs checkpoint "feat: 简短说明" [--allow-generated]
  node scripts/git-guard.cjs verify

说明：
  check       只读检查工作区、暂存区、冲突状态和疑似密钥。
  checkpoint  只提交已经暂存的文件；不会自动 add、push 或删除未跟踪文件。
  verify      确认最近一次提交后已跟踪工作区干净。
`);
}

function main() {
  const [, , command, ...rawArgs] = process.argv;
  const strict = rawArgs.includes('--strict');
  const allowGenerated = rawArgs.includes('--allow-generated');
  const args = rawArgs.filter((arg) => !arg.startsWith('--'));

  let ok = false;
  if (command === 'check') ok = check({ strict, allowGenerated });
  else if (command === 'verify') ok = verify();
  else if (command === 'checkpoint') ok = checkpoint(args.join(' ').trim(), { strict: true, allowGenerated });
  else {
    usage();
    ok = command == null;
  }
  process.exitCode = ok ? 0 : 1;
}

main();
