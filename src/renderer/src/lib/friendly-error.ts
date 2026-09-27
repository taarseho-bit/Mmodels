/**
 * 将底层异常转换成面向用户的简体中文提示。
 *
 * 技术细节仍会保留在主进程日志里；界面只告诉用户发生了什么、内容是否保留、
 * 下一步可以怎么做，避免把 API、Exit code 或英文堆栈直接展示出来。
 */
export function friendlyError(error: unknown, fallback = '这一步没有完成，内容已保留，可以重试。'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const text = raw.toLowerCase();
  if (!raw.trim()) return fallback;
  if (/document|unsupported.*content|不支持.*文件|cannot.*continue/.test(text)) return '当前模型暂时不能直接读取这种文件，正在等待转换后再试。';
  if (/timeout|timed out|超时|etimedout/.test(text)) return '处理时间有点长，内容已保留，可以稍后重试。';
  if (/enoent|not found|找不到|不存在|no such file/.test(text)) return '没有找到需要的文件或模板，请检查项目文件后重试。';
  if (/eacces|permission|denied|权限/.test(text)) return '当前文件夹没有访问权限，请换一个位置或重新授权。';
  if (/network|fetch|socket|连接|代理|dns/.test(text)) return '暂时连不上服务，内容已保留，可以检查网络后重试。';
  if (/template|模板/.test(text)) return '论文模板暂时没有找到，请在比赛信息中重新选择。';
  if (/授权|会员|令牌|license|entitlement|token/.test(text)) return '当前版本需要有效授权，请到“设置 → 账号与授权”登录或续费后再试。';
  if (/exit code|退出码|process exited|进程/.test(text)) return '这一步没有正常完成，已保留当前结果，可以重试。';
  if (/busy|already running|正在运行|已有.*任务/.test(text)) return '上一项工作还在收尾，请稍等片刻再试。';
  return fallback;
}
