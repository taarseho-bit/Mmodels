/**
 * 账号与授权 IPC（商业化）。
 *
 * 对接授权服务（register/login/redeem/check）。凭证落盘在本机 userData：
 *  - account.json   账号名 + 加密密码 + 已知到期时间（redeem 续费需要密码；只存本机）
 *  - license.token  服务端签发的授权令牌（license-gate 每次模型回合前校验）
 *
 * ⚠️ deviceId 计算公式必须与 security/license-gate.ts 的 deviceId() 保持一致
 *    （sha256(userData|platform|arch)），否则服务端 device mismatch 会拒答。
 */
import { app, ipcMain, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC, type AccountStatusInfo } from '@shared/types';
import { safeWrap } from './index';

interface LocalAccount {
  username: string;
  password: string;
  expiresAt: number;
}

interface StoredAccount {
  username: string;
  passwordEnc?: string;
  /** 历史明文字段，仅用于一次迁移，成功读取后立即删除。 */
  password?: string;
  expiresAt?: number;
}

function accountFile(): string {
  return join(app.getPath('userData'), 'account.json');
}
function tokenFile(): string {
  return join(app.getPath('userData'), 'license.token');
}

function readLocal(): LocalAccount | null {
  try {
    const raw = JSON.parse(readFileSync(accountFile(), 'utf8')) as StoredAccount;
    if (typeof raw.username !== 'string') return null;
    let password = '';
    if (typeof raw.passwordEnc === 'string' && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(raw.passwordEnc, 'base64'));
    } else if (typeof raw.password === 'string') {
      // 迁移历史明文账号文件；安全存储暂不可用时只在内存使用。
      password = raw.password;
      if (safeStorage.isEncryptionAvailable()) {
        writeLocal({ username: raw.username, password, expiresAt: Number(raw.expiresAt) || 0 });
      }
    }
    if (!password) return null;
    return { username: raw.username, password, expiresAt: Number(raw.expiresAt) || 0 };
  } catch {
    return null;
  }
}

function writeLocal(account: LocalAccount): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法安全保存账号凭证');
  }
  const payload: StoredAccount = {
    username: account.username,
    passwordEnc: safeStorage.encryptString(account.password).toString('base64'),
    expiresAt: account.expiresAt,
  };
  const target = accountFile();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, target);
}

function assertSecureStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，请重启应用后重试');
}

/** 与 security/license-gate.ts 的 deviceId() 同公式，勿单独改动 */
function deviceId(): string {
  return createHash('sha256').update(`${app.getPath('userData')}|${process.platform}|${process.arch}`).digest('hex');
}

