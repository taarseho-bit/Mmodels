import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IPC, type ConnectorTestResult } from '@shared/types';
import { connectorEntry } from '@shared/connector-catalog';
import { getRuntimeMcpServers } from '../store/config';
import { testNativeConnector } from '../agent/native-connectors';
import { resolveStdioLauncher } from '../agent/runtime-options';
import { safeWrap, type IpcContext } from './index';

const execFileAsync = promisify(execFile);

export function classifyConnectorError(raw: string): Pick<ConnectorTestResult, 'status' | 'detail'> {
  if (/尚未安装|无法运行|ENOENT|not found|cannot find/i.test(raw)) {
    return { status: 'missing-runtime', detail: '本机缺少运行程序。到“设置 → 运行环境”检查并安装后重试。' };
  }
  if (/请先配置|令牌|密钥|API.?Key|401|403/i.test(raw)) {
    return { status: 'needs-setup', detail: '还需要填写访问凭据或开通权限；当前配置已保留。' };
  }
  if (/429|限流|too many requests/i.test(raw)) {
    return { status: 'retry', detail: '服务暂时限流，稍后重试即可。' };
  }
  if (/fetch failed|network|socket|timed out|timeout|超时|ECONN|ENET|502|503|504/i.test(raw)) {
    return { status: 'retry', detail: '网络或服务暂时不可用，配置没有丢失；请稍后重试或检查代理。' };
  }
  if (/404|没有找到这个连接器地址/i.test(raw)) {
    return { status: 'failed', detail: '没有找到服务地址，请检查接口路径。' };
  }
  return { status: 'failed', detail: '连接测试没有完成，请展开配置核对后重试。' };
}

export function registerConnectorHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IPC.CONNECTOR_TEST, safeWrap(async (_event, name: string): Promise<ConnectorTestResult> => {
    const started = Date.now();
    const config = getRuntimeMcpServers().find(item => item.name === name);
    if (!config) throw new Error('没有找到这个连接器，请先保存配置');
    const entry = connectorEntry(name);
    try {
      let detail: string;
      let status: ConnectorTestResult['status'] = 'ready';
      // 历史配置保存的 arXiv / GitHub / 时间连接器可能没有 native 标记；
      // 与运行器保持同一套目录判断，升级后无需用户删掉再重新添加。
      const nativeNames = new Set(['arxiv', 'crossref', 'openalex', 'semantic-scholar', 'world-bank', 'open-meteo', 'huggingface-datasets', 'zenodo', 'orcid', 'google-drive', 'github', 'gitlab', 'gitee', 'python', 'r', 'octave', 'webhook', 'time']);
      if (config.native || nativeNames.has(config.name)) detail = await testNativeConnector(config);
      else if (config.transport === 'stdio') {
        const launcher = resolveStdioLauncher(config.command!, config.args);
        await execFileAsync(launcher.command, ['--version'], { timeout: 12_000, windowsHide: true });
        status = 'launcher-ready';
        detail = '本地启动器可以运行；连接器服务会在下一轮对话中加载，首次使用可能还需要下载依赖。';
      } else {
        const response = await fetch(config.url!, { method: 'HEAD', signal: AbortSignal.timeout(12_000) });
        if (!response.ok && response.status !== 405) throw new Error(`远程服务返回 ${response.status}`);
        status = 'launcher-ready';
        detail = '远程地址可以访问；工具列表会在下一轮对话中加载。';
      }
      return { ok: true, status, name, displayName: entry?.displayName, detail, checkedAt: Date.now(), latencyMs: Date.now() - started };
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      return { ok: false, ...classifyConnectorError(raw), name, displayName: entry?.displayName, checkedAt: Date.now(), latencyMs: Date.now() - started };
    }
  }, '测试连接器'));
}
