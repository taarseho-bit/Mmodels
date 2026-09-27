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
      // 历史配置保存的 arXiv / GitHub / 时间连接器可能没有 native 标记；
      // 与运行器保持同一套目录判断，升级后无需用户删掉再重新添加。
      const nativeNames = new Set(['arxiv', 'crossref', 'openalex', 'semantic-scholar', 'world-bank', 'open-meteo', 'huggingface-datasets', 'zenodo', 'orcid', 'google-drive', 'github', 'gitlab', 'gitee', 'python', 'r', 'octave', 'webhook', 'time']);
      if (config.native || nativeNames.has(config.name)) detail = await testNativeConnector(config);
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
      const status = raw.match(/(?:返回|HTTP)\s*(\d{3})/)?.[1];
      const detail = /fetch failed|network|socket|timed out|timeout|超时/i.test(raw)
        ? '网络暂时不可用，已自动重试；请检查网络或代理设置。'
        : status === '401' || status === '403'
          ? '访问凭据没有通过验证，请检查密钥或权限。'
          : status === '404'
            ? '没有找到这个连接器地址，请检查接口路径。'
            : status === '429'
              ? '请求太频繁，服务正在限流，稍后再试。'
              : '连接器暂时没有响应，已保留配置，可以重试。';
      return { ok: false, name, displayName: entry?.displayName, detail, checkedAt: Date.now(), latencyMs: Date.now() - started };
    }
  }, '测试连接器'));
}
