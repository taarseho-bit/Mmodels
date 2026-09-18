/**
 * 邮件通知。
 *
 * ⚠️ 设计边界（重要，别越界）：
 *   邮件**只做通知**，不搬数据。正文里只有摘要与一个指向 /admin 的链接，
 *   日志片段与完整报告始终留在服务端，用户点链接来取。
 *
 *   为什么不把完整诊断包塞进附件：
 *     1. 报告上限 4 MB，带日志的邮件很容易被对方邮件网关拒收或进垃圾箱
 *     2. 邮件本身经过第三方邮件服务商，等于把数据多交给一方
 *     3. 邮件不可撤回，而服务端的数据可以按保留期清掉
 *
 *   ⚠️⚠️ 更不要做的事：把 SMTP 凭据放进**桌面客户端**直连发信。
 *   客户端的任何东西都会随安装包泄露，SMTP 凭据泄露 = 别人可以拿你的邮箱
 *   发垃圾邮件，你的发信域名/IP 会被拉黑，恢复起来非常麻烦。
 *   凭据只能待在服务端。
 *
 * 未配置 SMTP_HOST 时整个模块是空操作 —— 不配就不发信，不需要额外开关。
 */
import { createTransport, type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let to = '';
let from = '';
let enabled = false;

/** 内存里记一封邮件的时间戳，用来做发信频率上限（防灌爆邮箱） */
const sent: number[] = [];
const MAX_PER_HOUR = Number(process.env.MAIL_MAX_PER_HOUR ?? 20);

export function initMailer(): boolean {
  const host = (process.env.SMTP_HOST ?? '').trim();
  if (!host) {
    enabled = false;
    return false;
  }

  const port = Number(process.env.SMTP_PORT ?? 465);
  // 465 是隐式 TLS，587 是 STARTTLS —— 默认值跟着端口走，省一个必填项
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : port === 465;

  transporter = createTransport({
    host,
    port,
    secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    // 别让发信把请求挂死：连不上就快速失败，报告本身已经存好了
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  from = (process.env.MAIL_FROM ?? process.env.SMTP_USER ?? 'diagnostics@localhost').trim();
  to = (process.env.MAIL_TO ?? '').trim();
  if (!to) {
    console.warn('[mailer] 配置了 SMTP_HOST 但没配 MAIL_TO，邮件通知关闭');
    enabled = false;
    return false;
  }

  enabled = true;
  return true;
}

export function mailerEnabled(): boolean {
  return enabled;
}

function underRateLimit(): boolean {
  const now = Date.now();
  const hourAgo = now - 3600_000;
  while (sent.length && sent[0] < hourAgo) sent.shift();
  if (sent.length >= MAX_PER_HOUR) return false;
  sent.push(now);
  return true;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => {
    const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return m[c] ?? c;
  });
}

export interface NotifyInput {
  id: string;
  reason: string;
  contact?: string;
  appVersion: string;
  platform: string;
  osVersion: string;
  faultCount: number;
  faultLines: string[];
  adminUrl: string;
}

/**
 * 发一封新报告通知。
 *
 * ⚠️ 调用方**不要 await 后阻塞响应**：这里已经把所有异常吞掉，
 *    但发信本身可能要几秒，接口应当先回 200 再让它后台跑。
 */
export async function notifyNewReport(input: NotifyInput): Promise<boolean> {
  if (!enabled || !transporter) return false;
  if (!underRateLimit()) {
    console.warn('[mailer] 一小时内通知数已达上限，跳过本次邮件（报告已入库）');
    return false;
  }

  const faultHtml = input.faultLines.length
    ? '<ul style="margin:6px 0 0 18px;padding:0">' +
      input.faultLines.map((l) => '<li>' + esc(l) + '</li>').join('') +
      '</ul>'
    : '<span style="color:#888">（无）</span>';

  const html =
    '<div style="font:14px/1.7 -apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',sans-serif;color:#222">' +
    '<h2 style="font-size:16px;margin:0 0 12px">收到一份新的诊断报告</h2>' +
    '<table cellpadding="4" style="border-collapse:collapse;font-size:13px">' +
    '<tr><td style="color:#666">报告编号</td><td><code>' + esc(input.id) + '</code></td></tr>' +
    '<tr><td style="color:#666">提交时间</td><td>' + esc(new Date().toLocaleString('zh-CN', { hour12: false })) + '</td></tr>' +
    '<tr><td style="color:#666">应用版本</td><td>' + esc(input.appVersion) + '</td></tr>' +
    '<tr><td style="color:#666">系统</td><td>' + esc(input.platform + ' ' + input.osVersion) + '</td></tr>' +
    (input.contact ? '<tr><td style="color:#666">联系方式</td><td>' + esc(input.contact) + '</td></tr>' : '') +
    '<tr><td style="color:#666">故障条数</td><td>' + input.faultCount + '</td></tr>' +
    '</table>' +
    '<h3 style="font-size:14px;margin:16px 0 4px">用户描述</h3>' +
    '<blockquote style="margin:0;padding:8px 12px;background:#f5f5f6;border-left:3px solid #ccc;white-space:pre-wrap">' +
    (input.reason ? esc(input.reason) : '<span style="color:#888">（未填写）</span>') +
    '</blockquote>' +
    '<h3 style="font-size:14px;margin:16px 0 4px">故障摘要</h3>' +
    faultHtml +
    '<p style="margin-top:18px"><a href="' + esc(input.adminUrl) + '" ' +
    'style="display:inline-block;padding:7px 14px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">' +
    '在诊断台查看完整报告与日志</a></p>' +
    '<p style="color:#888;font-size:12px;margin-top:16px">' +
    '日志片段与完整报告保存在服务端，未随邮件发送。请按保留期策略处理后删除。' +
    '</p></div>';

  const text =
    '收到一份新的诊断报告\n\n' +
    '报告编号: ' + input.id + '\n' +
    '应用版本: ' + input.appVersion + '\n' +
    '系统: ' + input.platform + ' ' + input.osVersion + '\n' +
    '故障条数: ' + input.faultCount + '\n\n' +
    '用户描述:\n' + (input.reason || '（未填写）') + '\n\n' +
    '查看完整报告: ' + input.adminUrl + '\n';

  try {
    await transporter.sendMail({
      from,
      to,
      subject: '[MathModel 诊断] ' + (input.reason ? input.reason.slice(0, 40) : input.id),
      text,
      html,
    });
    console.log('[mailer] 已发送新报告通知 ' + input.id);
    return true;
  } catch (e) {
    // 发信失败**不影响**报告已入库这个事实，所以只记日志、不往上抛
    console.error('[mailer] 发送失败：', e instanceof Error ? e.message : e);
    return false;
  }
}
