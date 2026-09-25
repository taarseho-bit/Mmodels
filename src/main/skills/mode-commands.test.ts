/**
 * 护栏：**模式选择器发出的斜杠命令，必须真的能被 SDK 注册。**
 *
 * ── 为什么需要这条（真实事故，用户实机截图确认）────────────────
 * 「找数据」模式发出去的命令是 `/data-search`（`Composer.tsx` 的 `MODE_COMMAND.data`），
 * 而对应的内置技能 `resources/builtin-skills/data-search/` 当时**带着
 * `.disabled-by-default`**，于是整条链路这样断掉：
 *
 *   `.disabled-by-default` 存在
 *     ⇒ `readSkill()` 算 `disabledByDefault = true`（`src/main/skills/index.ts:168`）
 *     ⇒ `enabled = !disabledByDefault`（同文件 :175，出厂状态下没有用户的显式开关）
 *     ⇒ `targetFor()` 把它物化到 `skills-disabled/` 而不是 `skills/`（`agent/skills-plugin.ts:157`）
 *     ⇒ SDK 只扫 `skills/` ⇒ **技能没加载 ⇒ 斜杠命令没注册**
 *     ⇒ 用户看到 `Unknown command: /data-search`
 *
 * ── 这个 bug 能活下来的原因（本条护栏针对的就是它）────────────
 * **两边的信息从来没被放在一起看过**：
 *   · 渲染层只知道自己有 `MODE_COMMAND`（一张字面量表）；
 *   · 主进程只知道"哪些技能目录带着 `.disabled-by-default`"；
 *   · 两边各自改，**各自都没错** —— 合起来才坏。
 * ⇒ 所以护栏必须**同时**读这两边，而不是在任一侧加断言。
 *
 * ── 判据（对 `MODE_COMMAND` 里的每一个非空命令）──────────────
 *   ① 技能目录存在、且有 `SKILL.md`；
 *   ② **没有 `.disabled-by-default`**（出厂即可用，不依赖用户去「扩展 → 技能」手动打开）；
 *   ③ frontmatter 的 `name`（若写了）必须等于命令名 —— SDK 注册的斜杠命令用的是它。
 *
 * ── ⚠️ 为什么是"从 `Composer.tsx` 源码里正则读命令"，而不是抽成共享常量 ──
 * **抽取常量是更好的修法**（那会变成编译期单一事实来源，连正则都不需要）。
 * 但 `Composer.tsx` 不在本项的改动边界里（它归 `impl-composer`），
 * 所以先按"读源码"把**同一个护栏**立起来；抽取已作为建议上报。
 * ⇒ 本条测的是**文件里真实写的字面量**，不是某份中间副本 —— 这点很重要：
 *    如果有人把表抽走了而这里还在读旧位置，下面的自检用例会先红。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// `skills/index.ts` 顶部 import 了 electron 与设置层；本文件只借它的
// `parseFrontmatter` / `builtinSkillsRoot`，所以把那两个依赖换掉（避免在读盘/写盘上产生副作用）。
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
}));
vi.mock('../store/config', () => ({
  disabledSkillDirs: () => new Set<string>(),
  enabledSkillDirs: () => new Set<string>(),
  setSkillDisabled: () => undefined,
}));

import { builtinSkillsRoot, parseFrontmatter } from './index';

const COMPOSER = join(process.cwd(), 'src', 'renderer', 'src', 'components', 'Composer.tsx');

/**
 * 从 `Composer.tsx` 里读出 `MODE_COMMAND` 的全部斜杠命令。
 *
 * 只取那个对象字面量的 `{...}` 区间 —— 整个文件里还有别的 `'/...'` 字面量
 * （正则、i18n 路径等），不限定区间会抓错。
 * 找不到区间时返回空数组（**不抛**）：让下面那条自检用例来红，
 * 报错信息比"测试文件加载失败"清楚得多。
 */
function modeCommands(): string[] {
  const src = readFileSync(COMPOSER, 'utf8');
  const start = src.indexOf('const MODE_COMMAND');
  if (start < 0) return [];
  const open = src.indexOf('{', start);
  const close = src.indexOf('\n};', open);
  if (open < 0 || close < 0) return [];

  const body = src.slice(open, close);
  const found = [...body.matchAll(/'(\/[A-Za-z0-9_-]+)'/g)].map((m) => m[1]);
  return [...new Set(found)].sort();
}

/**
 * 一次判定：这个内置技能"出厂即可用"吗（= SDK 会加载它、斜杠命令会注册）？
 *
 * 抽成带 `root` 参数的纯函数，是为了**反向对照**能对着一个临时造的假技能跑 ——
 * 证明"带标记 ⇒ 判红"这条因果链真的成立。否则主判定即便永远返回 ok，也没人发现得了。
 */
