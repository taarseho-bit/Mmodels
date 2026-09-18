const fs = require('fs');
const path = require('path');
const out = [];

// 顶层 @anthropic-ai
const top = 'D:\\mathmodel-desktop\\node_modules\\@anthropic-ai';
try {
  out.push('=== node_modules/@anthropic-ai ===');
  for (const d of fs.readdirSync(top)) {
    const full = path.join(top, d);
    out.push('  [D] ' + d + '  ->  ' + (fs.lstatSync(full).isSymbolicLink() ? 'SYMLINK to ' + fs.readlinkSync(full) : 'real'));
  }
} catch (e) { out.push('top err: ' + e.message); }

// sdk 包内容
const sdk = path.join(top, 'claude-agent-sdk');
out.push('');
out.push('=== claude-agent-sdk 内容 ===');
try {
  for (const f of fs.readdirSync(sdk)) {
    const full = path.join(sdk, f);
    const st = fs.statSync(full);
    out.push('  ' + (st.isDirectory() ? '[D] ' : '[F] ') + f + (st.isFile() ? '  ' + st.size : ''));
  }
} catch (e) { out.push('sdk err: ' + e.message); }

// .pnpm 里的 claude-agent-sdk
const vp = 'D:\\mathmodel-desktop\\node_modules\\.pnpm';
out.push('');
out.push('=== .pnpm 中的 claude 相关 ===');
try {
  for (const d of fs.readdirSync(vp)) {
    if (d.includes('claude')) out.push('  ' + d);
  }
} catch (e) { out.push('err: ' + e.message); }

fs.writeFileSync('D:\\mathmodel-desktop\\.sdk-locate.txt', out.join('\r\n'), 'utf8');
console.log('ok');
