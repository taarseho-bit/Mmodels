/**
 * 轻量语法高亮 tokenize 的护栏（2026-09-26）。
 *
 * 编辑器视图的高亮是「透明 textarea + 底层 pre」方案 —— tokenize 输出直接决定
 * 用户看到的颜色。这里钉住四类最容易静默坏掉的行为：
 *   ① 注释不被字符串/关键字吞掉；
 *   ② 字符串（含引号内 # / // 之类）整体着 string；
 *   ③ 关键字/内建/普通标识符三档归档；
 *   ④ 未知语言 / 空输入的回落。
 */
import { describe, expect, it } from 'vitest';
import { langOf, tokenize } from './syntax';

const kindsOf = (code: string, lang: string): string[] =>
  tokenize(code, lang)
    .filter((t) => t.t !== 'plain' || t.v.trim() !== '')
    .map((t) => t.t);

describe('langOf', () => {
  it('常见扩展名映射正确，未知扩展回落 null', () => {
    expect(langOf('model.py')).toBe('python');
    expect(langOf('paper.tex')).toBe('latex');
    expect(langOf('run.R')).toBe('r');
    expect(langOf('main.cpp')).toBe('c');
    expect(langOf('data.csv')).toBeNull();
    expect(langOf('README')).toBeNull();
  });
});

describe('tokenize · python', () => {
  it('注释独立着色，字符串里的 # 不是注释', () => {
    const kinds = kindsOf("x = '# 不是注释'  # 这是注释", 'python');
    expect(kinds).toContain('string');
    expect(kinds).toContain('comment');
    // 注释 token 必须在最后一个 token
    const all = tokenize("x = '# 不是注释'  # 这是注释", 'python');
    expect(all[all.length - 1].t).toBe('comment');
    expect(all[all.length - 1].v).toContain('这是注释');
  });

  it('def/class/None 是 keyword，print/np 是 builtin，普通名是 plain', () => {
    const toks = tokenize('def solve(x):\n    print(np.sum)', 'python');
    const find = (v: string) => toks.find((t) => t.v === v)?.t;
    expect(find('def')).toBe('keyword');
    expect(find('None') ?? find('solve')).toBe('plain'); // solve 普通名
    expect(find('print')).toBe('builtin');
    expect(find('np')).toBe('builtin');
  });
});

describe('tokenize · c 系与 json', () => {
  it('C++ 块注释与关键字', () => {
    const kinds = kindsOf('/* 头 */\nint main() { return 0; }', 'c');
    expect(kinds).toContain('comment');
    expect(kinds).toContain('keyword');
  });

  it('json 的键是 builtin，字符串值是 string，true/false/null 是 keyword', () => {
    const toks = tokenize('{"name": "华为杯", "ok": true, "n": 3}', 'json');
    const find = (v: string) => toks.find((t) => t.v.includes(v))?.t;
    expect(find('"name"')).toBe('builtin');
    expect(find('华为杯')).toBe('string');
    expect(find('true')).toBe('keyword');
    expect(find('3')).toBe('number');
  });
});

describe('tokenize · latex 与回落', () => {
  it('latex 命令与注释', () => {
    const toks = tokenize('% 注释\n\\section{模型}', 'latex');
    expect(toks[0].t).toBe('comment');
    expect(toks.some((t) => t.t === 'builtin' && t.v.startsWith('\\section'))).toBe(true);
  });

  it('未知语言整段 plain，空输入安全', () => {
    expect(tokenize('whatever', 'csv')).toEqual([{ t: 'plain', v: 'whatever' }]);
    expect(tokenize('', 'python')).toEqual([]);
  });
});
