/** 纯模型故障判定，单独放置以便在无 Electron 环境中验证。 */
export function isRetryableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const text = message.toLowerCase();
  if (!text) return false;
  if (/技能|skill|权限|permission|文件|路径|参数|tool_use|askuser|用户关闭/.test(text)) return false;
  return /(?:status\s*[:=]?\s*(?:408|409|425|429|500|502|503|504))|\b(?:408|409|429|500|502|503|504)\b|timeout|timed? out|超时|网络|network|fetch failed|econn|enotfound|socket|连接.*(?:失败|断开)|upstream|模型.*(?:不存在|不可用|暂时不可用)/.test(text);
}

