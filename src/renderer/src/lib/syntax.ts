/**
 * 轻量语法高亮 tokenize（2026-09-26 用户需求：编辑器视图里代码要有代码的颜色，
 * 不同文件类型要有区分）。
 *
 * 为什么不引 Shiki / Prism / CodeMirror：
 *   - 编辑器是**可编辑 textarea**（ArtifactPanes 的保存/冲突检测链路都建立在它上面），
 *     高亮只能做「透明 textarea + 底层 pre」的 overlay 方案 —— 需要的是快速、零依赖、
 *     足够好的 token 着色，不是完整 IDE 语法树；
 *   - Shiki 全量好几 MB，Prism 也要为每个语言引包，对本需求都是杀鸡用牛刀。
 *
 * 覆盖语言：python / javascript / typescript / json / latex / markdown / css /
 * html(xml) / yaml / shell / c 系（c·cpp·java·cs·go·rust）/ r / matlab / julia。
 * 识别不了的扩展名返回 null（调用方回落纯文本，行为与现状一致）。
 *
 * ⚠️ tokenize 是逐字符状态机的简化版：正则交替匹配（注释 → 字符串 → 数字 →
 *    关键字），匹配不到的字符累积成 plain。对数模项目的文件规模（几百 KB 内）
 *    足够快；调用方对超大文件（>300KB）应直接不高亮。
 */

export type TokKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'tag' | 'heading' | 'ident';
export interface HlToken {
  t: TokKind;
  v: string;
}

/** 扩展名 → 语言；null = 不高亮 */
export function langOf(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'python', pyw: 'python',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
    ts: 'js', tsx: 'js',
    json: 'json', jsonc: 'json',
    tex: 'latex', sty: 'latex', cls: 'latex', bib: 'latex',
    md: 'markdown', markdown: 'markdown',
    css: 'css', scss: 'css',
    html: 'html', htm: 'html', xml: 'html', svg: 'html',
    yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml',
    sh: 'shell', bash: 'shell', zsh: 'shell', bat: 'shell', ps1: 'shell',
    c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', hxx: 'c',
    java: 'c', cs: 'c', go: 'c', rs: 'c', swift: 'c', kt: 'c',
    r: 'r',
    m: 'matlab',
    jl: 'matlab',
  };
  return map[ext] ?? null;
}

interface LangSpec {
  /** 交替正则：顺序即优先级（注释在字符串前处理，避免 // 被 当字符串吞掉等） */
  re: RegExp;
  /** 捕获组序号 → token 类型（'ident' 是中间态：按 keywords/builtins 再归档） */
  kinds: TokKind[];
  /** 关键字集合（命中普通标识符时着 keyword） */
  keywords?: Set<string>;
  /** 内建/常用名集合（比 keyword 弱一档的颜色） */
  builtins?: Set<string>;
}

function cLike(
  keywords: string[],
  builtins: string[],
  lineComment = '//',
  blockComment = true,
): LangSpec {
  const kw = new Set(keywords);
  const bi = new Set(builtins);
  const re = new RegExp(
    [
      blockComment ? '(\\/\\*[\\s\\S]*?\\*\\/)' : '(?!x)x',
      `(\\${lineComment === '\\' ? '' : lineComment === '/' ? '/' : lineComment}[^\n]*)`
        .replace(/\\{2}/g, '\\\\'),
      "('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)",
      '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0[xXbBoO][0-9a-fA-F]+\\b)',
      '([A-Za-z_$][\\w$]*)',
    ].join('|'),
    'g',
  );
  return { re, kinds: ['comment', 'comment', 'string', 'number', 'ident'], keywords: kw, builtins: bi };
}

const PY = (): LangSpec => {
  const kw = new Set([
    'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'in', 'import', 'from', 'as',
    'return', 'with', 'try', 'except', 'finally', 'lambda', 'None', 'True', 'False',
    'and', 'or', 'not', 'is', 'pass', 'break', 'continue', 'global', 'nonlocal', 'yield',
    'assert', 'raise', 'async', 'await', 'del', 'match', 'case', 'self',
  ]);
  const bi = new Set([
    'print', 'len', 'range', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple',
    'sum', 'min', 'max', 'abs', 'round', 'sorted', 'enumerate', 'zip', 'map', 'filter',
    'open', 'type', 'isinstance', 'super', 'bool', 'bytes', 'complex', 'divmod', 'hash',
    'input', 'iter', 'next', 'pow', 'reversed', 'slice', 'vars', 'format', 'frozenset',
    'np', 'pd', 'plt', 'math', 'sns', 'sklearn', 'scipy', 'stats',
  ]);
  return {
    re: /(#\s[^\n]*|#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?"""|(?:[fFrRbBuU]{0,2})'(?:[^'\\\n]|\\.)*'|(?:[fFrRbBuU]{0,2})"(?:[^"\\\n]|\\.)*")|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b0[xXbBoO][0-9a-fA-F]+\b)|([A-Za-z_][\w]*)/g,
    kinds: ['comment', 'string', 'number', 'ident'],
    keywords: kw,
    builtins: bi,
  };
};

const JS = cLike(
  ['var', 'let', 'const', 'function', 'class', 'extends', 'if', 'else', 'for', 'while', 'do',
   'switch', 'case', 'default', 'break', 'continue', 'return', 'try', 'catch', 'finally',
   'throw', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'import',
   'export', 'from', 'as', 'async', 'await', 'yield', 'static', 'get', 'set', 'void', 'null',
   'undefined', 'true', 'false', 'interface', 'type', 'enum', 'implements', 'private', 'public',
   'protected', 'readonly', 'declare', 'namespace', 'abstract', 'is', 'keyof', 'infer'],
  ['console', 'window', 'document', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
   'Boolean', 'Promise', 'Map', 'Set', 'Date', 'Error', 'process', 'require', 'fetch'],
);

const C = cLike(
  ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'signed', 'unsigned', 'bool',
   'const', 'static', 'struct', 'class', 'public', 'private', 'protected', 'virtual', 'new',
   'delete', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
   'continue', 'return', 'sizeof', 'typedef', 'namespace', 'using', 'template', 'typename',
   'try', 'catch', 'throw', 'true', 'false', 'nullptr', 'auto', 'enum', 'union', 'consteval',
   'final', 'override', 'public:'],
  ['std', 'cout', 'cin', 'endl', 'vector', 'string', 'printf', 'scanf', 'malloc', 'free',
   'memset', 'size_t', 'include', 'define', 'Eigen', 'Matrix'],
);

