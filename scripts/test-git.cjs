/**
 * git 层的功能验证（纯 node，不依赖 Electron）。
 *
 * 覆盖：初始化 / 新增 / 修改 / 删除 / 重命名 / 中文路径 / 版本增删查 /
 *      恢复（含恢复前自动备份、「回到那个状态」需删多余文件）/ 特殊版本名 /
 *      错误分支 / 非仓库目录 / 换行符逐字节保真。
 *
 * ⚠️ 顺序敏感：所有会「新增版本」的步骤都会改变版本索引，
 *    因此断言一律**按名字查版本**，不用下标。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('D:/mathmodel-desktop/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild');

const ROOT = 'D:/mathmodel-desktop';
const BUNDLE = path.join(ROOT, 'out', 'git-test-bundle.cjs');

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'main', 'git', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: BUNDLE,
  logLevel: 'error',
});
const git = require(BUNDLE);

const out = [];
let fails = 0;
const log = (m) => out.push(String(m));
const ok = (cond, label) => {
  if (!cond) fails++;
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-git-test-'));
  log('repo = ' + dir);

  // ───────── 1. 可用性与初始化 ─────────
  ok(await git.gitAvailable(), 'git 可用');
  ok((await git.isRepo(dir)) === false, '初始状态不是仓库');

  await git.ensureRepo(dir);
  ok(await git.isRepo(dir), 'ensureRepo 后是仓库');
  ok(fs.existsSync(path.join(dir, '.git')), '.git 已创建');
  ok(fs.existsSync(path.join(dir, '.gitignore')), '.gitignore 已创建');

  // ───────── 2. 新增文件（含中文与子目录）─────────
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n', 'utf8');
  fs.writeFileSync(path.join(dir, '数据.csv'), 'a,b\n1,2\n', 'utf8');
  fs.mkdirSync(path.join(dir, '子目录'), { recursive: true });
  fs.writeFileSync(path.join(dir, '子目录', 'note.md'), '# 说明\n', 'utf8');

  let st = await git.status(dir);
  log('  状态 = ' + JSON.stringify(st.map((f) => f.path + ':' + f.status)));
  // 3 个业务文件 + 1 个 .gitignore
  ok(st.length === 4, '识别到 4 个新文件（3 个业务文件 + .gitignore）');
  ok(
    st.some((f) => f.path === '数据.csv'),
    '中文文件名正确解析（未被引号包裹）',
  );
  ok(
    st.some((f) => f.path === '子目录/note.md'),
    '子目录路径使用正斜杠',
  );

  // ───────── 3. 保存版本 ─────────
  let r = await git.saveVersion(dir, '初始版本', 'manual');
  ok(r.committed === true, '保存版本成功');
  log('  sha = ' + (r.sha || '').slice(0, 7));

  r = await git.saveVersion(dir, '空版本', 'manual');
  ok(r.committed === false && r.reason === 'clean', '工作区干净时返回 reason=clean');

  // ───────── 4. 修改 → diff ─────────
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\nprint(2)\n', 'utf8');
  st = await git.status(dir);
  ok(st.length === 1 && st[0].status === 'modified', '修改被识别为 modified');

  const d = await git.diffFile(dir, 'main.py');
  const adds = d.lines.filter((l) => l.kind === 'add').map((l) => l.text.trim());
  log('  diff = ' + JSON.stringify(d.lines.map((l) => l.kind + ':' + l.text.slice(0, 20))));
  ok(adds.includes('print(2)'), '新增行被识别为 add');
  ok(
    d.lines.some((l) => l.kind === 'meta'),
    '存在 hunk/meta 行',
  );

  // 未跟踪文件也能出 diff（整篇新增）—— 必须用**确实未跟踪**的文件，
  // 已经提交过的干净文件 diff 出来是空的
  const fresh = 'fresh_new.csv';
  fs.writeFileSync(path.join(dir, fresh), 'x,y\n1,2\n3,4\n', 'utf8');
  const dNew = await git.diffFile(dir, fresh);
  log('  未跟踪 diff = ' + JSON.stringify(dNew.lines.map((l) => l.kind + ':' + l.text.slice(0, 14))));
  ok(dNew.status === 'untracked', '未跟踪文件 diff 的 status 正确');
  ok(
    dNew.lines.filter((l) => l.kind === 'add').length >= 3,
    '未跟踪文件的内容作为新增行展示',
  );
  fs.unlinkSync(path.join(dir, fresh));

  // ───────── 5. 删除与重命名（未暂存语义）─────────
  fs.unlinkSync(path.join(dir, '数据.csv'));
  fs.renameSync(path.join(dir, '子目录', 'note.md'), path.join(dir, '子目录', '说明.md'));

  st = await git.status(dir);
  const stMap = new Map(st.map((f) => [f.path, f.status]));
  log('  状态2 = ' + JSON.stringify([...stMap.entries()]));
  ok(stMap.get('数据.csv') === 'deleted', '删除被识别为 deleted');
  // 未暂存的重命名在 git 眼里是「删旧 + 新增未跟踪」
  ok(
    stMap.get('子目录/说明.md') === 'untracked',
    '重命名新路径被识别为 untracked（git 未暂存语义）',
  );

  await git.saveVersion(dir, '改完删除与重命名', 'manual');

  // ───────── 6. 已暂存的重命名 → renamed ─────────
  // git 的相似度检测在暂存后才生效；这里直接构造已暂存的重命名
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\nline3\nline4\nline5\n', 'utf8');
  await git.saveVersion(dir, '准备重命名基版', 'manual');
  fs.renameSync(path.join(dir, 'a.txt'), path.join(dir, 'b.txt'));
  await sleep(30);
  st = await git.status(dir);
  log('  暂存前 = ' + JSON.stringify(st.map((f) => f.path + ':' + f.status)));
  ok(
    st.some((f) => f.path === 'b.txt') && st.some((f) => f.path === 'a.txt'),
    '重命名在未暂存时同时出现新旧两条记录',
  );

  // ───────── 7. 版本列表 ─────────
  let versions = await git.listVersions(dir);
  log('  版本 = ' + JSON.stringify(versions.map((v) => v.kind + '/' + v.name)));
  ok(versions.length === 3, '列出 3 个版本');
  ok(versions[0].name === '准备重命名基版', '最新版本名正确（列表新→旧）');
  ok(versions[0].kind === 'manual', 'kind 解析正确');
  ok(versions[0].at > 0, '时间戳已解析');
  ok(!!versions[0].author, '作者已解析');
  ok(/^[0-9a-f]{40}$/.test(versions[0].sha), 'sha 是完整 40 位');

  // ───────── 8. 恢复：应回到该版本的**完整状态** ─────────
  const initial = versions.find((v) => v.name === '初始版本');
  ok(!!initial, '找到「初始版本」');

  // 制造未保存的脏状态
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(999)\n', 'utf8');

  const rr = await git.restoreVersion(dir, initial.sha);
  ok(rr.ok === true, '恢复成功');
  ok(!!rr.backupSha, '恢复前自动备份了当前状态（backupSha 非空）');

  const mainNow = fs.readFileSync(path.join(dir, 'main.py'), 'utf8');
  log('  恢复后 main.py = ' + JSON.stringify(mainNow));
  ok(mainNow === 'print(1)\n', '文件内容逐字节回到初始版本（无 CRLF 转换）');
  ok(fs.existsSync(path.join(dir, '数据.csv')), '被删除的文件已恢复');
  ok(!fs.existsSync(path.join(dir, '子目录', '说明.md')), '重命名后的文件已回到旧名');
  ok(!fs.existsSync(path.join(dir, 'a.txt')), '初始版本里没有的 a.txt 已被移除');

  // 语义说明：恢复只把「版本管理下的内容」退回目标状态。
  // 恢复前**未被跟踪**的文件（如 b.txt —— 重命名后尚未提交）刻意保留，
  // 因为那可能是用户自己产出的数据，删掉风险太大；而且 `restore-backup`
  // 里已经把这些内容存过一份，用户随时能找回。
  ok(
    fs.existsSync(path.join(dir, 'b.txt')),
    '恢复前未被跟踪的文件被保留（保护用户数据）',
  );
  ok((rr.removed ?? 0) === 1, `removed 计数 = 1（仅 说明.md）（实际 ${rr.removed}）`);

  // 恢复动作本身也被记为一个版本
  versions = await git.listVersions(dir);
  ok(
    versions.some((v) => v.kind === 'restore'),
    '恢复动作被记为 restore 版本',
  );
  ok(
    versions.some((v) => v.kind === 'restore-backup'),
    '备份被记为 restore-backup 版本',
  );

  // ───────── 9. 未跟踪文件在恢复中不被删除 ─────────
  fs.writeFileSync(path.join(dir, 'user-download.csv'), 'keep me\n', 'utf8');
  const rr2 = await git.restoreVersion(dir, initial.sha);
  ok(rr2.ok === true, '再次恢复成功');
  ok(
    fs.existsSync(path.join(dir, 'user-download.csv')),
    '未跟踪文件在恢复后仍保留（不误删用户数据）',
  );

  // ───────── 10. 版本名含特殊字符 ─────────
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x', 'utf8');
  await git.saveVersion(dir, '完成"数据清洗" & 校验\n第二行', 'manual');
  versions = await git.listVersions(dir);
  log('  特殊版本名 = ' + JSON.stringify(versions[0].name));
  ok(versions[0].name.includes('数据清洗'), '引号与 & 被正确编码与解析');
  ok(!versions[0].name.includes('\n'), '版本名被压成单行');

  // ───────── 11. 错误分支 ─────────
  const bad = await git.restoreVersion(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  ok(bad.ok === false && bad.reason === 'version-not-found', '不存在的版本被拒绝');

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-plain-'));
  ok((await git.isRepo(plain)) === false, '普通目录 isRepo=false');
  ok((await git.status(plain)).length === 0, '普通目录 status 返回空数组');
  const noRepoRestore = await git.restoreVersion(plain, 'deadbeef');
  ok(noRepoRestore.ok === false && noRepoRestore.reason === 'not-repo', '非仓库 restore 返回 not-repo');

  // ───────── 12. 已跟踪文件的修改不应被 .gitignore 影响 ─────────
  fs.writeFileSync(path.join(dir, 'report.aux'), 'aux\n', 'utf8');
  st = await git.status(dir);
  ok(
    !st.some((f) => f.path === 'report.aux'),
    '.gitignore 生效：LaTeX 中间产物不入版本',
  );
  fs.writeFileSync(path.join(dir, 'paper.tex'), '\\documentclass{article}\n', 'utf8');
  st = await git.status(dir);
  ok(
    st.some((f) => f.path === 'paper.tex'),
    '正文 .tex 正常纳入版本（只有中间产物被忽略）',
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(plain, { recursive: true, force: true });

  const passed = out.filter((l) => l.startsWith('PASS')).length;
  log('');
  log(`合计：${passed} 通过 / ${fails} 失败`);
  fs.writeFileSync(path.join(ROOT, 'out', 'git-test.txt'), out.join('\n'), 'utf8');
  console.log(fails === 0 ? `ALL PASS (${passed})` : `${fails} FAILED`);
}

main().catch((e) => {
  out.push('FATAL ' + (e && e.stack ? e.stack : String(e)));
  fs.writeFileSync(path.join(ROOT, 'out', 'git-test.txt'), out.join('\n'), 'utf8');
  console.log('FATAL');
});