function checkSkill(name: string, root: string): { ok: boolean; reason: string } {
  const dir = join(root, name);
  const md = join(dir, 'SKILL.md');

  if (!existsSync(md)) {
    return { ok: false, reason: `技能目录或 SKILL.md 不存在：${md}` };
  }
  if (existsSync(join(dir, '.disabled-by-default'))) {
    return {
      ok: false,
      reason:
        `带 .disabled-by-default ⇒ 被物化到 skills-disabled/ ⇒ SDK 不加载 ` +
        `⇒ 斜杠命令不注册 ⇒ 用户只会看到 "Unknown command: /${name}"`,
    };
  }

  const fm = parseFrontmatter(readFileSync(md, 'utf8'));
  // Anthropic skill 规范：写了 `name` 就以它为准（斜杠命令就是 `/<name>`）；
  // 没写时上游与 `readSkill()` 都用目录名兜底 ⇒ 只有"写了但写错"才算坏。
  if ((fm.name ?? name) !== name) {
    return {
      ok: false,
      reason: `SKILL.md 的 frontmatter name="${fm.name}" ≠ 目录名/命令名 "${name}"`,
    };
  }
  return { ok: true, reason: '' };
}

const BUILTIN = builtinSkillsRoot();
const COMMANDS = modeCommands();

describe('自检：这条护栏真的读到了东西（防"空集合上恒真"）', () => {
  it('MODE_COMMAND 被解析出来了，且包含本次事故那条', () => {
    expect(COMMANDS.length, `从 ${COMPOSER} 没读出命令，护栏形同虚设`).toBeGreaterThanOrEqual(4);
    // ★ 本次事故的命令必须在 —— 这条比数量断言更能防"正则悄悄失效"
    expect(COMMANDS).toContain('/data-search');
    expect(COMMANDS).toContain('/write-paper');
    // 反向对照：`chat: null` 不是命令，不该被当成一个斜杠命令抓进来
    expect(COMMANDS).not.toContain('/chat');
  });

  it('技能根目录指向仓库里的 resources/builtin-skills（防 mock 漂移把护栏指错地方）', () => {
    expect(BUILTIN.replace(/\\/g, '/').endsWith('resources/builtin-skills')).toBe(true);
    expect(existsSync(BUILTIN)).toBe(true);
  });
});

describe('★ 主判据：每个模式命令对应的内置技能，出厂即可用', () => {
  it.each(COMMANDS)('%s → 技能存在 + 默认启用 + frontmatter 名字对得上', (cmd) => {
    const name = cmd.replace(/^\//, '');
    const r = checkSkill(name, BUILTIN);

    // 失败时把 reason 当断言消息带出来，红了一眼能看出是哪一环断的
    expect(r.ok, r.reason).toBe(true);
  });
});

describe('反向对照：判据真的在判那三件事（否则"全绿"没有意义）', () => {
  it('★ 只有 `.disabled-by-default` 这一个差别 ⇒ 必须判红', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mm-skill-guard-'));
    const dir = join(tmp, 'ghost-skill');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: ghost-skill\ndescription: 假技能\n---\n\n正文\n');

    // 先证明"不带标记时是绿的" —— 否则下面的红可能来自别的原因（同目录、同 SKILL.md，只多一个文件）
    expect(checkSkill('ghost-skill', tmp).ok).toBe(true);

    writeFileSync(join(dir, '.disabled-by-default'), '');
    const r = checkSkill('ghost-skill', tmp);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('.disabled-by-default');
  });

  it('★ 缺 SKILL.md ⇒ 判红', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mm-skill-guard-'));
    mkdirSync(join(tmp, 'empty-skill'));

    const r = checkSkill('empty-skill', tmp);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('SKILL.md');
  });

  it('★ frontmatter 的 name 写错 ⇒ 判红（斜杠命令会注册成另一个名字）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mm-skill-guard-'));
    const dir = join(tmp, 'ghost-skill');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: data_search\ndescription: 下划线版\n---\n\n正文\n');

    const r = checkSkill('ghost-skill', tmp);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('frontmatter');
  });
});

describe('默认禁用的内置技能必须是一份"有理由的名单"', () => {
  it('★ 当前只有 metaheuristic-optimization（理由见下），新增必须显式改这里', () => {
    const disabled = readdirSync(BUILTIN, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => existsSync(join(BUILTIN, d.name, '.disabled-by-default')))
      .map((d) => d.name)
      .sort();

    // 为什么它可以是默认禁用：它是**专精技能**，`MODE_COMMAND` 里没有命令映射到它
    //   ⇒ 用户不会"点了某个模式却得到 Unknown command"，而是由用户在「扩展 → 技能」里按需打开。
    // ⚠️ 任何**新的**默认禁用都必须先回答同一个问题："有模式命令指向它吗？"
    //    有 ⇒ 先看本文件的主判据；没有 ⇒ 把它加进这个名单，并在报告里说明理由。
    expect(disabled).toEqual(['metaheuristic-optimization']);
  });
});
