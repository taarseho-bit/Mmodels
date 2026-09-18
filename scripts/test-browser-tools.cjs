/** Real Electron DOM/CDP smoke test; local HTTP only, isolated profile, no API key. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-browser-test-'));
app.setPath('userData', path.join(root, 'profile'));
let server;
const timeout = setTimeout(() => { console.error('浏览器测试超时'); app.exit(1); }, 25000);
app.whenReady().then(async () => {
  const code = ts.transpileModule(fs.readFileSync(path.resolve('src/main/agent/browser-tools.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const testRequire = name => name === '@anthropic-ai/claude-agent-sdk'
    ? { tool: (name, description, schema, handler) => ({ name, description, schema, handler }), createSdkMcpServer: x => x }
    : name === 'electron' ? { BrowserWindow: class extends BrowserWindow { constructor(options) { super({ ...options, show: false }); } } } : require(name);
  const m = { exports: {} }; new Function('require', 'module', 'exports', code)(testRequire, m, m.exports);
  server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<html><body><button onclick="document.getElementById(\'out\').textContent=\'已点击\'">验证按钮</button><input aria-label="测试输入"><select aria-label="测试选择"><option value="a">甲</option><option value="b">乙</option></select><input type="file" aria-label="测试文件"><p id="out">尚未点击</p></body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const api = m.exports.browserServer('test-one', root, false);
  let passed = 0;
  const call = async (name, args = {}) => {
    const t = api.tools.find(t => t.name === name); assert(t, name);
    const result = await t.handler(t.schema && Object.keys(t.schema).length ? require('zod').z.object(t.schema).parse(args) : args);
    assert(!result.isError, JSON.stringify(result)); passed++; return result;
  };
  const read = async () => JSON.parse((await call('browser_snapshot')).content[0].text);
  const target = (s, text) => ({ snapshotId: s.snapshotId, ref: s.elements.find(e => e.text === text).ref });
  await call('browser_navigate', { action: 'url', url: `http://127.0.0.1:${server.address().port}` });
  const first = await read();
  await call('browser_click', { target: target(first, '验证按钮') });
  await new Promise(r => setTimeout(r, 100));
  assert((await read()).text.includes('已点击')); passed++;
  const stale = await api.tools.find(t => t.name === 'browser_click').handler({ target: target(first, '验证按钮') });
  assert(stale.isError); passed++;
  const second = await read();
  await call('browser_type', { target: target(second, '测试输入'), text: '中文输入通过', replace: true });
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  assert.equal(await wc.executeJavaScript('document.querySelector("input").value'), '中文输入通过'); passed++;
  const third = await read();
  await call('browser_select_option', { target: target(third, '测试选择'), values: ['b'] });
  assert.equal(await wc.executeJavaScript('document.querySelector("select").value'), 'b'); passed++;
  const fixture = path.join(root, 'upload-fixture.txt'); fs.writeFileSync(fixture, 'fixture');
  const fourth = await read();
  await call('browser_upload', { target: target(fourth, '测试文件'), paths: [fixture] });
  assert.equal(await wc.executeJavaScript('document.querySelector("input[type=file]").files[0].name'), 'upload-fixture.txt'); passed++;
  assert.equal((await call('browser_screenshot')).content[0].type, 'image');
  const other = m.exports.browserServer('test-two', root, true);
  const status = await other.tools.find(t => t.name === 'browser_status').handler({});
  assert.equal(JSON.parse(status.content[0].text).tabs.length, 0); passed++;
  const blocked = await other.tools.find(t => t.name === 'browser_navigate').handler({ action: 'url', url: 'https://example.org' });
  assert(blocked.isError); passed++;
  m.exports.closeAgentBrowsers(); assert.equal(BrowserWindow.getAllWindows().length, 0); passed++;
  console.log(JSON.stringify({ passed, tools: api.tools.map(t => t.name), scope: '真实Electron本地网页；窗口隐藏；无外部API' }));
  clearTimeout(timeout); server.closeAllConnections(); server.close(); app.exit(0);
}).catch(e => { console.error(e); clearTimeout(timeout); server?.closeAllConnections(); server?.close(); app.exit(1); });
