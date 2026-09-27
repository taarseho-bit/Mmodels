import type { ConnectorCategory, McpServerConfig } from './types';

export interface ConnectorCatalogEntry {
  key: string;
  displayName: string;
  category: ConnectorCategory;
  description: string;
  capabilities: string[];
  native?: boolean;
  readOnly: boolean;
  auth: 'none' | 'token' | 'oauth' | 'local';
  sourceUrl?: string;
  credentials?: Array<{ key: string; label: string; placeholder: string }>;
  server: Omit<McpServerConfig, 'name'>;
}

/**
 * 官方/公开数据源优先的连接器目录。
 * native 连接器由主进程内置适配器提供，不依赖用户再安装一个 MCP 包；
 * mcp 连接器保留给已有生态和用户自定义服务。
 */
export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    key: 'arxiv', displayName: 'arXiv 论文', category: 'literature',
    description: '检索数学、统计和计算机方向的预印本论文。',
    capabilities: ['论文搜索', '摘要与元数据', '全文下载'], native: false, readOnly: true, auth: 'none',
    sourceUrl: 'https://arxiv.org/',
    server: { transport: 'stdio', command: 'uvx', args: ['arxiv-mcp-server'], env: {} },
  },
  {
    key: 'context7', displayName: 'Context7 技术文档', category: 'research',
    description: '读取常用库的最新官方文档和版本示例。',
    capabilities: ['官方文档', '版本感知示例'], native: false, readOnly: true, auth: 'none',
    sourceUrl: 'https://context7.com/',
    server: { transport: 'http', url: 'https://mcp.context7.com/mcp', env: {} },
  },
  {
    key: 'memory', displayName: '项目记忆', category: 'research',
    description: '保存当前项目的研究结论和关键事实，跨会话继续使用。',
    capabilities: ['记录事实', '检索项目记忆'], native: false, readOnly: false, auth: 'local',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} },
  },
  {
    key: 'filesystem', displayName: '扩展文件访问', category: 'files',
    description: '在项目目录之外增加明确的白名单文件夹。',
    capabilities: ['目录浏览', '文件读写'], native: false, readOnly: false, auth: 'local',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], env: {} },
  },
  {
    key: 'crossref', displayName: 'Crossref 文献', category: 'literature',
    description: '查询 DOI、作者、期刊、引用和开放许可信息。',
    capabilities: ['DOI 查询', '论文检索', '参考文献', '许可信息'], native: true, readOnly: true, auth: 'none',
    sourceUrl: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
    server: { transport: 'http', url: 'https://api.crossref.org/', env: {}, native: true },
  },
  {
    key: 'openalex', displayName: 'OpenAlex 科研图谱', category: 'literature',
    description: '按主题、作者、机构和引用关系寻找科研资料。',
    capabilities: ['主题检索', '引用关系', '作者与机构', '研究趋势'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://docs.openalex.org/api',
    credentials: [{ key: 'OPENALEX_API_KEY', label: 'API Key（可选）', placeholder: '公开接口可留空' }],
    server: { transport: 'http', url: 'https://api.openalex.org/', env: {}, native: true },
  },
  {
    key: 'semantic-scholar', displayName: 'Semantic Scholar', category: 'literature',
    description: '查找相似论文、引用网络和参考文献。',
    capabilities: ['相似论文', '引用网络', '作者检索', '参考文献'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://api.semanticscholar.org/api-docs/',
    credentials: [{ key: 'SEMANTIC_SCHOLAR_API_KEY', label: 'API Key（可选）', placeholder: '没有也可以使用，但会有速率限制' }],
    server: { transport: 'http', url: 'https://api.semanticscholar.org/', env: {}, native: true },
  },
  {
    key: 'zotero', displayName: 'Zotero 文献库', category: 'literature',
    description: '读取本机 Zotero 文献库和笔记。',
    capabilities: ['文献库检索', '标签筛选', '笔记读取'], native: false, readOnly: true, auth: 'local',
    credentials: [
      { key: 'ZOTERO_LOCAL', label: '本地模式', placeholder: 'true' },
      { key: 'ZOTERO_API_KEY', label: 'API Key', placeholder: '本地模式可留空' },
      { key: 'ZOTERO_LIBRARY_ID', label: 'Library ID', placeholder: '本地模式可留空' },
    ],
    server: { transport: 'stdio', command: 'uvx', args: ['zotero-mcp'], env: {} },
  },
  {
    key: 'world-bank', displayName: '世界银行指标', category: 'datasets',
    description: '获取人口、经济、教育、医疗和能源等全球时间序列。',
    capabilities: ['指标搜索', '国家比较', '时间序列', 'CSV 数据'], native: true, readOnly: true, auth: 'none',
    sourceUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392',
    server: { transport: 'http', url: 'https://api.worldbank.org/v2/', env: {}, native: true },
  },
  {
    key: 'open-meteo', displayName: 'Open-Meteo 气象', category: 'datasets',
    description: '获取历史天气、预报和多地点气象数据。',
    capabilities: ['天气预报', '历史数据', '多地点比较', '时间序列'], native: true, readOnly: true, auth: 'none',
    sourceUrl: 'https://open-meteo.com/',
    server: { transport: 'http', url: 'https://api.open-meteo.com/', env: {}, native: true },
  },
  {
    key: 'huggingface-datasets', displayName: 'Hugging Face 数据集', category: 'datasets',
    description: '搜索、预览和按分片读取公开数据集。',
    capabilities: ['数据集搜索', '预览前几行', '统计信息', '分片下载'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://huggingface.co/docs/dataset-viewer/quick_start',
    credentials: [{ key: 'HF_TOKEN', label: '访问令牌（可选）', placeholder: '公开数据集可留空' }],
    server: { transport: 'http', url: 'https://huggingface.co/', env: {}, native: true },
  },
  {
    key: 'zenodo', displayName: 'Zenodo 科研资料', category: 'research',
    description: '检索带 DOI 的论文附件、数据集、代码和实验记录。',
    capabilities: ['记录搜索', '文件下载', '版本查看', 'DOI 信息'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://developers.zenodo.org/',
    credentials: [{ key: 'ZENODO_TOKEN', label: '访问令牌（写入时需要）', placeholder: '只读检索可以留空' }],
    server: { transport: 'http', url: 'https://zenodo.org/api/', env: {}, native: true },
  },
  {
    key: 'orcid', displayName: 'ORCID 作者信息', category: 'research',
    description: '区分同名作者，补全公开作者和研究信息。',
    capabilities: ['作者检索', '公开记录', '身份消歧'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://info.orcid.org/what-is-orcid/services/public-api/',
    credentials: [{ key: 'ORCID_ACCESS_TOKEN', label: '访问令牌（可选）', placeholder: '公开查询可留空' }],
    server: { transport: 'http', url: 'https://pub.orcid.org/', env: {}, native: true },
  },
  {
    key: 'google-drive', displayName: 'Google Drive 项目文件', category: 'files',
    description: '读取当前项目文件夹中的共享题目、数据和论文。',
    capabilities: ['文件搜索', '目录浏览', '文件下载'], native: true, readOnly: true, auth: 'oauth',
    sourceUrl: 'https://developers.google.com/workspace/drive/api/guides/about-files',
    credentials: [{ key: 'GOOGLE_DRIVE_ACCESS_TOKEN', label: '访问令牌', placeholder: '粘贴 OAuth access token' }],
    server: { transport: 'http', url: 'https://www.googleapis.com/drive/v3/', env: {}, native: true },
  },
  {
    key: 'github', displayName: 'GitHub 项目协作', category: 'code',
    description: '读取仓库、Issue、提交记录和建模脚本。',
    capabilities: ['仓库文件', 'Issue', '提交记录'], native: false, readOnly: true, auth: 'token',
    credentials: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: '访问令牌', placeholder: '只读令牌即可' }],
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: {} },
  },
  {
    key: 'gitlab', displayName: 'GitLab 项目协作', category: 'code',
    description: '连接 GitLab 仓库，管理代码和实验版本。',
    capabilities: ['项目搜索', '文件读取', '提交记录'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://docs.gitlab.com/ee/api/',
    credentials: [{ key: 'GITLAB_TOKEN', label: '访问令牌', placeholder: '只读令牌即可' }, { key: 'GITLAB_BASE_URL', label: '服务地址', placeholder: 'https://gitlab.com' }],
    server: { transport: 'http', url: 'https://gitlab.com/api/v4/', env: {}, native: true },
  },
  {
    key: 'gitee', displayName: 'Gitee 项目协作', category: 'code',
    description: '连接 Gitee 仓库，适合国内代码和论文版本管理。',
    capabilities: ['项目搜索', '文件读取', '提交记录'], native: true, readOnly: true, auth: 'token',
    sourceUrl: 'https://gitee.com/api/v5/swagger',
    credentials: [{ key: 'GITEE_TOKEN', label: '访问令牌', placeholder: '只读令牌即可' }],
    server: { transport: 'http', url: 'https://gitee.com/api/v5/', env: {}, native: true },
  },
  {
    key: 'python', displayName: 'Python 本地计算', category: 'compute',
    description: '在当前项目环境中运行数据分析、优化和绘图脚本。',
    capabilities: ['运行脚本', '生成图表', '保存结果'], native: true, readOnly: false, auth: 'local',
    server: { transport: 'http', url: 'local://python', env: {}, native: true },
  },
  {
    key: 'r', displayName: 'R 语言统计', category: 'compute',
    description: '运行统计检验、回归、时间序列和科研绘图。',
    capabilities: ['统计分析', '回归', '时间序列', '科研绘图'], native: true, readOnly: false, auth: 'local',
    server: { transport: 'http', url: 'local://r', env: {}, native: true },
  },
  {
    key: 'octave', displayName: 'Octave / MATLAB 兼容', category: 'compute',
    description: '运行优化、仿真和矩阵计算。',
    capabilities: ['优化', '仿真', '矩阵计算'], native: true, readOnly: false, auth: 'local',
    server: { transport: 'http', url: 'local://octave', env: {}, native: true },
  },
  {
    key: 'fetch', displayName: '网页资料抓取', category: 'research',
    description: '读取公开网页并转成适合模型阅读的内容。',
    capabilities: ['网页读取', '文本提取', '来源链接'], native: false, readOnly: true, auth: 'none',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {} },
  },
  {
    key: 'time', displayName: '时间与时区', category: 'utility',
    description: '统一竞赛截止时间、协作时间和自动化提醒。',
    capabilities: ['时区转换', '时间查询', '截止时间换算'], native: false, readOnly: true, auth: 'none',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-time'], env: {} },
  },
  {
    key: 'webhook', displayName: 'Webhook 通知', category: 'collaboration',
    description: '把项目完成、审阅结果或提醒发送到兼容 Webhook 的协作工具。',
    capabilities: ['发送完成提醒', '发送简短摘要'], native: true, readOnly: false, auth: 'token',
    credentials: [{ key: 'WEBHOOK_URL', label: 'Webhook 地址', placeholder: '仅在确认后发送' }, { key: 'WEBHOOK_TOKEN', label: '访问令牌（可选）', placeholder: 'Bearer 令牌' }],
    server: { transport: 'http', url: 'local://webhook', env: {}, native: true },
  },
];

export const CONNECTOR_CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  literature: '文献与引用',
  datasets: '数据源',
  research: '科研资料',
  files: '项目文件',
  code: '代码与版本',
  compute: '本地计算',
  collaboration: '通知与协作',
  utility: '辅助工具',
};

export function connectorEntry(name: string): ConnectorCatalogEntry | undefined {
  return CONNECTOR_CATALOG.find(item => item.key === name);
}