const R = (): LangSpec => {
  const spec = cLike(
    ['if', 'else', 'for', 'while', 'repeat', 'break', 'next', 'return', 'function', 'TRUE',
     'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'library', 'require', 'data', 'in'],
    ['c', 'mean', 'sd', 'median', 'summary', 'plot', 'lm', 'glm', 'data.frame', 'matrix',
     'apply', 'sapply', 'lapply', 'tapply', 'length', 'names', 'head', 'tail'],
    '#',
    false,
  );
  return spec;
};

const MATLAB = (): LangSpec => cLike(
  ['function', 'end', 'if', 'elseif', 'else', 'for', 'while', 'switch', 'case', 'otherwise',
   'break', 'continue', 'return', 'try', 'catch', 'classdef', 'properties', 'methods', 'true',
   'false'],
  ['zeros', 'ones', 'eye', 'size', 'length', 'sum', 'mean', 'std', 'plot', 'figure', 'subplot',
   'linspace', 'meshgrid', 'solve', 'optim', 'fmincon', 'sqrt', 'exp', 'log'],
  '%',
  false,
);

const JSONL: LangSpec = {
  re: /("(?:[^"\\\n]|\\.)*"\s*:)|("(?:[^"\\\n]|\\.)*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b(?:true|false|null)\b)/g,
  kinds: ['builtin', 'string', 'number', 'keyword'],
};

const LATEX: LangSpec = {
  re: /(%[^\n]*)|(\\(?:[a-zA-Z@]+\*?|.| ))|(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)|(\b\d+(?:\.\d+)?\b)/g,
  kinds: ['comment', 'builtin', 'string', 'number'],
};

const MARKDOWN: LangSpec = {
  re: /(^#{1,6} [^\n]*m?$)|(```[\s\S]*?```|`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(^\s*[-*+] |\d+\. )/gm,
  kinds: ['heading', 'string', 'keyword', 'plain'],
};

const CSSL: LangSpec = {
  re: /(\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*')|([.#]?[A-Za-z-][\w-]*(?=\s*\{))|(\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b)/g,
  kinds: ['comment', 'string', 'builtin', 'number'],
};

const HTMLL: LangSpec = {
  re: /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w-]*)|("(?:[^"\\\n]|\\.)*")|(\b[a-zA-Z-]+(?==))/g,
  kinds: ['comment', 'tag', 'string', 'builtin'],
};

const YAMLL: LangSpec = {
  re: /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')|(^[ \t]*[\w.-]+(?=:))|(\b-?\d+(?:\.\d+)?\b|\b(?:true|false|null|yes|no)\b)/gm,
  kinds: ['comment', 'string', 'builtin', 'number'],
};

const SHELLL: LangSpec = {
  re: /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^'\n]*')|(\$\{?\w+\}?)|(\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|source|local|echo|cd|in)\b)/g,
  kinds: ['comment', 'string', 'builtin', 'keyword'],
};

const SPECS: Record<string, LangSpec> = {
  python: PY(),
  js: JS,
  json: JSONL,
  latex: LATEX,
  markdown: MARKDOWN,
  css: CSSL,
  html: HTMLL,
  yaml: YAMLL,
  shell: SHELLL,
  c: C,
  r: R(),
  matlab: MATLAB(),
};

/** tokenize：把整段代码切成着色 token 序列；lang=null 时调用方不应调用 */
export function tokenize(code: string, lang: string): HlToken[] {
  const spec = SPECS[lang];
  if (!spec) return [{ t: 'plain', v: code }];

  const out: HlToken[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  spec.re.lastIndex = 0;
  while ((m = spec.re.exec(code))) {
    if (m.index > last) out.push({ t: 'plain', v: code.slice(last, m.index) });
    // 找到命中的捕获组 → 对应 kind
    let kind: TokKind = 'plain';
    for (let g = 1; g < m.length; g++) {
      if (m[g] !== undefined) {
        kind = spec.kinds[g - 1] ?? 'plain';
        break;
      }
    }
    if (kind === 'ident') {
      // 标识符：按关键字/内建/普通三档着色
      kind = spec.keywords?.has(m[0])
        ? 'keyword'
        : spec.builtins?.has(m[0])
          ? 'builtin'
          : 'plain';
    }
    out.push({ t: kind, v: m[0] });
    last = m.index + m[0].length;
    if (m[0].length === 0) spec.re.lastIndex++; // 防空匹配死循环
  }
  if (last < code.length) out.push({ t: 'plain', v: code.slice(last) });
  return out;
}
