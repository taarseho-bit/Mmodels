// 把原版主进程字符串表还原出的赛程 JSON 转成项目内的 TS 数据模块。
const fs = require('fs');

const src = fs.readFileSync('D:/softreg-源码/.unpack/_extract/main-decoded-longtext.txt', 'utf8');
const json = JSON.parse(src.match(/\[[\s\S]*\]/)[0]);

const OUT = 'D:/mathmodel-desktop/src/shared/competitions-data.ts';

const head = `/**
 * 赛事赛程数据 —— 逐字取自原版 MathModel 0.0.20 主进程字符串表。
 *
 * 还原方式：原版主进程 \`out/main/index.js\` 经 javascript-obfuscator
 * \`string-array-v1\` 混淆（6135 项字符串表），解码器 \`_0x627a\` 索引偏移 266。
 * 本项目已用 \`node:vm\` 完整还原，本条即原版内联的赛季数据集。
 *
 * 共 ${json.length} 条，覆盖 2026（已公布/预计）与 2027（预计）。
 * ⚠️ 数据为原版快照，日期以主办方通知为准（原版亦如此声明）。
 */

export type CompetitionCategory =
  | 'national'
  | 'regional'
  | 'international'
  | 'campus'
  | 'knowledge'
  | 'adjacent'
  | 'historical';

export type CompetitionStatus = 'scheduled' | 'estimated' | 'tba' | 'paused' | 'historical';

export type CompetitionAudience =
  | 'undergraduate'
  | 'vocational'
  | 'graduate'
  | 'teacher'
  | 'school'
  | 'other';

export type EventKind = 'registration' | 'competition' | 'submission';

export interface CompetitionEvent {
  kind: EventKind;
  label: string;
  start: string;
  end: string | null;
}

export interface CompetitionSource {
  title: string;
  url: string;
}

export interface Competition {
  id: string;
  seriesId: string;
  year: number;
  name: string;
  shortName: string;
  category: CompetitionCategory;
  audiences: CompetitionAudience[];
  organizer: string;
  eligibility: string;
  description: string;
  scheduleNote: string;
  status: CompetitionStatus;
  timeZone: string;
  websiteUrl: string | null;
  registrationUrl: string | null;
  sources: CompetitionSource[];
  events: CompetitionEvent[];
  verifiedAt: string;
  /** 预计赛程的参考月份（1-12） */
  estimatedMonths?: number[];
}

export const COMPETITIONS: Competition[] = `;

const body = JSON.stringify(json, null, 2);

const tail = `;

/** 分类展示名（取自原版 i18n 字典） */
export const CATEGORY_LABEL: Record<CompetitionCategory, string> = {
  national: '全国赛事',
  regional: '区域赛事',
  international: '国际赛事',
  campus: '校内赛事',
  knowledge: '知识竞赛',
  adjacent: '相关赛事',
  historical: '历史赛事',
};

/** 状态展示名（取自原版 i18n 字典） */
export const STATUS_LABEL: Record<CompetitionStatus, string> = {
  scheduled: '已公布',
  estimated: '预计赛程',
  tba: '赛程待定',
  paused: '已暂停',
  historical: '历史赛事',
};

/** 时间节点展示名（取自原版 i18n 字典） */
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  registration: '报名截止',
  competition: '比赛进行',
  submission: '提交截止',
};

/** 受众展示名 */
export const AUDIENCE_LABEL: Record<CompetitionAudience, string> = {
  undergraduate: '本科',
  vocational: '专科',
  graduate: '研究生',
  teacher: '教师',
  school: '中学',
  other: '不限',
};

/** 全部赛事系列（去掉年份后缀，用于「全部赛事」列表） */
export function competitionSeries(): Array<{ seriesId: string; name: string; shortName: string; category: CompetitionCategory }> {
  const seen = new Map<string, { seriesId: string; name: string; shortName: string; category: CompetitionCategory }>();
  for (const c of COMPETITIONS) {
    if (!seen.has(c.seriesId)) {
      seen.set(c.seriesId, {
        seriesId: c.seriesId,
        name: c.name,
        shortName: c.shortName,
        category: c.category,
      });
    }
  }
  return [...seen.values()];
}
`;

fs.writeFileSync(OUT, head + body + tail, 'utf8');
console.log('wrote ' + json.length + ' competitions -> ' + OUT);
