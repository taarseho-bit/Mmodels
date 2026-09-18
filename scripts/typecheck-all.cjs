/**
 * 三套 tsconfig 逐个跑类型检查，结果写文件。
 * 为什么写文件：本机 PowerShell 工具会吞掉子进程 stdout，直接读输出不可靠。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = 'D:\\mathmodel-desktop';
const NODE = 'C:\\Users\\xh\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\node.exe';
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const configs = ['tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.tools.json'];

const lines = [];
for (const cfg of configs) {
  const p = path.join(ROOT, cfg);
  if (!fs.existsSync(p)) {
    lines.push(`=== ${cfg}  SKIP(不存在) ===`);
    continue;
  }
  let out = '';
  let code = 0;
  try {
    out = execFileSync(NODE, [TSC, '--noEmit', '-p', p], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    code = e.status ?? 1;
  }
  const errs = out.split(/\r?\n/).filter((l) => /error TS/.test(l));
  lines.push(`=== ${cfg}  exitCode=${code}  错误数=${errs.length} ===`);
  errs.slice(0, 30).forEach((l) => lines.push('  ' + l));
  if (errs.length > 30) lines.push(`  ...（还有 ${errs.length - 30} 条）`);
}

const outFile = path.join(ROOT, 'out', 'typecheck-result.txt');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('WROTE ' + outFile);
