import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IPC, type ConnectorTestResult } from '@shared/types';
import { connectorEntry } from '@shared/connector-catalog';
import { getRuntimeMcpServers } from '../store/config';
import { testNativeConnector } from '../agent/native-connectors';
import { safeWrap, type IpcContext } from './index';

const execFileAsync = promisify(execFile);

export function registerConnectorHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IPC.CONNECTOR_TEST, safeWrap(async (_event, name: string): Promise<ConnectorTestResult> => {
    const started = Date.now();
    const config = getRuntimeMcpServers().find(item => item.name === name);
    if (!config) throw new Error('没有找到这个连接器，请先保存配置');
    const entry = connectorEntry(name);
    try {
      let detail: string;
      if (config.native) detail = await testNativeConnector(config);
      else if (config.transport === 'stdio') {
        await execFileAsync(config.command!, ['--version'], { timeout: 12_000, windowsHide: true });
        detail = '本地命令可以启动；完整工具会在下一轮对话加载';
      } else {
        const response = await fetch(config.url!, { method: 'HEAD', signal: AbortSignal.timeout(12_000) });
        if (!response.ok && response.status !== 405) throw new Error(`远程服务返回 ${response.status}`);
        detail = '远程地址可以访问；完整工具会在下一轮对话加载';
      }
      return { ok: true, name, displayName: entry?.displayName, detail, checkedAt: Date.now(), latencyMs: Date.now() - started };
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const detail = /fetch failed|network|socket|timed out|timeout/i.test(raw)
        ? '网络暂时不可用，已自动重试；请检查网络或代理设置'
        : raw || '连接失败，请稍后重试';
      return { ok: false, name, displayName: entry?.displayName, detail, checkedAt: Date.now(), latencyMs: Date.now() - started };
    }
  }, '测试连接器'));
}