/** 授权服务 API 基址：优先 license-policy.json 的 endpoint 前缀，其次环境变量，最后当前生产地址 */
function apiBase(): string {
  try {
    const file = app.isPackaged
      ? join(process.resourcesPath, 'license-policy.json')
      : join(process.cwd(), 'resources', 'license-policy.json');
    if (existsSync(file)) {
      const policy = JSON.parse(readFileSync(file, 'utf8')) as { endpoint?: string; required?: boolean };
      const endpoint = String(policy.endpoint || '').trim();
      if (!endpoint && policy.required === false) {
        // 打包版即使策略标记为 optional，也不能接受环境变量注入的明文 HTTP
        // 地址；只有开发态允许通过 MM_LICENSE_API 指向本地测试服务。
        if (app.isPackaged) return 'https://api.mmodel.top';
        return process.env.MM_LICENSE_API?.trim() || 'https://api.mmodel.top';
      }
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/\/api\/license\/check\/?$/i.test(parsed.pathname)) {
        throw new Error('授权策略地址无效');
      }
      return parsed.origin;
    }
  } catch {
    if (app.isPackaged) throw new Error('商业授权策略缺失或无效，请重新安装当前版本');
  }
  const env = process.env.MM_LICENSE_API?.trim();
  if (!env) throw new Error('开发环境未配置 MM_LICENSE_API，未发送账号请求');
  const parsed = new URL(env);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('授权服务必须使用不含凭据和查询参数的 HTTPS 地址');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function callApi(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; allowed?: boolean };
    if (!res.ok || data.ok === false) {
      throw new Error(String(data.error || `服务返回 ${res.status}`));
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.message.includes('abort')) {
      throw new Error('授权服务连接超时，请检查网络后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function statusOf(): AccountStatusInfo {
  const local = readLocal();
  if (!local) return { loggedIn: false, username: '', expiresAt: 0 };
  return { loggedIn: true, username: local.username, expiresAt: local.expiresAt };
}

function persistAuth(username: string, password: string, expiresAt: unknown, token: unknown): AccountStatusInfo {
  const exp = Number(expiresAt) || 0;
  const tok = String(token || '').trim();
  if (!tok) throw new Error('服务端未返回授权令牌');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存授权令牌');
  // 先准备两份临时文件，再提交令牌和账号；账号提交失败时恢复旧令牌，
  // 避免出现“界面显示已登录但模型没有令牌”的半登录状态。
  const accountTarget = accountFile();
  const tokenTarget = tokenFile();
  const accountTmp = `${accountTarget}.tmp`;
  const tokenTmp = `${tokenTarget}.tmp`;
  let previousToken: Buffer | null = null;
  let hadToken = false;
  try {
    if (existsSync(tokenTarget)) {
      previousToken = readFileSync(tokenTarget);
      hadToken = true;
    }
    const accountPayload: StoredAccount = {
      username,
      passwordEnc: safeStorage.encryptString(password).toString('base64'),
      expiresAt: exp,
    };
    writeFileSync(accountTmp, JSON.stringify(accountPayload, null, 2), { encoding: 'utf8', mode: 0o600 });
    writeFileSync(tokenTmp, `enc1:${safeStorage.encryptString(tok).toString('base64')}`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tokenTmp, tokenTarget);
    try {
      renameSync(accountTmp, accountTarget);
    } catch (error) {
      // token 已提交但账号未提交：尽量回到提交前的令牌状态。
      if (hadToken && previousToken) {
        writeFileSync(tokenTmp, previousToken, { mode: 0o600 });
        renameSync(tokenTmp, tokenTarget);
      } else {
        rmSync(tokenTarget, { force: true });
      }
      throw error;
    }
  } finally {
    try { rmSync(accountTmp, { force: true }); } catch { /* ignore */ }
    try { rmSync(tokenTmp, { force: true }); } catch { /* ignore */ }
  }
  return { loggedIn: true, username, expiresAt: exp };
}

export function registerAccountHandlers(): void {
  ipcMain.handle(IPC.ACCOUNT_STATUS, safeWrap((): AccountStatusInfo => statusOf(), '读取账号状态'));

  ipcMain.handle(
    IPC.ACCOUNT_REGISTER,
    safeWrap(async (_e, args: { username?: string; password?: string; email?: string; emailCode?: string; code?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const username = String(args?.username || '').trim();
      const password = String(args?.password || '');
      const email = String(args?.email || '').trim().toLowerCase();
      const emailCode = String(args?.emailCode || '').trim();
      const code = String(args?.code || '').trim().toUpperCase();
      const data = await callApi('/api/auth/register', {
        username, password, email, emailCode, deviceId: deviceId(), code: code || undefined,
      });
      return persistAuth(username, password, data.expiresAt, data.token);
    }, '注册账号'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_SEND_CODE,
    safeWrap(async (_e, args: { email?: string; purpose?: 'register' | 'reset' }): Promise<void> => {
      const email = String(args?.email || '').trim().toLowerCase();
      const purpose = args?.purpose === 'reset' ? 'reset' : 'register';
      await callApi('/api/auth/send-code', { email, purpose });
    }, '发送邮箱验证码'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_RESET_PASSWORD,
    safeWrap(async (_e, args: { email?: string; emailCode?: string; newPassword?: string }): Promise<void> => {
      const email = String(args?.email || '').trim().toLowerCase();
      const emailCode = String(args?.emailCode || '').trim();
      const newPassword = String(args?.newPassword || '');
      await callApi('/api/auth/reset-pass', { email, emailCode, newPassword });
    }, '重置密码'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_LOGIN,
    safeWrap(async (_e, args: { username?: string; password?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const username = String(args?.username || '').trim();
      const password = String(args?.password || '');
      const data = await callApi('/api/auth/login', { username, password, deviceId: deviceId() });
      return persistAuth(username, password, data.expiresAt, data.token);
    }, '登录账号'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_REDEEM,
    safeWrap(async (_e, args: { code?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先登录账号后再兑换卡密');
      const code = String(args?.code || '').trim().toUpperCase();
      const data = await callApi('/api/redeem', {
        username: local.username, password: local.password, code, deviceId: deviceId(),
      });
      return persistAuth(local.username, local.password, data.expiresAt, data.token);
    }, '兑换卡密'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_LOGOUT,
    safeWrap((): AccountStatusInfo => {
      try { rmSync(accountFile(), { force: true }); } catch { /* 忽略 */ }
      try { rmSync(tokenFile(), { force: true }); } catch { /* 忽略 */ }
      return { loggedIn: false, username: '', expiresAt: 0 };
    }, '退出登录'),
  );
}
