/**
 * license-gate 断网宽限（10 分钟）行为测试。
 *
 * 通过 vi.mock('electron') 把 userData 指到临时目录，policy 指到临时 cwd；
 * 每个用例 vi.resetModules() + 动态 import，隔离模块级内存缓存。
 */
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = {
  userDir: '',
  cwd: '',
  cwdOriginal: '' as string,
};

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '0.1.16',
    getPath: (name: string) => (name === 'userData' ? H.userDir : tmpdir()),
  },
}));

type GateModule = typeof import('./license-gate');

async function freshGate(): Promise<GateModule> {
  vi.resetModules();
  return import('./license-gate');
}

function writePolicy(required: boolean): void {
  mkdirSync(join(H.cwd, 'resources'), { recursive: true });
  writeFileSync(
    join(H.cwd, 'resources', 'license-policy.json'),
    JSON.stringify({ schema: 1, required, endpoint: 'https://license.example/check', cacheTtlMs: 300_000 }),
    'utf8',
  );
}

function writeToken(token: string): void {
  writeFileSync(join(H.userDir, 'license.token'), token, 'utf8');
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function statusResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as unknown as Response;
}

async function seedOk(gate: GateModule): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okResponse({ allowed: true, expiresAt: Date.now() + 86_400_000 })),
  );
  await gate.assertAiEntitlement();
}

describe('license-gate 断网宽限', () => {
  beforeEach(() => {
    H.cwdOriginal = process.cwd();
    H.cwd = mkdtempSync(join(tmpdir(), 'mmodels-gate-cwd-'));
    H.userDir = mkdtempSync(join(tmpdir(), 'mmodels-gate-user-'));
    process.chdir(H.cwd);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.chdir(H.cwdOriginal);
    try {
      rmSync(H.cwd, { recursive: true, force: true });
      rmSync(H.userDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言。
    }
  });

  it('required=false 时直接放行且不发起请求', async () => {
    writePolicy(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const gate = await freshGate();
    await expect(gate.assertAiEntitlement()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('在线校验成功 → 放行并写入宽限记录', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    await seedOk(gate);
    expect(existsSync(gate.__licenseTestHooks.gracePath())).toBe(true);
  });

  it('内存缓存有效期内二次调用不再请求', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const fetchMock = vi.fn(async () => okResponse({ allowed: true, expiresAt: Date.now() + 86_400_000 }));
    vi.stubGlobal('fetch', fetchMock);
    await gate.assertAiEntitlement();
    await gate.assertAiEntitlement();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络失败 + 宽限窗口内（<10 分钟）→ 放行', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    await seedOk(gate);

    // 重置内存缓存（新模块实例），仅保留磁盘宽限记录，再断网。
    const gate2 = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(gate2.assertAiEntitlement()).resolves.toBeUndefined();
  });

  it('网络失败 + 宽限窗口已过（>10 分钟）→ 拒绝', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const hooks = gate.__licenseTestHooks;
    hooks.writeGrace('tok-1', hooks.deviceId(), Date.now() - hooks.GRACE_MS - 60_000);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(gate.assertAiEntitlement()).rejects.toThrow('授权验证暂时不可用');
  });

  it('网络失败 + 无宽限记录 → 拒绝', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }));
    await expect(gate.assertAiEntitlement()).rejects.toThrow('授权验证暂时不可用');
  });

  it('宽限记录被手改（签名失配）→ 不放行', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const hooks = gate.__licenseTestHooks;
    hooks.writeGrace('tok-1', hooks.deviceId(), Date.now());
    const file = hooks.gracePath();
    const record = JSON.parse(readFileSync(file, 'utf8')) as { lastOkAt: number; sig: string };
    record.lastOkAt = Date.now(); // 改内容不改签名
    writeFileSync(file, JSON.stringify(record), 'utf8');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(gate.assertAiEntitlement()).rejects.toThrow('授权验证暂时不可用');
  });

  it('宽限记录绑定令牌：换 token 后旧记录不生效', async () => {
    writePolicy(true);
    writeToken('tok-2');
    const gate = await freshGate();
    const hooks = gate.__licenseTestHooks;
    hooks.writeGrace('tok-1', hooks.deviceId(), Date.now()); // 旧令牌留下的记录

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(gate.assertAiEntitlement()).rejects.toThrow('授权验证暂时不可用');
  });

  it('服务端 401 明确拒绝 → 拒绝并清除宽限记录', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const hooks = gate.__licenseTestHooks;
    await seedOk(gate);
    expect(existsSync(hooks.gracePath())).toBe(true);

    const gate2 = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse(401)));
    await expect(gate2.assertAiEntitlement()).rejects.toThrow('授权已失效');
    expect(existsSync(hooks.gracePath())).toBe(false);
  });

  it('服务端 allowed=false 明确拒绝 → 拒绝并清除宽限记录', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const hooks = gate.__licenseTestHooks;
    await seedOk(gate);

    const gate2 = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ allowed: false })));
    await expect(gate2.assertAiEntitlement()).rejects.toThrow('授权已失效或当前设备未被允许');
    expect(existsSync(hooks.gracePath())).toBe(false);
  });

  it('服务端 5xx 故障按网络类失败处理：宽限窗口内放行', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    await seedOk(gate);

    const gate2 = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse(502)));
    await expect(gate2.assertAiEntitlement()).resolves.toBeUndefined();
  });

  it('200 但响应不是授权协议时拒绝且不走宽限', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ html: '<!doctype html>' }) })));
    await expect(gate.assertAiEntitlement()).rejects.toThrow('授权服务返回格式无效');
  });

  it('统一积分成本会随请求发送，服务端可按本轮原子扣减', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    const fetchMock = vi.fn(async () => okResponse({ allowed: true, pointsBalance: 17, costPoints: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    await gate.assertAiEntitlement('ai-chat', 'turn-12345678', 3);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-mmodels-points-cost']).toBe('3');
    expect(JSON.parse(String(init.body))).toMatchObject({ feature: 'ai-chat', requestId: 'turn-12345678', pointsCost: 3, consume: true });
  });

  it('试用调用多智能体时使用明确的中文付费 VIP 提示', async () => {
    writePolicy(true);
    writeToken('tok-1');
    const gate = await freshGate();
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({
      allowed: false,
      code: 'TRIAL_MULTI_AGENT_FORBIDDEN',
    })));
    await expect(gate.assertAiEntitlement('multi-agent')).rejects.toThrow('卡密兑换的 VIP');
  });
});
