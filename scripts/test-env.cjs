/**
 * 环境检查功能验证（纯 node，不依赖 Electron）。
 * 这台的检测结果本身就是有意义的事实数据 —— 顺便看看工具链缺什么。
 */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('D:/mathmodel-desktop/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild');

const ROOT = 'D:/mathmodel-desktop';
const BUNDLE = path.join(ROOT, 'out', 'env-test-bundle.cjs');

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'main', 'scan', 'environment.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: BUNDLE,
  logLevel: 'error',
});

const env = require(BUNDLE);
const out = [];
let fails = 0;
const log = (m) => out.push(String(m));
const ok = (cond, label) => {
  if (!cond) fails++;
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

async function main() {
  const t0 = Date.now();
  const r = await env.checkEnvironment(ROOT);

  log('平台 = ' + r.platform + '，耗时 = ' + r.elapsedMs + 'ms');
  log('');
  log('项目'.padEnd(20) + '级别'.padEnd(14) + '状态'.padEnd(10) + '详情');
  log('-'.repeat(78));
  for (const it of r.items) {
    log(
      it.name.padEnd(20) +
        (it.level === 'required' ? '必需' : '建议').padEnd(12) +
        (it.status === 'ok' ? '✓' : it.status === 'missing' ? '✗ 缺失' : '? 未知').padEnd(12) +
        (it.detail || ''),
    );
  }
  log('');

  // ── 结构与自洽性断言 ──
  ok(Array.isArray(r.items) && r.items.length > 0, '返回非空检测项');
  ok(
    r.items.every((i) => i.id && i.name && i.level && i.status && i.purpose),
    '每项都有 id/name/level/status/purpose',
  );
  ok(
    r.items.every((i) => ['ok', 'missing', 'unknown'].includes(i.status)),
    'status 取值合法',
  );
  ok(
    r.items.every((i) => ['required', 'recommended'].includes(i.level)),
    'level 取值合法',
  );
  ok(r.missingRequired === r.items.filter((i) => i.level === 'required' && i.status !== 'ok').length,
     'missingRequired 与明细一致');
  ok(r.missingRecommended === r.items.filter((i) => i.level === 'recommended' && i.status !== 'ok').length,
     'missingRecommended 与明细一致');
  ok(r.ok === (r.missingRequired === 0), 'ok 与 missingRequired 自洽');
  ok(r.elapsedMs > 0 && r.elapsedMs < 60000, `耗时合理（${r.elapsedMs}ms）`);

  // ── 关键项必须在（doctor 技能里的必需项）──
  const ids = new Set(r.items.map((i) => i.id));
  for (const need of ['python', 'git', 'xelatex', 'latexmk', 'bibtex', 'py:numpy', 'py:pandas', 'py:matplotlib']) {
    ok(ids.has(need), `包含必需检测项 ${need}`);
  }
  for (const rec of ['uv', 'drawio', 'pdftoimage', 'cjkfont']) {
    ok(ids.has(rec), `包含建议检测项 ${rec}`);
  }

  // ── 空项目根不应崩 ──
  const r2 = await env.checkEnvironment(undefined);
  ok(r2.items.length === r.items.length, '不传项目根也能完成检测（首次运行场景）');

  // ── 二次调用结果稳定（同一台机器上状态应一致）──
  const r3 = await env.checkEnvironment(ROOT);
  const same = r3.items.every((it, i) => it.id === r.items[i].id && it.status === r.items[i].status);
  ok(same, '重复检测结果稳定（无随机性）');

  log('');
  log(`合计：${out.filter((l) => l.startsWith('PASS')).length} 通过 / ${fails} 失败`);
  fs.writeFileSync(path.join(ROOT, 'out', 'env-test.txt'), out.join('\n'), 'utf8');
  console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
}

main().catch((e) => {
  out.push('FATAL ' + (e && e.stack ? e.stack : String(e)));
  fs.writeFileSync(path.join('D:/mathmodel-desktop', 'out', 'env-test.txt'), out.join('\n'), 'utf8');
  console.log('FATAL');
});
