/**
 * 存储层：JSONL + 每报告一个文件。
 *
 * 为什么不用数据库：
 *   诊断服务的起步量级（每天几万条以内）用不上数据库，
 *   而文件方案有三个实际好处：
 *     1. 零原生依赖 —— Docker 镜像不用编译 better-sqlite3
 *     2. 备份就是拷目录
 *     3. 出问题时可以直接 cat 文件排查，不用装客户端
 *
 * 什么时候该换掉：每天事件量到百万级，或需要多实例写入。
 * 那时换 PostgreSQL / ClickHouse，本文件的接口保持不变即可。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

let DATA_DIR = '';
let TELEMETRY_DIR = '';
let REPORTS_DIR = '';

/** 只允许 UUID / 十六进制短串做文件名，杜绝路径穿越 */
const SAFE_ID = /^[a-zA-Z0-9_-]{4,64}$/;

function dayKey(d = new Date()): string {
  // 用 UTC 日期分文件：凌晨跨时区时不会把一个自然日切成两半
  return d.toISOString().slice(0, 10);
}

export function initStore(dataDir: string): void {
  DATA_DIR = dataDir;
  TELEMETRY_DIR = join(dataDir, 'telemetry');
  REPORTS_DIR = join(dataDir, 'reports');
  mkdirSync(TELEMETRY_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// 遥测事件
// ─────────────────────────────────────────────────────────────

export function appendEvents(events: unknown[]): number {
  if (events.length === 0) return 0;
  const file = join(TELEMETRY_DIR, dayKey() + '.jsonl');
  // 一行一条：追加写天然并发安全（单进程下），也不会因为一次写入失败毁掉整文件
  const payload = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(file, payload, 'utf8');
  return events.length;
}

function telemetryFiles(): { path: string; day: string }[] {
  if (!existsSync(TELEMETRY_DIR)) return [];
  return readdirSync(TELEMETRY_DIR)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()
    .map((n) => ({ path: join(TELEMETRY_DIR, n), day: n.replace('.jsonl', '') }));
}

/** 按天 × 事件名做计数。量级不大时全量扫一遍最简单可靠。 */
export function stats(days: number): {
  byDay: { day: string; total: number }[];
  byName: { name: string; count: number }[];
  versions: { version: string; count: number }[];
} {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byDay: { day: string; total: number }[] = [];
  const nameMap = new Map<string, number>();
  const verMap = new Map<string, number>();

  for (const f of telemetryFiles()) {
    if (f.day < cutoff) continue;
    let total = 0;
    let text = '';
    try {
      text = readFileSync(f.path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      total++;
      try {
        const e = JSON.parse(line) as { name?: string; appVersion?: string };
        if (e.name) nameMap.set(e.name, (nameMap.get(e.name) ?? 0) + 1);
        if (e.appVersion) verMap.set(e.appVersion, (verMap.get(e.appVersion) ?? 0) + 1);
      } catch {
        /* 坏行跳过，不让一行脏数据毁掉整个统计 */
      }
    }
    byDay.push({ day: f.day, total });
  }

  return {
    byDay,
    byName: [...nameMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    versions: [...verMap.entries()].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
  };
}

// ─────────────────────────────────────────────────────────────
// 诊断报告
// ─────────────────────────────────────────────────────────────

export function saveReport(report: Record<string, unknown>): string {
  const id = String(report.id ?? '');
  if (!SAFE_ID.test(id)) throw new Error('报告 id 非法');
  writeFileSync(join(REPORTS_DIR, id + '.json'), JSON.stringify(report, null, 2), 'utf8');
  return id;
}

export interface ReportSummary {
  id: string;
  createdAt: string;
  reason: string;
  appVersion: string;
  platform: string;
  faultCount: number;
  receivedAt: number;
}

export function listReports(limit: number): ReportSummary[] {
  if (!existsSync(REPORTS_DIR)) return [];
  const files = readdirSync(REPORTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => ({ n, p: join(REPORTS_DIR, n) }))
    .map((x) => {
      let mtime = 0;
      try {
        mtime = statSync(x.p).mtimeMs;
      } catch {
        /* 读不到就排最后 */
      }
      return { ...x, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime) // 最新的排前
    .slice(0, limit);

  const out: ReportSummary[] = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(f.p, 'utf8')) as Record<string, unknown>;
      const app = (r.app ?? {}) as Record<string, unknown>;
      const system = (r.system ?? {}) as Record<string, unknown>;
      const faults = Array.isArray(r.faults) ? r.faults : [];
      out.push({
        id: String(r.id ?? f.n.replace('.json', '')),
        createdAt: String(r.createdAt ?? ''),
        reason: String(r.reason ?? ''),
        appVersion: String(app.version ?? ''),
        platform: String(sys_platform(system)),
        faultCount: faults.length,
        receivedAt: f.mtime,
      });
    } catch {
      /* 坏文件跳过 */
    }
  }
  return out;
}

function sys_platform(system: Record<string, unknown>): string {
  const p = system.platform ?? '';
  const a = system.arch ?? '';
  return p && a ? p + '/' + a : '';
}

export function getReport(id: string): Record<string, unknown> | null {
  if (!SAFE_ID.test(id)) return null;
  const p = join(REPORTS_DIR, id + '.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function deleteReport(id: string): boolean {
  if (!SAFE_ID.test(id)) return false;
  const p = join(REPORTS_DIR, id + '.json');
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  return true;
}

// ─────────────────────────────────────────────────────────────
// 保留期清理
// ─────────────────────────────────────────────────────────────

/** 删掉超过保留期的遥测分片与报告；返回删除数量，便于启动日志里交代清楚 */
export function runRetention(retentionDays: number): { telemetry: number; reports: number } {
  const cutoff = Date.now() - retentionDays * 86400000;
  let telemetry = 0;
  let reports = 0;

  for (const f of telemetryFiles()) {
    // 按文件日期判断，而不是 mtime —— 老分片可能因为迁移被"刷新"过 mtime
    if (new Date(f.day + 'T23:59:59Z').getTime() < cutoff) {
      try {
        rmSync(f.path, { force: true });
        telemetry++;
      } catch {
        /* 单个删不掉不影响其余 */
      }
    }
  }

  if (existsSync(REPORTS_DIR)) {
    for (const n of readdirSync(REPORTS_DIR).filter((x) => x.endsWith('.json'))) {
      const p = join(REPORTS_DIR, n);
      try {
        if (statSync(p).mtimeMs < cutoff) {
          rmSync(p, { force: true });
          reports++;
        }
      } catch {
        /* 忽略 */
      }
    }
  }

  return { telemetry, reports };
}

/** 数据目录总体积，给 /health 与 /admin 用 */
export function dataSizeBytes(): number {
  let total = 0;
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else total += st.size;
      } catch {
        /* 忽略 */
      }
    }
  };
  walk(DATA_DIR);
  return total;
}
