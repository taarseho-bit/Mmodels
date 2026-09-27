/**
 * MModels 赛事赛程数据。数据按公开赛事通知整理，字段统一供比赛工作台、倒计时和项目配置使用。
 *
 * 共 114 条，覆盖已公布、预计和待确认的赛程。
 * ⚠️ 数据为数据快照，日期以主办方通知为准（应用约定亦如此声明）。
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
  /** 预计赛程的参考月份（形如 "2027-04"，来自项目资料） */
  estimatedMonths?: string[];
}

export const COMPETITIONS: Competition[] = [
  {
    "id": "A01-2026",
    "seriesId": "A01",
    "year": 2026,
    "name": "高教社杯全国大学生数学建模竞赛（CUMCM／国赛）",
    "shortName": "国赛 CUMCM",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational"
    ],
    "organizer": "中国工业与应用数学学会",
    "eligibility": "本科、专科",
    "description": "通常 3 名同校学生，经学校、赛区组织报名；全国系统学生资格审查截止 09-07 20:00，学校往往更早；论文建模。",
    "scheduleNote": "2026-09-10 18:00—09-13 20:00；已核 2026。主办学会通知 PDF、组委会报名参赛须知 PDF（高校存档）、官网",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.mcm.edu.cn/?key=cncjmm",
    "registrationUrl": null,
    "sources": [
      {
        "title": "主办学会通知 PDF",
        "url": "https://www.csiam.org.cn/upload/shuxue/69c3870950b04.pdf"
      },
      {
        "title": "组委会报名参赛须知 PDF（高校存档）",
        "url": "https://hs.nufe.edu.cn/_upload/article/files/18/93/be02942d440da93e7786230a433a/ff94902a-2505-493b-9025-7ee5fd6b2a0a.pdf"
      },
      {
        "title": "官网",
        "url": "https://www.mcm.edu.cn/?key=cncjmm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-09-10T18:00:00+08:00",
        "end": "2026-09-13T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A02-2026",
    "seriesId": "A02",
    "year": 2026,
    "name": "华为杯中国研究生数学建模竞赛",
    "shortName": "华为杯",
    "category": "national",
    "audiences": [
      "graduate"
    ],
    "organizer": "中国学位与研究生教育学会、中国科协青少年科技中心；2026 西安交大承办",
    "eligibility": "硕博研究生及符合条件的拟入学研究生",
    "description": "团队论文赛；报名 06-01 08:00—09-19 17:00，资格审核另有节点；与本科国赛不同。",
    "scheduleNote": "2026-09-23 08:00—09-27 12:00；已核 2026。重庆大学转发参赛通知、中科大通知、官方入口",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://cpipc.acge.org.cn/cw/hp/4",
    "registrationUrl": "https://cpipc.acge.org.cn/cw/hp/4",
    "sources": [
      {
        "title": "重庆大学转发参赛通知",
        "url": "https://graduate.cqu.edu.cn/info/1394/19117.htm"
      },
      {
        "title": "中科大通知",
        "url": "https://gradschool.ustc.edu.cn/article/3487"
      },
      {
        "title": "官方入口",
        "url": "https://cpipc.acge.org.cn/cw/hp/4"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-09-19T17:00:00+08:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-09-23T08:00:00+08:00",
        "end": "2026-09-27T12:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A03-2026",
    "seriesId": "A03",
    "year": 2026,
    "name": "MathorCup 数学应用挑战赛（原高校数学建模挑战赛）",
    "shortName": "MathorCup",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "teacher"
    ],
    "organizer": "中国优选法统筹法与经济数学研究会",
    "eligibility": "本专研及高校教师赛组",
    "description": "报名截至 04-16 12:00；1—3 人，2026 主赛不允许跨校；200 元／队；企业实际问题建模。",
    "scheduleNote": "2026-04-17 08:00—04-21 09:00；已核 2026。官方赛题公告、组委会报名页",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "官方赛题公告",
        "url": "https://www.mathorcup.org/detail/2487"
      },
      {
        "title": "组委会报名页",
        "url": "https://sta.saikr.com/mathorcup2026"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-04-17T08:00:00+08:00",
        "end": "2026-04-21T09:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A04-2026",
    "seriesId": "A04",
    "year": 2026,
    "name": "MathorCup 数学应用挑战赛—大数据竞赛",
    "shortName": "MathorCup 大数据",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "中国优选法统筹法与经济数学研究会",
    "eligibility": "本专研",
    "description": "09-03 已发布本届通知；报名截至 10-23 12:00；1—3 人，允许跨校；200 元／队；论文、代码、数据结果，后续答辩，2027 年 1 月公布获奖名单。",
    "scheduleNote": "2026 初赛 10-23 18:00—10-30 20:00；复赛 12-04 18:00—12-11 20:00；已核 2026，已读取官方 PDF。报名公告、完整通知与章程 PDF",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "报名公告",
        "url": "https://mathorcup.org/detail/2494"
      },
      {
        "title": "完整通知与章程 PDF",
        "url": "https://files.mathorcup.org/uploads/files/20260903/1788430033944665.pdf"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-10-23T12:00:00+08:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "初赛",
        "start": "2026-10-23T18:00:00+08:00",
        "end": "2026-10-30T20:00:00+08:00"
      },
      {
        "kind": "competition",
        "label": "复赛",
        "start": "2026-12-04T18:00:00+08:00",
        "end": "2026-12-11T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A05-2026",
    "seriesId": "A05",
    "year": 2026,
    "name": "中国电机工程学会杯全国大学生电工数学建模竞赛（电工杯）",
    "shortName": "电工杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "中国电机工程学会，东北电力大学等承办",
    "eligibility": "普通高校全日制学生",
    "description": "报名截至 05-20 23:59；同校最多 3 人；电力、能源及相关工程应用论文建模。",
    "scheduleNote": "2026-05-22—05-25；已核 2026，赛题及成绩公告互证。承办高校赛事官网",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://shumo.neepu.edu.cn/tzgg.htm",
    "registrationUrl": null,
    "sources": [
      {
        "title": "承办高校赛事官网",
        "url": "https://shumo.neepu.edu.cn/tzgg.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-22",
        "end": "2026-05-25"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A06-2026",
    "seriesId": "A06",
    "year": 2026,
    "name": "泰迪杯数据挖掘挑战赛",
    "shortName": "泰迪杯数据挖掘",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "广东泰迪智能科技股份有限公司及组委会",
    "eligibility": "本专研",
    "description": "报名 02-01—04-10；不同题目另有 04-21、04-25、04-28 测试节点；同校 1—3 人，200 元／队；数据分析、算法及应用方案。",
    "scheduleNote": "2026-02-01 开题；04-24 16:00 论文截止；06-06 答辩；已核 2026；不能把所有赛题统一写成“04-24 全部结束”。本届竞赛规程、成绩公告",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届竞赛规程",
        "url": "https://www.tipdm.org/dssj14/2527.jhtml"
      },
      {
        "title": "成绩公告",
        "url": "https://www.tipdm.org/dssj14/2532.jhtml"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "开题与论文赛",
        "start": "2026-02-01",
        "end": "2026-04-24"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2026-04-24T16:00:00+08:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "答辩",
        "start": "2026-06-06",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A07-2026",
    "seriesId": "A07",
    "year": 2026,
    "name": "全国大学生统计建模大赛",
    "shortName": "统计建模大赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate"
    ],
    "organizer": "中国统计教育学会；2026 内蒙古财经大学承办国赛",
    "eligibility": "本科生、研究生分组",
    "description": "围绕主题开展统计建模研究，论文评审；校赛、省赛、国赛层层组织；各省及学校截止不同。",
    "scheduleNote": "2026 年 3 月通知启动；7 月已公布国赛入围名单；已核 2026，完整最终赛程部分待核。本届通知、通知 PDF、国赛入围公告",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届通知",
        "url": "https://www.ai-learning.net/dstz/37119.jhtml"
      },
      {
        "title": "通知 PDF",
        "url": "https://cmswebsite.ai-learning.net/u/cms/tjjmds/202603/10170642sbi1.pdf"
      },
      {
        "title": "国赛入围公告",
        "url": "https://www.ai-learning.net/dsdt/37134.jhtml"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A08-2026",
    "seriesId": "A08",
    "year": 2026,
    "name": "华中杯大学生数学建模挑战赛",
    "shortName": "华中杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "湖北省工业与应用数学学会",
    "eligibility": "普通高校全日制在校生",
    "description": "报名 03-10 12:00—04-23 12:00；同校不超过 3 人；150 元／队；面向全国，不限湖北。",
    "scheduleNote": "2026-04-23 18:00—04-26 20:00；已核 2026 转发通知及赛后记录；转发页评审日期有旧年份残留，未采用。组委会通知转发、官网入口、赛后公告转发",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "http://hzbmmc.com",
    "registrationUrl": null,
    "sources": [
      {
        "title": "组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/tz/405.html"
      },
      {
        "title": "官网入口",
        "url": "http://hzbmmc.com"
      },
      {
        "title": "赛后公告转发",
        "url": "https://www.cmathc.org.cn/mcm/hjmd/534.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-04-23T18:00:00+08:00",
        "end": "2026-04-26T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A09-2026",
    "seriesId": "A09",
    "year": 2026,
    "name": "华东杯大学生数学建模邀请赛",
    "shortName": "华东杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "复旦大学数学科学学院、华东地区数学建模联盟组织",
    "eligibility": "全国高校在校学生",
    "description": "报名 04-19 09:00—04-30 18:00；每队不超过 3 人；论文赛，“邀请赛”名称不等于仅限华东学校。",
    "scheduleNote": "2026-04-30 20:00—05-04 20:00；已核 2026。复旦大学通知、指定报名页",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "复旦大学通知",
        "url": "https://math.fudan.edu.cn/db/89/c33035a777097/page.htm"
      },
      {
        "title": "指定报名页",
        "url": "https://www.saikr.com/vse/hdmcm/2026"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-04-30T20:00:00+08:00",
        "end": "2026-05-04T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A10-2026",
    "seriesId": "A10",
    "year": 2026,
    "name": "五一数学建模竞赛",
    "shortName": "五一数学建模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "school"
    ],
    "organizer": "中国矿业大学、江苏省工业与应用数学学会、徐州市工业与应用数学学会",
    "eligibility": "高中生及高校本专研",
    "description": "报名 04-02 08:00—04-30 24:00；同校 1—3 人，100 元／队；开放命题论文赛。",
    "scheduleNote": "2026-05-01 10:00—05-04 12:00；已核 2026。中国矿业大学赛事通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "中国矿业大学赛事通知",
        "url": "https://51mcm.cumt.edu.cn/8d/20/c14143a691488/page.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-01T10:00:00+08:00",
        "end": "2026-05-04T12:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A11-2026",
    "seriesId": "A11",
    "year": 2026,
    "name": "数维杯大学生数学建模挑战赛·春季赛",
    "shortName": "数维杯春季赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "春季届次由当届数维杯组委会组织",
    "eligibility": "高校学生",
    "description": "本届第十一届；建模论文赛；比赛作答截止与最后上传节点应分别保存。",
    "scheduleNote": "2026-05-08 09:00—05-11 09:00；提交截至 10:00；已核 2026。不要把秋季新主办方回填至春季。赛题公告索引、本届成绩公告",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "赛题公告索引",
        "url": "https://www.nmmcm.org.cn/Awards/"
      },
      {
        "title": "本届成绩公告",
        "url": "https://www.nmmcm.org.cn/Awards/188.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-08T09:00:00+08:00",
        "end": "2026-05-11T09:00:00+08:00"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2026-05-11T10:00:00+08:00",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A12-2026",
    "seriesId": "A12",
    "year": 2026,
    "name": "数维杯全国大学生数学建模挑战赛·秋季赛",
    "shortName": "数维杯秋季赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "自 2026 第十二届秋赛起，中国仿真学会、辽宁科技大学联合主办",
    "eligibility": "本专研",
    "description": "报名截至 11-20 06:00；1—3 人，可跨校；英文论文；2027 年 1 月中旬公布成绩。",
    "scheduleNote": "2026-11-20 09:00—11-24 09:00；论文提交截至 10:00；已核 2026。本届官网通知及规则、指定报名页",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.nmmcm.org.cn/Competition/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届官网通知及规则",
        "url": "https://www.nmmcm.org.cn/Competition/"
      },
      {
        "title": "指定报名页",
        "url": "https://www.mojinghub.com/competitions/swbmcm/2026"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-11-20T09:00:00+08:00",
        "end": "2026-11-24T09:00:00+08:00"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2026-11-24T10:00:00+08:00",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A13-2026",
    "seriesId": "A13",
    "year": 2026,
    "name": "认证杯数学中国数学建模网络挑战赛",
    "shortName": "认证杯网络挑战赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate",
      "other"
    ],
    "organizer": "数学中国、内蒙古第五维信息技术有限公司",
    "eligibility": "大学生、研究生、毕业生及符合条件的初级数模爱好者",
    "description": "报名截至 04-09 17:00；两阶段统一报名，100 元／队，另有自选付费点评；大学生通常 1—3 人，可跨校。",
    "scheduleNote": "2026 第一阶段 04-09 20:00—04-12 20:00；第二阶段 05-14 20:00—05-17 20:00；已核 2026。“认证”是该赛事体系的命名，不能推导为国家职业认证。邀请函、规则",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "邀请函",
        "url": "https://www.tzmcm.cn/tz.html"
      },
      {
        "title": "规则",
        "url": "https://www.tzmcm.cn/gz.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "第一阶段",
        "start": "2026-04-09T20:00:00+08:00",
        "end": "2026-04-12T20:00:00+08:00"
      },
      {
        "kind": "competition",
        "label": "第二阶段",
        "start": "2026-05-14T20:00:00+08:00",
        "end": "2026-05-17T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A14-2026",
    "seriesId": "A14",
    "year": 2026,
    "name": "认证杯数学中国数学建模国际赛（CAMCM／小美赛）",
    "shortName": "认证杯国际赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "school",
      "other"
    ],
    "organizer": "数学中国赛事组织体系",
    "eligibility": "中学生、本专研、毕业生分组",
    "description": "2025 报名截至 11-28 00:00；200 元／队；不同年龄组的队员及指导教师要求不同。与 COMAP 美赛分别报名。",
    "scheduleNote": "往届：2025-11-28 08:00—12-02 08:00；往届参考，2026 赛程未核实。2025 竞赛规则",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "2025 竞赛规则",
        "url": "https://mcm.tzmcm.cn/gz.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A15-2026",
    "seriesId": "A15",
    "year": 2026,
    "name": "中青杯全国大学生数学建模竞赛",
    "shortName": "中青杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "中国国际科技促进会综合素质与职业发展教育专业委员会",
    "eligibility": "本专研",
    "description": "报名截至 06-04 12:00；分专科、本科、研究生组；论文赛。中国国际科技促进会为指导单位，具体主办是其专委会。",
    "scheduleNote": "2026-06-04 17:00—06-07 17:00；已核 2026。赛事官网与时间安排、赛后公示",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://zqb.52jingsai.com/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "赛事官网与时间安排",
        "url": "https://zqb.52jingsai.com/"
      },
      {
        "title": "赛后公示",
        "url": "https://zqb.52jingsai.com/prgs.php"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-06-04T17:00:00+08:00",
        "end": "2026-06-07T17:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A16-2026",
    "seriesId": "A16",
    "year": 2026,
    "name": "APMCM 亚太地区大学生数学建模竞赛·中文赛项",
    "shortName": "APMCM 中文赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "中国国际科技促进会物联网工作委员会、北京图象图形学学会等组织",
    "eligibility": "本专研",
    "description": "中文建模论文赛；与秋季英文赛有不同报名窗口和任务，不按重复网页去重掉。",
    "scheduleNote": "2026-06-12—06-15；已核 2026。本届赛后公告、官方通知索引",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届赛后公告",
        "url": "https://www.apmcm.org/detail/2511?language=en"
      },
      {
        "title": "官方通知索引",
        "url": "https://apmcm.org/list/news"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-06-12",
        "end": "2026-06-15"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A17-2026",
    "seriesId": "A17",
    "year": 2026,
    "name": "APMCM 亚太地区大学生数学建模竞赛·英文赛项",
    "shortName": "APMCM 英文赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "APMCM 组委会及当届主办单位",
    "eligibility": "高校学生",
    "description": "英文论文，常被作为英文数模训练；2026 中文赛已办，不代表英文赛日期已经确定。",
    "scheduleNote": "往届：2025 年 11 月，11-20 开赛；往届参考，2026 英文赛程未核实。往届报名通知与资讯、赛题及评奖",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届报名通知与资讯",
        "url": "https://apmcm.org/list/news"
      },
      {
        "title": "赛题及评奖",
        "url": "https://www.apmcm.org/list/problem_prize?language=cn"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A18-2026",
    "seriesId": "A18",
    "year": 2026,
    "name": "华数杯大学生数学建模竞赛",
    "shortName": "华数杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "天津市未来与预测科学研究会、华数杯组委会",
    "eligibility": "高校学生",
    "description": "报名页截至 08-07 12:00；200 元／队；中文建模论文与赛后评语。",
    "scheduleNote": "2026-08-07 18:00—08-10 20:00；已核 2026。组委会本届报名页、高校赛后报道",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "组委会本届报名页",
        "url": "https://m.saikr.com/vse/chinamcm26"
      },
      {
        "title": "高校赛后报道",
        "url": "https://www.hfuu.edu.cn/stxy/75/70/c11608a161136/page.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-08-07T18:00:00+08:00",
        "end": "2026-08-10T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A19-2026",
    "seriesId": "A19",
    "year": 2026,
    "name": "华数杯国际大学生数学建模竞赛",
    "shortName": "华数杯国际赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "天津市未来与预测科学研究会、华数杯组委会",
    "eligibility": "高校学生",
    "description": "通常 1—3 人组队；英文论文；与夏季华数杯是不同赛程。宣传中的“美赛选拔／热身”不等于 COMAP 官方晋级赛。",
    "scheduleNote": "2026-01-17 06:00—01-21 09:00；已核 2026。官方论文提交通知、本届报名入口、主办落款成绩公告",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "官方论文提交通知",
        "url": "https://m.saikr.com/contest/notice_detail/38621"
      },
      {
        "title": "本届报名入口",
        "url": "https://new.saikr.com/vse/mcmicm2026"
      },
      {
        "title": "主办落款成绩公告",
        "url": "https://m.saikr.com/contest/notice_detail/39346"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-01-17T06:00:00+08:00",
        "end": "2026-01-21T09:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A20-2026",
    "seriesId": "A20",
    "year": 2026,
    "name": "天府杯全国大学生数学建模竞赛",
    "shortName": "天府杯数模",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "四川省科学学与科技政策研究会、成都市航空航天学会",
    "eligibility": "高校、科研院所全日制在读学生",
    "description": "报名截至 08-20 12:00；1—3 人，120 元／队；论文赛；不限四川。",
    "scheduleNote": "2026-08-20 18:00—08-23 22:00；已核 2026；报名页退费条款有旧年份残留，未采为时间依据。组委会本届规则",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "组委会本届规则",
        "url": "https://m.saikr.com/vse/TFB2026"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-08-20T18:00:00+08:00",
        "end": "2026-08-23T22:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A21-2026",
    "seriesId": "A21",
    "year": 2026,
    "name": "天府杯全国大学生统计建模竞赛",
    "shortName": "天府杯统计建模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "四川省科学学与科技政策研究会、成都航空航天学会（公告落款）",
    "eligibility": "本专研分组",
    "description": "1—3 人；具体开始、提交时间尚未核清；与中国统计教育学会的“全国大学生统计建模大赛”分别建档。",
    "scheduleNote": "2026 年 4—5 月已举办，05-15 发布结果；已核 2026 存续及赛后结果，精确赛程部分待核。报名流程、成绩公告",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "报名流程",
        "url": "https://m.saikr.com/contest/notice_detail/42514"
      },
      {
        "title": "成绩公告",
        "url": "https://m.saikr.com/contest/notice_detail/42870"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A22-2026",
    "seriesId": "A22",
    "year": 2026,
    "name": "高斯杯全国大学生数学建模挑战赛",
    "shortName": "高斯杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate"
    ],
    "organizer": "高斯杯组委会，DataCastle 平台支持",
    "eligibility": "本科生、研究生",
    "description": "不超过 3 人，可跨校；较长周期的问题研究与作品提交；不能按固定三四天比赛展示。",
    "scheduleNote": "第九届：2025-12-22—2026-07-31；8 月评审；已核跨年赛季，页面主办仅列组委会，不补造学会背书。主办报名说明",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "主办报名说明",
        "url": "https://landing.datacastle.cn/gs/"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "作品征集",
        "start": "2025-12-22",
        "end": "2026-07-31"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A23-2026",
    "seriesId": "A23",
    "year": 2026,
    "name": "科创杯大学生数学建模竞赛·企业命题赛道",
    "shortName": "科创杯企业命题",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "创赛云（陕西）教育科技有限合伙企业主办，相关机构学术支持",
    "eligibility": "大学生",
    "description": "企业问题、建模与论文；同一品牌还有知识考试，赛制必须区分。",
    "scheduleNote": "2026 分赛区 07-15—07-20；国赛 08-25—08-30；已核 2026。本届官网及企业命题公告",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.simcm.org.cn/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届官网及企业命题公告",
        "url": "https://www.simcm.org.cn/"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "分赛区",
        "start": "2026-07-15",
        "end": "2026-07-20"
      },
      {
        "kind": "competition",
        "label": "国赛",
        "start": "2026-08-25",
        "end": "2026-08-30"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A24-2026",
    "seriesId": "A24",
    "year": 2026,
    "name": "大湾区杯粤港澳金融数学建模竞赛",
    "shortName": "大湾区杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "广东省工业与应用数学学会及组委会",
    "eligibility": "本专研",
    "description": "金融投资场景建模；同校不超过 3 人；比赛结束、作品提交、实测数据提交是不同节点。",
    "scheduleNote": "往届：2025-11-01—11-08；之后另有实测、答辩；往届参考，2026 赛程未核实。主办通知 PDF、2025 赛事公告汇总、作品提交说明 PDF",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "主办通知 PDF",
        "url": "https://www.tipdm.org/u/cms/www/202510/23105416uhw1.pdf"
      },
      {
        "title": "2025 赛事公告汇总",
        "url": "https://www.tipdm.org/dwjw6qjrsm/index.jhtml"
      },
      {
        "title": "作品提交说明 PDF",
        "url": "https://www.tipdm.org/u/cms/www/202510/311007057jz6.pdf"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A25-2026",
    "seriesId": "A25",
    "year": 2026,
    "name": "长三角高校数学建模竞赛",
    "shortName": "长三角高校数模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "浙江省数学会",
    "eligibility": "中国及境外本专研",
    "description": "报名截至 05-14 08:00；不超过 3 人，200 元／队；不限长三角地区。",
    "scheduleNote": "2026-05-14 08:00—05-18 08:00；论文截至 10:00；已核 2026 赛程；同页章程与报名说明对“是否允许跨校”表述冲突，此项待组委会确认。北京理工大学长三角研究院通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "北京理工大学长三角研究院通知",
        "url": "https://jiaxing.bit.edu.cn/fwzn/tzgg/4b9857c3b96e404a9987cf456eafb5ca.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-14T08:00:00+08:00",
        "end": "2026-05-18T08:00:00+08:00"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2026-05-18T10:00:00+08:00",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A26-2026",
    "seriesId": "A26",
    "year": 2026,
    "name": "农林杯高校数学建模竞赛",
    "shortName": "农林杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "北京农学院主办，天津农学院等多校承办",
    "eligibility": "农林及参与组织院校的本专研",
    "description": "报名 04-15—05-25 12:00；农业、生态、农林应用论文；校际组织属性明显，外校报名资格应按本届规程确认。",
    "scheduleNote": "2026-05-25 12:00—05-31 18:00；已核 2026。组委会本届页面",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "组委会本届页面",
        "url": "https://m.saikr.com/vse/NLB/2026"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-25T12:00:00+08:00",
        "end": "2026-05-31T18:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A27-2026",
    "seriesId": "A27",
    "year": 2026,
    "name": "数学周报全国大学生数学建模大赛",
    "shortName": "数学周报数模大赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "other"
    ],
    "organizer": "数学周报社",
    "eligibility": "全国大学生及年满 18 周岁的相关社会人士",
    "description": "报名截至 11-26；100 元／队；统一命题、提交论文。与“数学能力大赛—数学建模赛道”的考试项目是不同活动。",
    "scheduleNote": "第五届：2026-11-27 00:00—11-29 24:00；已核 2026，直接读取组委会报名页；页面顶部 23:59 与正文 24:00 存在显示精度差异，自动提醒前应确认。本届报名规则",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届报名规则",
        "url": "https://m.saikr.com/vse/MW26MM"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-11-27",
        "end": "2026-11-29"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A28-2026",
    "seriesId": "A28",
    "year": 2026,
    "name": "全国大学生仿真建模应用挑战赛",
    "shortName": "仿真建模挑战赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "中国仿真学会、吉林财经大学",
    "eligibility": "高校学生，具体学历组别按当届规程",
    "description": "报名截至 10-16 18:00；多智能体仿真、数字孪生、数据驱动仿真与优化三个方向；提交模型、方案与报告；2025 起办。",
    "scheduleNote": "2026-10-16 20:00—10-20 20:00；已核 2026。这是仿真建模专项，与数维杯不是同一赛事。主办高校通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "主办高校通知",
        "url": "https://www.jlufe.edu.cn/info/1046/16717.htm"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-10-16T18:00:00+08:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-10-16T20:00:00+08:00",
        "end": "2026-10-20T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "B01-2026",
    "seriesId": "B01",
    "year": 2026,
    "name": "东北三省数学建模联赛",
    "shortName": "东北三省数学建模联赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "辽宁、吉林、黑龙江相关高校及赛区组织",
    "eligibility": "本专研",
    "description": "各省、学校通知的起止不同，不能强行合成一个全国统一窗口；大连理工校赛与本联赛可能合并组织。",
    "scheduleNote": "2026 辽宁通知：04-25—05-10；黑龙江部分高校通知：04-26／04-27—05-17；已核 2026，但存在地区差异。大连理工通知、牡丹江师院通知、东北农大通知",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "大连理工通知",
        "url": "https://chuangxin.dlut.edu.cn/info/1020/15947.htm"
      },
      {
        "title": "牡丹江师院通知",
        "url": "https://sxxy.mdjnu.cn/info/1390/3522.htm"
      },
      {
        "title": "东北农大通知",
        "url": "https://www.neau.edu.cn/info/1039/35490.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "B02-2026",
    "seriesId": "B02",
    "year": 2026,
    "name": "山东省大学生数学建模竞赛",
    "shortName": "山东省大学生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "山东省大学生科技节体系；山东省科协、教育厅等单位组织",
    "eligibility": "本专研",
    "description": "报名 04-16 12:00—05-21 12:00；同校不超过 3 人；与 9 月 CUMCM 山东赛区分开。",
    "scheduleNote": "2026 第三届：05-21 20:00—05-24 20:00；已核 2026；部分校转发出现不同日期，应以本届组委会原通知为准。烟台大学通知、组委会通知转发",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "烟台大学通知",
        "url": "https://xkjs.ytu.edu.cn/info/1046/1639.htm"
      },
      {
        "title": "组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/sqdt/450.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-21T20:00:00+08:00",
        "end": "2026-05-24T20:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "B03-2026",
    "seriesId": "B03",
    "year": 2026,
    "name": "山西省金地杯大学生数学建模竞赛",
    "shortName": "山西省金地杯大学生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational"
    ],
    "organizer": "山西省工业与应用数学学会及组委会",
    "eligibility": "本科、专科",
    "description": "组委会报名截至 04-30 12:00，校内可提前；同校组队；与 9 月国赛山西赛区不同。",
    "scheduleNote": "2026-05-06 18:00—05-10 18:00；论文截至 20:00；已核 2026。组委会通知转发、吕梁职业技术学院通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/sqdt/443.html"
      },
      {
        "title": "吕梁职业技术学院通知",
        "url": "https://www.llzy.edu.cn/e/wap/show.php?bclassid=0&cid=891&classid=891&cpage=0&id=12048&style=0"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-06T18:00:00+08:00",
        "end": "2026-05-10T18:00:00+08:00"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2026-05-10T20:00:00+08:00",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "B04-2026",
    "seriesId": "B04",
    "year": 2026,
    "name": "江西省研究生数学建模竞赛",
    "shortName": "江西省研究生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "graduate"
    ],
    "organizer": "江西省学位与研究生教育学会，南昌大学承办",
    "eligibility": "江西全日制研究生",
    "description": "新结束时间本次未核清；最多 3 人；不能继续使用原 5 月日期生成提醒。",
    "scheduleNote": "2026 原定 05-27—05-30；延期后 06-09 09:00 发布赛题；已核延期，最新完整窗口部分待核。原通知转发、延期通知转发",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "原通知转发",
        "url": "https://www.cmathc.org.cn/cpmcm/news/519.html"
      },
      {
        "title": "延期通知转发",
        "url": "https://www.cmathc.org.cn/cpmcm/news/524.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "B05-2026",
    "seriesId": "B05",
    "year": 2026,
    "name": "策联杯数学建模精英联赛",
    "shortName": "策联杯数学建模精英联赛",
    "category": "regional",
    "audiences": [
      "other"
    ],
    "organizer": "多校联合组织的精英联赛／培训体系",
    "eligibility": "具体邀请与组队资格依组织学校",
    "description": "已发现详细 2026 转发赛程与交大提交入口，但未取得完整主办规程；暂不当作面向所有学生自由报名的公开赛。",
    "scheduleNote": "2026 第六届线索：08-13—08-17，后续互评、答辩；部分待核。2026 赛程线索、交大培训／竞赛入口、国防科大往届参赛证明",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "2026 赛程线索",
        "url": "https://m.sohu.com/a/1049286196_121106832"
      },
      {
        "title": "交大培训／竞赛入口",
        "url": "https://anl.sjtu.edu.cn/cme/"
      },
      {
        "title": "国防科大往届参赛证明",
        "url": "https://www.nudt.edu.cn/zjkd/xyfc/8ea8d4c49f244d0cba02063c2cfb9cf6.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C01-2026",
    "seriesId": "C01",
    "year": 2026,
    "name": "MCM / ICM：Mathematical Contest in Modeling / Interdisciplinary Contest in Modeling（美赛）",
    "shortName": "美赛 MCM / ICM",
    "category": "international",
    "audiences": [
      "undergraduate",
      "vocational"
    ],
    "organizer": "COMAP",
    "eligibility": "本科及以下符合规则的学生，通常同校 1—3 人",
    "description": "国际英文论文；MCM 与 ICM 题类不同、同属一个报名赛事体系；不要把 A—F 题展开成六场比赛；不是研究生赛事。",
    "scheduleNote": "2026 美东 01-29 17:00—02-02 20:00；北京时间 01-30 06:00—02-03 09:00。官网已列 2027-01-28—02-01（美东日期）；已核 2026，另核到 2027 日期。COMAP 赛事页、官方竞赛系统",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://comap.org/contests/mcm-icm",
    "registrationUrl": "https://comapmath.com/MCMICM/",
    "sources": [
      {
        "title": "COMAP 赛事页",
        "url": "https://comap.org/contests/mcm-icm"
      },
      {
        "title": "官方竞赛系统",
        "url": "https://comapmath.com/MCMICM/"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-01-30T06:00:00+08:00",
        "end": "2026-02-03T09:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C02-2026",
    "seriesId": "C02",
    "year": 2026,
    "name": "HiMCM：High School Mathematical Contest in Modeling",
    "shortName": "HiMCM",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "COMAP",
    "eligibility": "高中生团队",
    "description": "全球学校可依规则报名；同校最多 4 人、教师担任顾问；英文建模论文，具体工作时长按当年 instructions。",
    "scheduleNote": "2026-11-04—11-17（主办方美东日期）；已核 2026。COMAP 官方通知",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "COMAP 官方通知",
        "url": "https://www.contest.comap.com/highschool/contests/himcm/index.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "主办方美东日期",
        "start": "2026-11-04",
        "end": "2026-11-17"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C03-2026",
    "seriesId": "C03",
    "year": 2026,
    "name": "MidMCM：Middle Mathematical Contest in Modeling",
    "shortName": "MidMCM",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "COMAP",
    "eligibility": "初中年龄段学生",
    "description": "与 HiMCM 同期但参赛年龄及题目对象不同；不能把整个 HiMCM 规则原样套给初中组。",
    "scheduleNote": "2026-11-04—11-17（主办方美东日期）；已核 2026；具体年龄截止依规则。COMAP 官方通知",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "COMAP 官方通知",
        "url": "https://www.contest.comap.com/highschool/contests/himcm/index.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "主办方美东日期",
        "start": "2026-11-04",
        "end": "2026-11-17"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C04-2026",
    "seriesId": "C04",
    "year": 2026,
    "name": "IM²C / IMMC：International Mathematical Modeling Challenge（国际数学建模挑战赛）",
    "shortName": "IM²C / IMMC",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "COMAP、儒莲教科文机构",
    "eligibility": "中学生",
    "description": "国家／区域组织选拔，通常在指定窗口内连续 5 天建模；中华区有区域赛，报名流程不等于直接进入全球决赛；IM²C 与 IMMC 是同一体系别称。",
    "scheduleNote": "2026 届已完成；全球赛季主要在春季。已核 2027 全球窗口：02-01—04-26；已核赛事与 2027 全球窗口；2026 中华区精确分阶段时间未完整核清，不采用培训网站相互冲突的日期。全球官网、2026 结果、区域组织名录、中华区入口",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://immchallenge.org/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "全球官网",
        "url": "https://immchallenge.org/"
      },
      {
        "title": "2026 结果",
        "url": "https://immchallenge.org/2026-results/"
      },
      {
        "title": "区域组织名录",
        "url": "https://immchallenge.org/countries-regions/"
      },
      {
        "title": "中华区入口",
        "url": "https://www.immchallenge.org.hk/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C05-2026",
    "seriesId": "C05",
    "year": 2026,
    "name": "SCUDEM：Student Challenge Using Differential Equations Modeling（源于 SIMIODE）",
    "shortName": "SCUDEM",
    "category": "international",
    "audiences": [
      "school",
      "undergraduate"
    ],
    "organizer": "当前由 COMAP 组织",
    "eligibility": "高中生、本科生",
    "description": "微分或差分方程建模，最终视频不超过 10 分钟；最多 3 人，可跨校，100 美元／队；以 COMAP 本届规则为准。",
    "scheduleNote": "2026 第十一届：10-16—11-10；报名 07-01—10-16；已核 2026；原文报名截至 10-16 14:00 前、比赛起止均为 15:00，标注 EST，时区转换需确认。赛事主页、本届规则",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": "https://www.contest.comap.com/scudem/index.html",
    "registrationUrl": null,
    "sources": [
      {
        "title": "赛事主页",
        "url": "https://www.contest.comap.com/scudem/index.html"
      },
      {
        "title": "本届规则",
        "url": "https://www.contest.comap.com/scudem/instructions.html"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "主办方当地日期",
        "start": "2026-10-16",
        "end": "2026-11-10"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C06-2026",
    "seriesId": "C06",
    "year": 2026,
    "name": "MathWorks Math Modeling Challenge（M3 Challenge）",
    "shortName": "M3 Challenge",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "SIAM 主办，MathWorks 赞助",
    "eligibility": "美国高中高年级、英格兰及威尔士 sixth-form 学生",
    "description": "报名截至 02-20 17:00 美东；免费；有明确学校所在地限制，中国大陆普通学校学生不能据“国际赛”名称认定可直接参赛。",
    "scheduleNote": "2026-02-27—03-02（美东），窗口内自选连续 14 小时；已核 2026。SIAM 本届通知、官方规则 PDF",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "SIAM 本届通知",
        "url": "https://m3challenge.siam.org/newsroom/mathworks-math-modeling-challenge-registration-opens-for-2026/"
      },
      {
        "title": "官方规则 PDF",
        "url": "https://m3challenge.siam.org/wp-content/uploads/01-M3_Official_Rules_and_Guidelines.pdf"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "自选连续 14 小时",
        "start": "2026-02-27",
        "end": "2026-03-02"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C07-2026",
    "seriesId": "C07",
    "year": 2026,
    "name": "Wiskunde A-dag（原 Wiskunde A-lympiade）",
    "shortName": "Wiskunde A-dag",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "荷兰乌得勒支大学 Freudenthal 体系",
    "eligibility": "中学高年级",
    "description": "3—4 人团队，初赛约 7 小时；除荷兰外有德国、日本等国家的组织渠道；另有师范生组，中国学校准入需核实。",
    "scheduleNote": "初赛 2026-11-13—11-27 任选一日；国际决赛 2027-03-12—03-13；已核 2026—2027 赛季，不能当作全球统一一天的线上比赛。乌得勒支大学官方页",
    "status": "scheduled",
    "timeZone": "Europe/Amsterdam",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "乌得勒支大学官方页",
        "url": "https://www.uu.nl/onderwijs/reken-wiskundedagen/evenementen/wiskunde-a-dag"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "窗口内任选一天",
        "start": "2026-11-13",
        "end": "2026-11-27"
      },
      {
        "kind": "competition",
        "label": "国际决赛",
        "start": "2027-03-12",
        "end": "2027-03-13"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "C08-2026",
    "seriesId": "C08",
    "year": 2026,
    "name": "New Zealand Engineering Science Competition",
    "shortName": "NZ Engineering Science",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "奥克兰大学工程科学相关院系",
    "eligibility": "新西兰中学 Year 12／13",
    "description": "工程场景的估计、建模与方案论证；学校团队通常 3—4 人；地域受限。",
    "scheduleNote": "2026-08-08；学校报名 06-01—07-31；已核 2026。奥克兰大学赛事页、竞赛细则",
    "status": "scheduled",
    "timeZone": "Pacific/Auckland",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "奥克兰大学赛事页",
        "url": "https://www.auckland.ac.nz/en/engineering/about-the-faculty/engineering/engineering-science/new-zealand-engineering-science-competition.html"
      },
      {
        "title": "竞赛细则",
        "url": "https://www.auckland.ac.nz/en/engineering/about-the-faculty/engineering/engineering-science/new-zealand-engineering-science-competition/competition-details.html"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-07-31",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-08-08",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D01-2026",
    "seriesId": "D01",
    "year": 2026,
    "name": "杭州电子科技大学第二十七届数学建模竞赛",
    "shortName": "杭州电子科技大学第二十七届数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "本校学生；报名截至 05-27；校内建模与人才选拔",
    "description": "本校学生；报名截至 05-27；校内建模与人才选拔",
    "scheduleNote": "05-28 18:00—06-01 22:00；教务处通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "教务处通知",
        "url": "https://jwc.hdu.edu.cn/2026/0403/c13482a290951/page.htm"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-05-27",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-28T18:00:00+08:00",
        "end": "2026-06-01T22:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D02-2026",
    "seriesId": "D02",
    "year": 2026,
    "name": "福建技术师范学院数学建模竞赛",
    "shortName": "福建技术师范学院数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "本校相关年级学生；报名 05-15—05-22；多日论文赛",
    "description": "本校相关年级学生；报名 05-15—05-22；多日论文赛",
    "scheduleNote": "05-23 18:00—06-06 18:00；教务处通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "教务处通知",
        "url": "https://jwc.fpnu.edu.cn/info/1621/13203.htm"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-05-22",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-05-23T18:00:00+08:00",
        "end": "2026-06-06T18:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D03-2026",
    "seriesId": "D03",
    "year": 2026,
    "name": "福建农林大学数学建模校内竞赛",
    "shortName": "福建农林大学数学建模校内竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "本校学生；暑期建模训练与选拔",
    "description": "本校学生；暑期建模训练与选拔",
    "scheduleNote": "08-13—08-16；学校通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "学校通知",
        "url": "https://xczx.fafu.edu.cn/9f/25/c11092a433957/page.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-08-13",
        "end": "2026-08-16"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D04-2026",
    "seriesId": "D04",
    "year": 2026,
    "name": "河南工学院第四届大学生数学建模竞赛",
    "shortName": "河南工学院第四届大学生数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "本校学生；08-03 评阅，开赛与答辩分别记日历节点",
    "description": "本校学生；08-03 评阅，开赛与答辩分别记日历节点",
    "scheduleNote": "07-30—08-02；08-04 答辩；理学部通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "理学部通知",
        "url": "https://lxb.hait.edu.cn/info/1003/3515.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-07-30",
        "end": "2026-08-02"
      },
      {
        "kind": "competition",
        "label": "答辩",
        "start": "2026-08-04",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D05-2026",
    "seriesId": "D05",
    "year": 2026,
    "name": "重庆大学春季数学建模竞赛",
    "shortName": "重庆大学春季数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "本校学生；本次尚未核清作品截止，不把结果发布日期当作比赛结束时间",
    "description": "本校学生；本次尚未核清作品截止，不把结果发布日期当作比赛结束时间",
    "scheduleNote": "05-01 发布赛题；06-12 已发布结果；赛题通知、结果公告",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "赛题通知",
        "url": "https://sci.cqu.edu.cn/info/1176/8840.htm"
      },
      {
        "title": "结果公告",
        "url": "https://sci.cqu.edu.cn/info/1176/8907.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D06-2026",
    "seriesId": "D06",
    "year": 2026,
    "name": "桂林电子科技大学研究生数学建模校内选拔赛",
    "shortName": "桂林电子科技大学研究生数学建模校内选拔赛",
    "category": "campus",
    "audiences": [
      "graduate"
    ],
    "organizer": "",
    "eligibility": "本校研究生；面向华为杯组队与选拔；具体作答窗口部分待核",
    "description": "本校研究生；面向华为杯组队与选拔；具体作答窗口部分待核",
    "scheduleNote": "6 月；06-05 通知，06-30 结果；研究生院通知、结果公告",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "研究生院通知",
        "url": "https://www.guet.edu.cn/gra/2026/0605/c6074a154896/page.htm"
      },
      {
        "title": "结果公告",
        "url": "https://www.guet.edu.cn/gra/2026/0630/c6074a156853/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D07-2026",
    "seriesId": "D07",
    "year": 2026,
    "name": "广西信息职业技术学院数学建模竞赛",
    "shortName": "广西信息职业技术学院数学建模竞赛",
    "category": "campus",
    "audiences": [
      "vocational"
    ],
    "organizer": "",
    "eligibility": "本校学生，3 人团队；覆盖高职学生的校内训练需求",
    "description": "本校学生，3 人团队；覆盖高职学生的校内训练需求",
    "scheduleNote": "06-05—06-08；学校通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "学校通知",
        "url": "https://www.gxuie.cn/info/1091/44392.htm"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "",
        "start": "2026-06-05",
        "end": "2026-06-08"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "D08-2026",
    "seriesId": "D08",
    "year": 2026,
    "name": "陕西师范大学数学建模校赛",
    "shortName": "陕西师范大学数学建模校赛",
    "category": "campus",
    "audiences": [
      "undergraduate"
    ],
    "organizer": "",
    "eligibility": "本校 2024、2025 级全日制本科生；报名截至 06-15 12:00；选拔全国赛队员",
    "description": "本校 2024、2025 级全日制本科生；报名截至 06-15 12:00；选拔全国赛队员",
    "scheduleNote": "06-18 18:00—06-21 22:00；教务处本届通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "教务处本届通知",
        "url": "https://jwc.snnu.edu.cn/info/1623/30904.htm"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-06-15T12:00:00+08:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "",
        "start": "2026-06-18T18:00:00+08:00",
        "end": "2026-06-21T22:00:00+08:00"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "E01-2026",
    "seriesId": "E01",
    "year": 2026,
    "name": "大学生“麟创杯”数学建模竞赛",
    "shortName": "大学生“麟创杯”数学建模竞赛",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "中国技术市场协会数智技术专业委员会等",
    "eligibility": "大学生",
    "description": "个人线上闭卷知识考试，第二场在指定窗口内任选 1 小时、50 道客观题；后续场次按单场通知建档",
    "scheduleNote": "2026 已核 04-25、06-27 场次；第二场考试通知、报名通知、常见问题",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "第二场考试通知",
        "url": "https://m.saikr.com/contest/notice_detail/41978"
      },
      {
        "title": "报名通知",
        "url": "https://m.saikr.com/contest/notice_detail/39940"
      },
      {
        "title": "常见问题",
        "url": "https://www.saikr.com/c/nd/41034"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "已核场次",
        "start": "2026-04-25",
        "end": null
      },
      {
        "kind": "competition",
        "label": "已核场次",
        "start": "2026-06-27",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "E02-2026",
    "seriesId": "E02",
    "year": 2026,
    "name": "东方创新杯全国大学生数学建模大赛",
    "shortName": "东方创新杯全国大学生数学建模大赛",
    "category": "knowledge",
    "audiences": [
      "undergraduate",
      "other"
    ],
    "organizer": "华夏文化促进会文化和科技融合工作委员会",
    "eligibility": "高校学生及相关社会人士",
    "description": "个人考试；初赛为选择、判断等客观题，决赛增加计算题；决赛日期已调整，不能使用旧的单日 06-13",
    "scheduleNote": "2026 多场；已核 05-30 初赛、06-13—06-14 第一场决赛；报名总截止 07-26；本届报名规则、初赛通知、决赛调整通知",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届报名规则",
        "url": "https://new.saikr.com/vse/SXJM"
      },
      {
        "title": "初赛通知",
        "url": "https://m.saikr.com/contest/notice_detail/43225"
      },
      {
        "title": "决赛调整通知",
        "url": "https://m.saikr.com/contest/notice_detail/43819"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "初赛",
        "start": "2026-05-30",
        "end": null
      },
      {
        "kind": "competition",
        "label": "第一场决赛",
        "start": "2026-06-13",
        "end": "2026-06-14"
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "E03-2026",
    "seriesId": "E03",
    "year": 2026,
    "name": "数学周报全国大学生数学能力大赛—数学建模赛道",
    "shortName": "数学周报全国大学生数学能力大赛—数学建模赛道",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "数学周报社",
    "eligibility": "高校学生等",
    "description": "基础模型、数学知识与计算题考试；与 A27 的“数学建模大赛”分开，不能因主办相同而合并",
    "scheduleNote": "2026 第五届，官网列报名至 08-23；单场考试日期待核；本届活动主页、往届赛道规则及本届入口提示",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "本届活动主页",
        "url": "https://sxzbmath.saikr.com/"
      },
      {
        "title": "往届赛道规则及本届入口提示",
        "url": "https://www.saikr.com/vse/sxzb2ndjm"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "",
        "start": "2026-08-23",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "E04-2026",
    "seriesId": "E04",
    "year": 2026,
    "name": "科创杯大学生数学建模竞赛—知识赛道",
    "shortName": "科创杯大学生数学建模竞赛—知识赛道",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "创赛云（陕西）教育科技有限合伙企业",
    "eligibility": "大学生",
    "description": "在线知识测评，有题库和模拟练习；与 A23 共用品牌，但作品要求不同",
    "scheduleNote": "2026-12-01 24:00 前自选考试时间；官网知识赛道说明",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.simcm.org.cn/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "官网知识赛道说明",
        "url": "https://www.simcm.org.cn/"
      }
    ],
    "events": [
      {
        "kind": "submission",
        "label": "自选考试截止",
        "start": "2026-12-01",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "F01-2026",
    "seriesId": "F01",
    "year": 2026,
    "name": "全国高校密码数学挑战赛",
    "shortName": "全国高校密码数学挑战赛",
    "category": "adjacent",
    "audiences": [
      "other"
    ],
    "organizer": "中国密码学会密码数学理论专业委员会、天融信科技集团；2026 南开大学承办",
    "eligibility": "具体参赛资格以当届官方规程为准。",
    "description": "密码数学、算法研究与计算验证，专业门槛较高；不能与“全国密码技术竞赛”混为一项",
    "scheduleNote": "2026-03-31 发布赛题；06-30 报名及作品截止；计划 8 月总决赛；学会年度计划、本届赛题通知转发、赛事入口",
    "status": "scheduled",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "学会年度计划",
        "url": "https://www.cacrnet.org.cn/site/content/1719.html"
      },
      {
        "title": "本届赛题通知转发",
        "url": "https://www.cmathc.org.cn/mcm/st/434.html"
      },
      {
        "title": "赛事入口",
        "url": "https://www.cmsecc.com/"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "赛题研究",
        "start": "2026-03-31",
        "end": "2026-06-30"
      },
      {
        "kind": "submission",
        "label": "作品提交",
        "start": "2026-06-30",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "F02-2026",
    "seriesId": "F02",
    "year": 2026,
    "name": "正大杯全国大学生市场调查与分析大赛",
    "shortName": "正大杯全国大学生市场调查与分析大赛",
    "category": "adjacent",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "中国商业统计学会",
    "eligibility": "专科、本科、研究生及在华留学生组",
    "description": "调查设计、抽样、统计分析与报告答辩；跨学年赛季，各组赛程不同；不等同于纯数学建模命题赛",
    "scheduleNote": "第十六届：2025 年秋报名，2026 年 4—5 月省赛／国赛阶段；主办学会本届通知",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "主办学会本届通知",
        "url": "https://www.china-cssc.org/show-568-1912-1.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "H01-2026",
    "seriesId": "H01",
    "year": 2026,
    "name": "深圳杯数学建模挑战赛",
    "shortName": "深圳杯数学建模挑战赛",
    "category": "historical",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "当前未确认有效报名窗口，参赛资格以新的官方通知为准。",
    "description": "",
    "scheduleNote": "2026 暂停举办；不能套用往届春季开题、暑期提交的惯例；不据此断言以后永久停办；暂停通知转发全文、官网入口",
    "status": "paused",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.m2ct.org/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "暂停通知转发全文",
        "url": "https://www.cmathc.org.cn/mcm/tz/488.html"
      },
      {
        "title": "官网入口",
        "url": "https://www.m2ct.org/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "H02-2026",
    "seriesId": "H02",
    "year": 2026,
    "name": "数创杯全国大学生数学建模挑战赛",
    "shortName": "数创杯全国大学生数学建模挑战赛",
    "category": "historical",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "当前未确认有效报名窗口，参赛资格以新的官方通知为准。",
    "description": "",
    "scheduleNote": "存续待核；未找到可核实的 2026 官方赛程，不编造月份；勿与“数维杯”“科创杯”混写；中国石油大学竞赛目录",
    "status": "historical",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "中国石油大学竞赛目录",
        "url": "https://www.cup.edu.cn/fcg/tzgg/4e0ef301049749fea208fc8aea47e37e.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "H03-2026",
    "seriesId": "H03",
    "year": 2026,
    "name": "AoCMM 数学建模竞赛",
    "shortName": "AoCMM 数学建模竞赛",
    "category": "historical",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "当前未确认有效报名窗口，参赛资格以新的官方通知为准。",
    "description": "",
    "scheduleNote": "存续待核；未核到 2026 主办方正式赛程，不能采用留学培训网站“每年固定某月”的说法；SIAM 竞赛资源、历史项目页",
    "status": "historical",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "SIAM 竞赛资源",
        "url": "https://www.siam.org/programs-initiatives/education-resources/resources-for-undergraduates/math-competitions/"
      },
      {
        "title": "历史项目页",
        "url": "https://sriharshaguduguntla.com/aocmm/about.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "H04-2026",
    "seriesId": "H04",
    "year": 2026,
    "name": "泰迪杯数据分析技能赛",
    "shortName": "泰迪杯数据分析技能赛",
    "category": "historical",
    "audiences": [
      "other"
    ],
    "organizer": "",
    "eligibility": "当前未确认有效报名窗口，参赛资格以新的官方通知为准。",
    "description": "",
    "scheduleNote": "2026 是否恢复待核；不能把 2024 秋赛日期顺延到 2026；与春季数据挖掘挑战赛不同；2024 官方结果、含停办说明的宣讲转发、官方技能赛目录",
    "status": "historical",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "2024 官方结果",
        "url": "https://www.tipdm.org/jn7dqj/2473.jhtml"
      },
      {
        "title": "含停办说明的宣讲转发",
        "url": "https://www.sohu.com/a/980875832_121304477"
      },
      {
        "title": "官方技能赛目录",
        "url": "https://www.tipdmcup.cn/jnsdt/index.jhtml"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13"
  },
  {
    "id": "A01-2027",
    "seriesId": "A01",
    "year": 2027,
    "name": "高教社杯全国大学生数学建模竞赛（CUMCM／国赛）",
    "shortName": "国赛 CUMCM",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational"
    ],
    "organizer": "往届组织信息：中国工业与应用数学学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本科、专科",
    "description": "以下为往届赛事介绍，2027 规则待公布。通常 3 名同校学生，经学校、赛区组织报名；全国系统学生资格审查截止 09-07 20:00，学校往往更早；论文建模。",
    "scheduleNote": "预计 9 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-09-10 18:00—09-13 20:00；已核 2026。主办学会通知 PDF、组委会报名参赛须知 PDF（高校存档）、官网",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.mcm.edu.cn/?key=cncjmm",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 主办学会通知 PDF",
        "url": "https://www.csiam.org.cn/upload/shuxue/69c3870950b04.pdf"
      },
      {
        "title": "往届参考 · 组委会报名参赛须知 PDF（高校存档）",
        "url": "https://hs.nufe.edu.cn/_upload/article/files/18/93/be02942d440da93e7786230a433a/ff94902a-2505-493b-9025-7ee5fd6b2a0a.pdf"
      },
      {
        "title": "往届参考 · 官网",
        "url": "https://www.mcm.edu.cn/?key=cncjmm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-09"
    ]
  },
  {
    "id": "A02-2027",
    "seriesId": "A02",
    "year": 2027,
    "name": "华为杯中国研究生数学建模竞赛",
    "shortName": "华为杯",
    "category": "national",
    "audiences": [
      "graduate"
    ],
    "organizer": "往届组织信息：中国学位与研究生教育学会、中国科协青少年科技中心；2026 西安交大承办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：硕博研究生及符合条件的拟入学研究生",
    "description": "以下为往届赛事介绍，2027 规则待公布。团队论文赛；报名 06-01 08:00—09-19 17:00，资格审核另有节点；与本科国赛不同。",
    "scheduleNote": "预计 9 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-09-23 08:00—09-27 12:00；已核 2026。重庆大学转发参赛通知、中科大通知、官方入口",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://cpipc.acge.org.cn/cw/hp/4",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 重庆大学转发参赛通知",
        "url": "https://graduate.cqu.edu.cn/info/1394/19117.htm"
      },
      {
        "title": "往届参考 · 中科大通知",
        "url": "https://gradschool.ustc.edu.cn/article/3487"
      },
      {
        "title": "往届参考 · 官方入口",
        "url": "https://cpipc.acge.org.cn/cw/hp/4"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-09"
    ]
  },
  {
    "id": "A03-2027",
    "seriesId": "A03",
    "year": 2027,
    "name": "MathorCup 数学应用挑战赛（原高校数学建模挑战赛）",
    "shortName": "MathorCup",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "teacher"
    ],
    "organizer": "往届组织信息：中国优选法统筹法与经济数学研究会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研及高校教师赛组",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 04-16 12:00；1—3 人，2026 主赛不允许跨校；200 元／队；企业实际问题建模。",
    "scheduleNote": "预计 4 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-04-17 08:00—04-21 09:00；已核 2026。官方赛题公告、组委会报名页",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 官方赛题公告",
        "url": "https://www.mathorcup.org/detail/2487"
      },
      {
        "title": "往届参考 · 组委会报名页",
        "url": "https://sta.saikr.com/mathorcup2026"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04"
    ]
  },
  {
    "id": "A04-2027",
    "seriesId": "A04",
    "year": 2027,
    "name": "MathorCup 数学应用挑战赛—大数据竞赛",
    "shortName": "MathorCup 大数据",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：中国优选法统筹法与经济数学研究会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。09-03 已发布本届通知；报名截至 10-23 12:00；1—3 人，允许跨校；200 元／队；论文、代码、数据结果，后续答辩，2027 年 1 月公布获奖名单。",
    "scheduleNote": "预计 10 月、12 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 初赛 10-23 18:00—10-30 20:00；复赛 12-04 18:00—12-11 20:00；已核 2026，已读取官方 PDF。报名公告、完整通知与章程 PDF",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 报名公告",
        "url": "https://mathorcup.org/detail/2494"
      },
      {
        "title": "往届参考 · 完整通知与章程 PDF",
        "url": "https://files.mathorcup.org/uploads/files/20260903/1788430033944665.pdf"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-10",
      "2027-12"
    ]
  },
  {
    "id": "A05-2027",
    "seriesId": "A05",
    "year": 2027,
    "name": "中国电机工程学会杯全国大学生电工数学建模竞赛（电工杯）",
    "shortName": "电工杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：中国电机工程学会，东北电力大学等承办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：普通高校全日制学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 05-20 23:59；同校最多 3 人；电力、能源及相关工程应用论文建模。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-22—05-25；已核 2026，赛题及成绩公告互证。承办高校赛事官网",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://shumo.neepu.edu.cn/tzgg.htm",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 承办高校赛事官网",
        "url": "https://shumo.neepu.edu.cn/tzgg.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "A06-2027",
    "seriesId": "A06",
    "year": 2027,
    "name": "泰迪杯数据挖掘挑战赛",
    "shortName": "泰迪杯数据挖掘",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：广东泰迪智能科技股份有限公司及组委会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 02-01—04-10；不同题目另有 04-21、04-25、04-28 测试节点；同校 1—3 人，200 元／队；数据分析、算法及应用方案。",
    "scheduleNote": "预计 2 月、3 月、4 月、6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-02-01 开题；04-24 16:00 论文截止；06-06 答辩；已核 2026；不能把所有赛题统一写成“04-24 全部结束”。本届竞赛规程、成绩公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届竞赛规程",
        "url": "https://www.tipdm.org/dssj14/2527.jhtml"
      },
      {
        "title": "往届参考 · 成绩公告",
        "url": "https://www.tipdm.org/dssj14/2532.jhtml"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-06"
    ]
  },
  {
    "id": "A07-2027",
    "seriesId": "A07",
    "year": 2027,
    "name": "全国大学生统计建模大赛",
    "shortName": "统计建模大赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate"
    ],
    "organizer": "往届组织信息：中国统计教育学会；2026 内蒙古财经大学承办国赛；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本科生、研究生分组",
    "description": "以下为往届赛事介绍，2027 规则待公布。围绕主题开展统计建模研究，论文评审；校赛、省赛、国赛层层组织；各省及学校截止不同。",
    "scheduleNote": "预计 3 月、4 月、5 月、6 月、7 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 年 3 月通知启动；7 月已公布国赛入围名单；已核 2026，完整最终赛程部分待核。本届通知、通知 PDF、国赛入围公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届通知",
        "url": "https://www.ai-learning.net/dstz/37119.jhtml"
      },
      {
        "title": "往届参考 · 通知 PDF",
        "url": "https://cmswebsite.ai-learning.net/u/cms/tjjmds/202603/10170642sbi1.pdf"
      },
      {
        "title": "往届参考 · 国赛入围公告",
        "url": "https://www.ai-learning.net/dsdt/37134.jhtml"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07"
    ]
  },
  {
    "id": "A08-2027",
    "seriesId": "A08",
    "year": 2027,
    "name": "华中杯大学生数学建模挑战赛",
    "shortName": "华中杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：湖北省工业与应用数学学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：普通高校全日制在校生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 03-10 12:00—04-23 12:00；同校不超过 3 人；150 元／队；面向全国，不限湖北。",
    "scheduleNote": "预计 4 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-04-23 18:00—04-26 20:00；已核 2026 转发通知及赛后记录；转发页评审日期有旧年份残留，未采用。组委会通知转发、官网入口、赛后公告转发",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "http://hzbmmc.com",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/tz/405.html"
      },
      {
        "title": "往届参考 · 官网入口",
        "url": "http://hzbmmc.com"
      },
      {
        "title": "往届参考 · 赛后公告转发",
        "url": "https://www.cmathc.org.cn/mcm/hjmd/534.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04"
    ]
  },
  {
    "id": "A09-2027",
    "seriesId": "A09",
    "year": 2027,
    "name": "华东杯大学生数学建模邀请赛",
    "shortName": "华东杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：复旦大学数学科学学院、华东地区数学建模联盟组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：全国高校在校学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 04-19 09:00—04-30 18:00；每队不超过 3 人；论文赛，“邀请赛”名称不等于仅限华东学校。",
    "scheduleNote": "预计 4 月、5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-04-30 20:00—05-04 20:00；已核 2026。复旦大学通知、指定报名页",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 复旦大学通知",
        "url": "https://math.fudan.edu.cn/db/89/c33035a777097/page.htm"
      },
      {
        "title": "往届参考 · 指定报名页",
        "url": "https://www.saikr.com/vse/hdmcm/2026"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-05"
    ]
  },
  {
    "id": "A10-2027",
    "seriesId": "A10",
    "year": 2027,
    "name": "五一数学建模竞赛",
    "shortName": "五一数学建模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "school"
    ],
    "organizer": "往届组织信息：中国矿业大学、江苏省工业与应用数学学会、徐州市工业与应用数学学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高中生及高校本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 04-02 08:00—04-30 24:00；同校 1—3 人，100 元／队；开放命题论文赛。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-01 10:00—05-04 12:00；已核 2026。中国矿业大学赛事通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 中国矿业大学赛事通知",
        "url": "https://51mcm.cumt.edu.cn/8d/20/c14143a691488/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "A11-2027",
    "seriesId": "A11",
    "year": 2027,
    "name": "数维杯大学生数学建模挑战赛·春季赛",
    "shortName": "数维杯春季赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：春季届次由当届数维杯组委会组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。本届第十一届；建模论文赛；比赛作答截止与最后上传节点应分别保存。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-08 09:00—05-11 09:00；提交截至 10:00；已核 2026。不要把秋季新主办方回填至春季。赛题公告索引、本届成绩公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 赛题公告索引",
        "url": "https://www.nmmcm.org.cn/Awards/"
      },
      {
        "title": "往届参考 · 本届成绩公告",
        "url": "https://www.nmmcm.org.cn/Awards/188.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "A12-2027",
    "seriesId": "A12",
    "year": 2027,
    "name": "数维杯全国大学生数学建模挑战赛·秋季赛",
    "shortName": "数维杯秋季赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：自 2026 第十二届秋赛起，中国仿真学会、辽宁科技大学联合主办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 11-20 06:00；1—3 人，可跨校；英文论文；2027 年 1 月中旬公布成绩。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-11-20 09:00—11-24 09:00；论文提交截至 10:00；已核 2026。本届官网通知及规则、指定报名页",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.nmmcm.org.cn/Competition/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届官网通知及规则",
        "url": "https://www.nmmcm.org.cn/Competition/"
      },
      {
        "title": "往届参考 · 指定报名页",
        "url": "https://www.mojinghub.com/competitions/swbmcm/2026"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "A13-2027",
    "seriesId": "A13",
    "year": 2027,
    "name": "认证杯数学中国数学建模网络挑战赛",
    "shortName": "认证杯网络挑战赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate",
      "other"
    ],
    "organizer": "往届组织信息：数学中国、内蒙古第五维信息技术有限公司；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：大学生、研究生、毕业生及符合条件的初级数模爱好者",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 04-09 17:00；两阶段统一报名，100 元／队，另有自选付费点评；大学生通常 1—3 人，可跨校。",
    "scheduleNote": "预计 4 月、5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 第一阶段 04-09 20:00—04-12 20:00；第二阶段 05-14 20:00—05-17 20:00；已核 2026。“认证”是该赛事体系的命名，不能推导为国家职业认证。邀请函、规则",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 邀请函",
        "url": "https://www.tzmcm.cn/tz.html"
      },
      {
        "title": "往届参考 · 规则",
        "url": "https://www.tzmcm.cn/gz.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-05"
    ]
  },
  {
    "id": "A14-2027",
    "seriesId": "A14",
    "year": 2027,
    "name": "认证杯数学中国数学建模国际赛（CAMCM／小美赛）",
    "shortName": "认证杯国际赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate",
      "school",
      "other"
    ],
    "organizer": "往届组织信息：数学中国赛事组织体系；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：中学生、本专研、毕业生分组",
    "description": "以下为往届赛事介绍，2027 规则待公布。2025 报名截至 11-28 00:00；200 元／队；不同年龄组的队员及指导教师要求不同。与 COMAP 美赛分别报名。",
    "scheduleNote": "预计 11 月、12 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：往届：2025-11-28 08:00—12-02 08:00；往届参考，2026 赛程未核实。2025 竞赛规则",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 2025 竞赛规则",
        "url": "https://mcm.tzmcm.cn/gz.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11",
      "2027-12"
    ]
  },
  {
    "id": "A15-2027",
    "seriesId": "A15",
    "year": 2027,
    "name": "中青杯全国大学生数学建模竞赛",
    "shortName": "中青杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：中国国际科技促进会综合素质与职业发展教育专业委员会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 06-04 12:00；分专科、本科、研究生组；论文赛。中国国际科技促进会为指导单位，具体主办是其专委会。",
    "scheduleNote": "预计 6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-06-04 17:00—06-07 17:00；已核 2026。赛事官网与时间安排、赛后公示",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://zqb.52jingsai.com/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 赛事官网与时间安排",
        "url": "https://zqb.52jingsai.com/"
      },
      {
        "title": "往届参考 · 赛后公示",
        "url": "https://zqb.52jingsai.com/prgs.php"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-06"
    ]
  },
  {
    "id": "A16-2027",
    "seriesId": "A16",
    "year": 2027,
    "name": "APMCM 亚太地区大学生数学建模竞赛·中文赛项",
    "shortName": "APMCM 中文赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：中国国际科技促进会物联网工作委员会、北京图象图形学学会等组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。中文建模论文赛；与秋季英文赛有不同报名窗口和任务，不按重复网页去重掉。",
    "scheduleNote": "预计 6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-06-12—06-15；已核 2026。本届赛后公告、官方通知索引",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届赛后公告",
        "url": "https://www.apmcm.org/detail/2511?language=en"
      },
      {
        "title": "往届参考 · 官方通知索引",
        "url": "https://apmcm.org/list/news"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-06"
    ]
  },
  {
    "id": "A17-2027",
    "seriesId": "A17",
    "year": 2027,
    "name": "APMCM 亚太地区大学生数学建模竞赛·英文赛项",
    "shortName": "APMCM 英文赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：APMCM 组委会及当届主办单位；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。英文论文，常被作为英文数模训练；2026 中文赛已办，不代表英文赛日期已经确定。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：往届：2025 年 11 月，11-20 开赛；往届参考，2026 英文赛程未核实。往届报名通知与资讯、赛题及评奖",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 往届报名通知与资讯",
        "url": "https://apmcm.org/list/news"
      },
      {
        "title": "往届参考 · 赛题及评奖",
        "url": "https://www.apmcm.org/list/problem_prize?language=cn"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "A18-2027",
    "seriesId": "A18",
    "year": 2027,
    "name": "华数杯大学生数学建模竞赛",
    "shortName": "华数杯",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：天津市未来与预测科学研究会、华数杯组委会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名页截至 08-07 12:00；200 元／队；中文建模论文与赛后评语。",
    "scheduleNote": "预计 8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-08-07 18:00—08-10 20:00；已核 2026。组委会本届报名页、高校赛后报道",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 组委会本届报名页",
        "url": "https://m.saikr.com/vse/chinamcm26"
      },
      {
        "title": "往届参考 · 高校赛后报道",
        "url": "https://www.hfuu.edu.cn/stxy/75/70/c11608a161136/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-08"
    ]
  },
  {
    "id": "A19-2027",
    "seriesId": "A19",
    "year": 2027,
    "name": "华数杯国际大学生数学建模竞赛",
    "shortName": "华数杯国际赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：天津市未来与预测科学研究会、华数杯组委会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。通常 1—3 人组队；英文论文；与夏季华数杯是不同赛程。宣传中的“美赛选拔／热身”不等于 COMAP 官方晋级赛。",
    "scheduleNote": "预计 1 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-01-17 06:00—01-21 09:00；已核 2026。官方论文提交通知、本届报名入口、主办落款成绩公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 官方论文提交通知",
        "url": "https://m.saikr.com/contest/notice_detail/38621"
      },
      {
        "title": "往届参考 · 本届报名入口",
        "url": "https://new.saikr.com/vse/mcmicm2026"
      },
      {
        "title": "往届参考 · 主办落款成绩公告",
        "url": "https://m.saikr.com/contest/notice_detail/39346"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-01"
    ]
  },
  {
    "id": "A20-2027",
    "seriesId": "A20",
    "year": 2027,
    "name": "天府杯全国大学生数学建模竞赛",
    "shortName": "天府杯数模",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：四川省科学学与科技政策研究会、成都市航空航天学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校、科研院所全日制在读学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 08-20 12:00；1—3 人，120 元／队；论文赛；不限四川。",
    "scheduleNote": "预计 8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-08-20 18:00—08-23 22:00；已核 2026；报名页退费条款有旧年份残留，未采为时间依据。组委会本届规则",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 组委会本届规则",
        "url": "https://m.saikr.com/vse/TFB2026"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-08"
    ]
  },
  {
    "id": "A21-2027",
    "seriesId": "A21",
    "year": 2027,
    "name": "天府杯全国大学生统计建模竞赛",
    "shortName": "天府杯统计建模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：四川省科学学与科技政策研究会、成都航空航天学会（公告落款）；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研分组",
    "description": "以下为往届赛事介绍，2027 规则待公布。1—3 人；具体开始、提交时间尚未核清；与中国统计教育学会的“全国大学生统计建模大赛”分别建档。",
    "scheduleNote": "预计 4 月、5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 年 4—5 月已举办，05-15 发布结果；已核 2026 存续及赛后结果，精确赛程部分待核。报名流程、成绩公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 报名流程",
        "url": "https://m.saikr.com/contest/notice_detail/42514"
      },
      {
        "title": "往届参考 · 成绩公告",
        "url": "https://m.saikr.com/contest/notice_detail/42870"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-05"
    ]
  },
  {
    "id": "A22-2027",
    "seriesId": "A22",
    "year": 2027,
    "name": "高斯杯全国大学生数学建模挑战赛",
    "shortName": "高斯杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "graduate"
    ],
    "organizer": "往届组织信息：高斯杯组委会，DataCastle 平台支持；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本科生、研究生",
    "description": "以下为往届赛事介绍，2027 规则待公布。不超过 3 人，可跨校；较长周期的问题研究与作品提交；不能按固定三四天比赛展示。",
    "scheduleNote": "预计 1 月、2 月、3 月、4 月、5 月、6 月、7 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：第九届：2025-12-22—2026-07-31；8 月评审；已核跨年赛季，页面主办仅列组委会，不补造学会背书。主办报名说明",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 主办报名说明",
        "url": "https://landing.datacastle.cn/gs/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07"
    ]
  },
  {
    "id": "A23-2027",
    "seriesId": "A23",
    "year": 2027,
    "name": "科创杯大学生数学建模竞赛·企业命题赛道",
    "shortName": "科创杯企业命题",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：创赛云（陕西）教育科技有限合伙企业主办，相关机构学术支持；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：大学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。企业问题、建模与论文；同一品牌还有知识考试，赛制必须区分。",
    "scheduleNote": "预计 7 月、8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 分赛区 07-15—07-20；国赛 08-25—08-30；已核 2026。本届官网及企业命题公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.simcm.org.cn/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届官网及企业命题公告",
        "url": "https://www.simcm.org.cn/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-07",
      "2027-08"
    ]
  },
  {
    "id": "A24-2027",
    "seriesId": "A24",
    "year": 2027,
    "name": "大湾区杯粤港澳金融数学建模竞赛",
    "shortName": "大湾区杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：广东省工业与应用数学学会及组委会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。金融投资场景建模；同校不超过 3 人；比赛结束、作品提交、实测数据提交是不同节点。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：往届：2025-11-01—11-08；之后另有实测、答辩；往届参考，2026 赛程未核实。主办通知 PDF、2025 赛事公告汇总、作品提交说明 PDF",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 主办通知 PDF",
        "url": "https://www.tipdm.org/u/cms/www/202510/23105416uhw1.pdf"
      },
      {
        "title": "往届参考 · 2025 赛事公告汇总",
        "url": "https://www.tipdm.org/dwjw6qjrsm/index.jhtml"
      },
      {
        "title": "往届参考 · 作品提交说明 PDF",
        "url": "https://www.tipdm.org/u/cms/www/202510/311007057jz6.pdf"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "A25-2027",
    "seriesId": "A25",
    "year": 2027,
    "name": "长三角高校数学建模竞赛",
    "shortName": "长三角高校数模",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：浙江省数学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：中国及境外本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 05-14 08:00；不超过 3 人，200 元／队；不限长三角地区。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-14 08:00—05-18 08:00；论文截至 10:00；已核 2026 赛程；同页章程与报名说明对“是否允许跨校”表述冲突，此项待组委会确认。北京理工大学长三角研究院通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 北京理工大学长三角研究院通知",
        "url": "https://jiaxing.bit.edu.cn/fwzn/tzgg/4b9857c3b96e404a9987cf456eafb5ca.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "A26-2027",
    "seriesId": "A26",
    "year": 2027,
    "name": "农林杯高校数学建模竞赛",
    "shortName": "农林杯",
    "category": "national",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：北京农学院主办，天津农学院等多校承办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：农林及参与组织院校的本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 04-15—05-25 12:00；农业、生态、农林应用论文；校际组织属性明显，外校报名资格应按本届规程确认。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-25 12:00—05-31 18:00；已核 2026。组委会本届页面",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 组委会本届页面",
        "url": "https://m.saikr.com/vse/NLB/2026"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "A27-2027",
    "seriesId": "A27",
    "year": 2027,
    "name": "数学周报全国大学生数学建模大赛",
    "shortName": "数学周报数模大赛",
    "category": "national",
    "audiences": [
      "undergraduate",
      "other"
    ],
    "organizer": "往届组织信息：数学周报社；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：全国大学生及年满 18 周岁的相关社会人士",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 11-26；100 元／队；统一命题、提交论文。与“数学能力大赛—数学建模赛道”的考试项目是不同活动。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：第五届：2026-11-27 00:00—11-29 24:00；已核 2026，直接读取组委会报名页；页面顶部 23:59 与正文 24:00 存在显示精度差异，自动提醒前应确认。本届报名规则",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届报名规则",
        "url": "https://m.saikr.com/vse/MW26MM"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "A28-2027",
    "seriesId": "A28",
    "year": 2027,
    "name": "全国大学生仿真建模应用挑战赛",
    "shortName": "仿真建模挑战赛",
    "category": "national",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：中国仿真学会、吉林财经大学；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生，具体学历组别按当届规程",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 10-16 18:00；多智能体仿真、数字孪生、数据驱动仿真与优化三个方向；提交模型、方案与报告；2025 起办。",
    "scheduleNote": "预计 10 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-10-16 20:00—10-20 20:00；已核 2026。这是仿真建模专项，与数维杯不是同一赛事。主办高校通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 主办高校通知",
        "url": "https://www.jlufe.edu.cn/info/1046/16717.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-10"
    ]
  },
  {
    "id": "B01-2027",
    "seriesId": "B01",
    "year": 2027,
    "name": "东北三省数学建模联赛",
    "shortName": "东北三省数学建模联赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：辽宁、吉林、黑龙江相关高校及赛区组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。各省、学校通知的起止不同，不能强行合成一个全国统一窗口；大连理工校赛与本联赛可能合并组织。",
    "scheduleNote": "预计 4 月、5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 辽宁通知：04-25—05-10；黑龙江部分高校通知：04-26／04-27—05-17；已核 2026，但存在地区差异。大连理工通知、牡丹江师院通知、东北农大通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 大连理工通知",
        "url": "https://chuangxin.dlut.edu.cn/info/1020/15947.htm"
      },
      {
        "title": "往届参考 · 牡丹江师院通知",
        "url": "https://sxxy.mdjnu.cn/info/1390/3522.htm"
      },
      {
        "title": "往届参考 · 东北农大通知",
        "url": "https://www.neau.edu.cn/info/1039/35490.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-05"
    ]
  },
  {
    "id": "B02-2027",
    "seriesId": "B02",
    "year": 2027,
    "name": "山东省大学生数学建模竞赛",
    "shortName": "山东省大学生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：山东省大学生科技节体系；山东省科协、教育厅等单位组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本专研",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名 04-16 12:00—05-21 12:00；同校不超过 3 人；与 9 月 CUMCM 山东赛区分开。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 第三届：05-21 20:00—05-24 20:00；已核 2026；部分校转发出现不同日期，应以本届组委会原通知为准。烟台大学通知、组委会通知转发",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 烟台大学通知",
        "url": "https://xkjs.ytu.edu.cn/info/1046/1639.htm"
      },
      {
        "title": "往届参考 · 组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/sqdt/450.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "B03-2027",
    "seriesId": "B03",
    "year": 2027,
    "name": "山西省金地杯大学生数学建模竞赛",
    "shortName": "山西省金地杯大学生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "undergraduate",
      "vocational"
    ],
    "organizer": "往届组织信息：山西省工业与应用数学学会及组委会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本科、专科",
    "description": "以下为往届赛事介绍，2027 规则待公布。组委会报名截至 04-30 12:00，校内可提前；同校组队；与 9 月国赛山西赛区不同。",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-05-06 18:00—05-10 18:00；论文截至 20:00；已核 2026。组委会通知转发、吕梁职业技术学院通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 组委会通知转发",
        "url": "https://www.cmathc.org.cn/mcm/sqdt/443.html"
      },
      {
        "title": "往届参考 · 吕梁职业技术学院通知",
        "url": "https://www.llzy.edu.cn/e/wap/show.php?bclassid=0&cid=891&classid=891&cpage=0&id=12048&style=0"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "B04-2027",
    "seriesId": "B04",
    "year": 2027,
    "name": "江西省研究生数学建模竞赛",
    "shortName": "江西省研究生数学建模竞赛",
    "category": "regional",
    "audiences": [
      "graduate"
    ],
    "organizer": "往届组织信息：江西省学位与研究生教育学会，南昌大学承办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：江西全日制研究生",
    "description": "以下为往届赛事介绍，2027 规则待公布。新结束时间本次未核清；最多 3 人；不能继续使用原 5 月日期生成提醒。",
    "scheduleNote": "预计 5 月、6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 原定 05-27—05-30；延期后 06-09 09:00 发布赛题；已核延期，最新完整窗口部分待核。原通知转发、延期通知转发",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 原通知转发",
        "url": "https://www.cmathc.org.cn/cpmcm/news/519.html"
      },
      {
        "title": "往届参考 · 延期通知转发",
        "url": "https://www.cmathc.org.cn/cpmcm/news/524.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05",
      "2027-06"
    ]
  },
  {
    "id": "B05-2027",
    "seriesId": "B05",
    "year": 2027,
    "name": "策联杯数学建模精英联赛",
    "shortName": "策联杯数学建模精英联赛",
    "category": "regional",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：多校联合组织的精英联赛／培训体系；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：具体邀请与组队资格依组织学校",
    "description": "以下为往届赛事介绍，2027 规则待公布。已发现详细 2026 转发赛程与交大提交入口，但未取得完整主办规程；暂不当作面向所有学生自由报名的公开赛。",
    "scheduleNote": "2027 赛程待公布；目前资料不足以推定比赛月份。\n往届依据：2026 第六届线索：08-13—08-17，后续互评、答辩；部分待核。2026 赛程线索、交大培训／竞赛入口、国防科大往届参赛证明",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 2026 赛程线索",
        "url": "https://m.sohu.com/a/1049286196_121106832"
      },
      {
        "title": "往届参考 · 交大培训／竞赛入口",
        "url": "https://anl.sjtu.edu.cn/cme/"
      },
      {
        "title": "往届参考 · 国防科大往届参赛证明",
        "url": "https://www.nudt.edu.cn/zjkd/xyfc/8ea8d4c49f244d0cba02063c2cfb9cf6.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": []
  },
  {
    "id": "C01-2027",
    "seriesId": "C01",
    "year": 2027,
    "name": "MCM / ICM：Mathematical Contest in Modeling / Interdisciplinary Contest in Modeling（美赛）",
    "shortName": "美赛 MCM / ICM",
    "category": "international",
    "audiences": [
      "undergraduate",
      "vocational",
      "school"
    ],
    "organizer": "COMAP（美国数学及其应用联合会）",
    "eligibility": "面向本科及高中学生；同校最多 3 人组队，由顾问完成报名。具体资格以 COMAP 当届规则为准。",
    "description": "以实际问题为题的英文数学建模论文赛。2027 届日期已由 COMAP 公布。",
    "scheduleNote": "正式赛程（美东 EST）：2027-01-28 15:00 前报名；01-28 17:00 开赛；02-01 20:00 停止作答；21:00 论文提交截止。北京时间分别为 01-29 04:00 前、01-29 06:00、02-02 09:00、02-02 10:00。",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": "https://www.contest.comap.com/undergraduate/contests/mcm/",
    "registrationUrl": "https://www.contest.comap.com/undergraduate/contests/mcm/register.php",
    "sources": [
      {
        "title": "COMAP 2027 正式规则与日期",
        "url": "https://www.contest.comap.com/undergraduate/contests/mcm/instructions.php"
      }
    ],
    "events": [
      {
        "kind": "registration",
        "label": "报名截止前",
        "start": "2027-01-28T15:00:00-05:00",
        "end": null
      },
      {
        "kind": "competition",
        "label": "正式比赛",
        "start": "2027-01-28T17:00:00-05:00",
        "end": "2027-02-01T20:00:00-05:00"
      },
      {
        "kind": "submission",
        "label": "论文提交",
        "start": "2027-02-01T21:00:00-05:00",
        "end": null
      }
    ],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": []
  },
  {
    "id": "C02-2027",
    "seriesId": "C02",
    "year": 2027,
    "name": "HiMCM：High School Mathematical Contest in Modeling",
    "shortName": "HiMCM",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "往届组织信息：COMAP；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高中生团队",
    "description": "以下为往届赛事介绍，2027 规则待公布。全球学校可依规则报名；同校最多 4 人、教师担任顾问；英文建模论文，具体工作时长按当年 instructions。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-11-04—11-17（主办方美东日期）；已核 2026。COMAP 官方通知",
    "status": "estimated",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · COMAP 官方通知",
        "url": "https://www.contest.comap.com/highschool/contests/himcm/index.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "C03-2027",
    "seriesId": "C03",
    "year": 2027,
    "name": "MidMCM：Middle Mathematical Contest in Modeling",
    "shortName": "MidMCM",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "往届组织信息：COMAP；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：初中年龄段学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。与 HiMCM 同期但参赛年龄及题目对象不同；不能把整个 HiMCM 规则原样套给初中组。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-11-04—11-17（主办方美东日期）；已核 2026；具体年龄截止依规则。COMAP 官方通知",
    "status": "estimated",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · COMAP 官方通知",
        "url": "https://www.contest.comap.com/highschool/contests/himcm/index.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "C04-2027",
    "seriesId": "C04",
    "year": 2027,
    "name": "IM²C / IMMC：International Mathematical Modeling Challenge（国际数学建模挑战赛）",
    "shortName": "IM²C / IMMC",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "COMAP 与 NeoUnion 等国际及区域组织",
    "eligibility": "中学学生团队；各国家和地区参赛及选拔资格依当地组织规则。全球窗口不等于中华区报名或具体作答时间。",
    "description": "国际中学生数学建模挑战赛。2027 全球赛季窗口已公布，各国家及地区负责本地选拔安排。",
    "scheduleNote": "全球赛季窗口：2027-02-01—04-26。入选团队连续 5 天完成任务；不同国家、地区的选拔及团队具体作答窗口需向当地组织确认，中华区日期仍待公布。",
    "status": "scheduled",
    "timeZone": "America/New_York",
    "websiteUrl": "https://immchallenge.org/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "COMAP 公告：2027 全球窗口",
        "url": "https://comap.org/blog/item/2026-immc-summit"
      },
      {
        "title": "IM²C 全球赛事说明",
        "url": "https://immchallenge.org/immc-challenge/"
      },
      {
        "title": "中华区官方入口（区域赛程另行公布）",
        "url": "https://www.immchallenge.org.hk/"
      }
    ],
    "events": [
      {
        "kind": "competition",
        "label": "全球窗口 · 团队连续 5 天",
        "start": "2027-02-01",
        "end": "2027-04-26"
      }
    ],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": []
  },
  {
    "id": "C05-2027",
    "seriesId": "C05",
    "year": 2027,
    "name": "SCUDEM：Student Challenge Using Differential Equations Modeling（源于 SIMIODE）",
    "shortName": "SCUDEM",
    "category": "international",
    "audiences": [
      "school",
      "undergraduate"
    ],
    "organizer": "往届组织信息：当前由 COMAP 组织；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高中生、本科生",
    "description": "以下为往届赛事介绍，2027 规则待公布。微分或差分方程建模，最终视频不超过 10 分钟；最多 3 人，可跨校，100 美元／队；以 COMAP 本届规则为准。",
    "scheduleNote": "预计 10 月、11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 第十一届：10-16—11-10；报名 07-01—10-16；已核 2026；原文报名截至 10-16 14:00 前、比赛起止均为 15:00，标注 EST，时区转换需确认。赛事主页、本届规则",
    "status": "estimated",
    "timeZone": "America/New_York",
    "websiteUrl": "https://www.contest.comap.com/scudem/index.html",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 赛事主页",
        "url": "https://www.contest.comap.com/scudem/index.html"
      },
      {
        "title": "往届参考 · 本届规则",
        "url": "https://www.contest.comap.com/scudem/instructions.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-10",
      "2027-11"
    ]
  },
  {
    "id": "C06-2027",
    "seriesId": "C06",
    "year": 2027,
    "name": "MathWorks Math Modeling Challenge（M3 Challenge）",
    "shortName": "M3 Challenge",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "往届组织信息：SIAM 主办，MathWorks 赞助；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：美国高中高年级、英格兰及威尔士 sixth-form 学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。报名截至 02-20 17:00 美东；免费；有明确学校所在地限制，中国大陆普通学校学生不能据“国际赛”名称认定可直接参赛。",
    "scheduleNote": "预计 2 月、3 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-02-27—03-02（美东），窗口内自选连续 14 小时；已核 2026。SIAM 本届通知、官方规则 PDF",
    "status": "estimated",
    "timeZone": "America/New_York",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · SIAM 本届通知",
        "url": "https://m3challenge.siam.org/newsroom/mathworks-math-modeling-challenge-registration-opens-for-2026/"
      },
      {
        "title": "往届参考 · 官方规则 PDF",
        "url": "https://m3challenge.siam.org/wp-content/uploads/01-M3_Official_Rules_and_Guidelines.pdf"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-02",
      "2027-03"
    ]
  },
  {
    "id": "C07-2027",
    "seriesId": "C07",
    "year": 2027,
    "name": "Wiskunde A-dag（原 Wiskunde A-lympiade）",
    "shortName": "Wiskunde A-dag",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "往届组织信息：荷兰乌得勒支大学 Freudenthal 体系；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：中学高年级",
    "description": "以下为往届赛事介绍，2027 规则待公布。3—4 人团队，初赛约 7 小时；除荷兰外有德国、日本等国家的组织渠道；另有师范生组，中国学校准入需核实。",
    "scheduleNote": "预计 11 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：初赛 2026-11-13—11-27 任选一日；国际决赛 2027-03-12—03-13；已核 2026—2027 赛季，不能当作全球统一一天的线上比赛。乌得勒支大学官方页\n2027 年 3 月 12—13 日是 2026—2027 赛季的已公布决赛，已保留在原赛季记录中，不重复复制。",
    "status": "estimated",
    "timeZone": "Europe/Amsterdam",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 乌得勒支大学官方页",
        "url": "https://www.uu.nl/onderwijs/reken-wiskundedagen/evenementen/wiskunde-a-dag"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-11"
    ]
  },
  {
    "id": "C08-2027",
    "seriesId": "C08",
    "year": 2027,
    "name": "New Zealand Engineering Science Competition",
    "shortName": "NZ Engineering Science",
    "category": "international",
    "audiences": [
      "school"
    ],
    "organizer": "往届组织信息：奥克兰大学工程科学相关院系；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：新西兰中学 Year 12／13",
    "description": "以下为往届赛事介绍，2027 规则待公布。工程场景的估计、建模与方案论证；学校团队通常 3—4 人；地域受限。",
    "scheduleNote": "预计 8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-08-08；学校报名 06-01—07-31；已核 2026。奥克兰大学赛事页、竞赛细则",
    "status": "estimated",
    "timeZone": "Pacific/Auckland",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 奥克兰大学赛事页",
        "url": "https://www.auckland.ac.nz/en/engineering/about-the-faculty/engineering/engineering-science/new-zealand-engineering-science-competition.html"
      },
      {
        "title": "往届参考 · 竞赛细则",
        "url": "https://www.auckland.ac.nz/en/engineering/about-the-faculty/engineering/engineering-science/new-zealand-engineering-science-competition/competition-details.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-08"
    ]
  },
  {
    "id": "D01-2027",
    "seriesId": "D01",
    "year": 2027,
    "name": "杭州电子科技大学数学建模竞赛",
    "shortName": "杭州电子科技大学数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校学生；报名截至 05-27；校内建模与人才选拔",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校学生；报名截至 05-27；校内建模与人才选拔",
    "scheduleNote": "预计 5 月、6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：05-28 18:00—06-01 22:00；教务处通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 教务处通知",
        "url": "https://jwc.hdu.edu.cn/2026/0403/c13482a290951/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05",
      "2027-06"
    ]
  },
  {
    "id": "D02-2027",
    "seriesId": "D02",
    "year": 2027,
    "name": "福建技术师范学院数学建模竞赛",
    "shortName": "福建技术师范学院数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校相关年级学生；报名 05-15—05-22；多日论文赛",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校相关年级学生；报名 05-15—05-22；多日论文赛",
    "scheduleNote": "预计 5 月、6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：05-23 18:00—06-06 18:00；教务处通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 教务处通知",
        "url": "https://jwc.fpnu.edu.cn/info/1621/13203.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05",
      "2027-06"
    ]
  },
  {
    "id": "D03-2027",
    "seriesId": "D03",
    "year": 2027,
    "name": "福建农林大学数学建模校内竞赛",
    "shortName": "福建农林大学数学建模校内竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校学生；暑期建模训练与选拔",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校学生；暑期建模训练与选拔",
    "scheduleNote": "预计 8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：08-13—08-16；学校通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 学校通知",
        "url": "https://xczx.fafu.edu.cn/9f/25/c11092a433957/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-08"
    ]
  },
  {
    "id": "D04-2027",
    "seriesId": "D04",
    "year": 2027,
    "name": "河南工学院大学生数学建模竞赛",
    "shortName": "河南工学院大学生数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校学生；08-03 评阅，开赛与答辩分别记日历节点",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校学生；08-03 评阅，开赛与答辩分别记日历节点",
    "scheduleNote": "预计 7 月、8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：07-30—08-02；08-04 答辩；理学部通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 理学部通知",
        "url": "https://lxb.hait.edu.cn/info/1003/3515.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-07",
      "2027-08"
    ]
  },
  {
    "id": "D05-2027",
    "seriesId": "D05",
    "year": 2027,
    "name": "重庆大学春季数学建模竞赛",
    "shortName": "重庆大学春季数学建模竞赛",
    "category": "campus",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校学生；本次尚未核清作品截止，不把结果发布日期当作比赛结束时间",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校学生；本次尚未核清作品截止，不把结果发布日期当作比赛结束时间",
    "scheduleNote": "预计 5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：05-01 发布赛题；06-12 已发布结果；赛题通知、结果公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 赛题通知",
        "url": "https://sci.cqu.edu.cn/info/1176/8840.htm"
      },
      {
        "title": "往届参考 · 结果公告",
        "url": "https://sci.cqu.edu.cn/info/1176/8907.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05"
    ]
  },
  {
    "id": "D06-2027",
    "seriesId": "D06",
    "year": 2027,
    "name": "桂林电子科技大学研究生数学建模校内选拔赛",
    "shortName": "桂林电子科技大学研究生数学建模校内选拔赛",
    "category": "campus",
    "audiences": [
      "graduate"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校研究生；面向华为杯组队与选拔；具体作答窗口部分待核",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校研究生；面向华为杯组队与选拔；具体作答窗口部分待核",
    "scheduleNote": "预计 6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：6 月；06-05 通知，06-30 结果；研究生院通知、结果公告",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 研究生院通知",
        "url": "https://www.guet.edu.cn/gra/2026/0605/c6074a154896/page.htm"
      },
      {
        "title": "往届参考 · 结果公告",
        "url": "https://www.guet.edu.cn/gra/2026/0630/c6074a156853/page.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-06"
    ]
  },
  {
    "id": "D07-2027",
    "seriesId": "D07",
    "year": 2027,
    "name": "广西信息职业技术学院数学建模竞赛",
    "shortName": "广西信息职业技术学院数学建模竞赛",
    "category": "campus",
    "audiences": [
      "vocational"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校学生，3 人团队；覆盖高职学生的校内训练需求",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校学生，3 人团队；覆盖高职学生的校内训练需求",
    "scheduleNote": "预计 6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：06-05—06-08；学校通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 学校通知",
        "url": "https://www.gxuie.cn/info/1091/44392.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-06"
    ]
  },
  {
    "id": "D08-2027",
    "seriesId": "D08",
    "year": 2027,
    "name": "陕西师范大学数学建模校赛",
    "shortName": "陕西师范大学数学建模校赛",
    "category": "campus",
    "audiences": [
      "undergraduate"
    ],
    "organizer": "往届组织信息：；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：本校 2024、2025 级全日制本科生；报名截至 06-15 12:00；选拔全国赛队员",
    "description": "以下为往届赛事介绍，2027 规则待公布。本校 2024、2025 级全日制本科生；报名截至 06-15 12:00；选拔全国赛队员",
    "scheduleNote": "预计 6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：06-18 18:00—06-21 22:00；教务处本届通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 教务处本届通知",
        "url": "https://jwc.snnu.edu.cn/info/1623/30904.htm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-06"
    ]
  },
  {
    "id": "E01-2027",
    "seriesId": "E01",
    "year": 2027,
    "name": "大学生“麟创杯”数学建模竞赛",
    "shortName": "大学生“麟创杯”数学建模竞赛",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：中国技术市场协会数智技术专业委员会等；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：大学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。个人线上闭卷知识考试，第二场在指定窗口内任选 1 小时、50 道客观题；后续场次按单场通知建档",
    "scheduleNote": "预计 4 月、6 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 已核 04-25、06-27 场次；第二场考试通知、报名通知、常见问题",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 第二场考试通知",
        "url": "https://m.saikr.com/contest/notice_detail/41978"
      },
      {
        "title": "往届参考 · 报名通知",
        "url": "https://m.saikr.com/contest/notice_detail/39940"
      },
      {
        "title": "往届参考 · 常见问题",
        "url": "https://www.saikr.com/c/nd/41034"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-06"
    ]
  },
  {
    "id": "E02-2027",
    "seriesId": "E02",
    "year": 2027,
    "name": "东方创新杯全国大学生数学建模大赛",
    "shortName": "东方创新杯全国大学生数学建模大赛",
    "category": "knowledge",
    "audiences": [
      "undergraduate",
      "other"
    ],
    "organizer": "往届组织信息：华夏文化促进会文化和科技融合工作委员会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生及相关社会人士",
    "description": "以下为往届赛事介绍，2027 规则待公布。个人考试；初赛为选择、判断等客观题，决赛增加计算题；决赛日期已调整，不能使用旧的单日 06-13",
    "scheduleNote": "预计 5 月、6 月、7 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026 多场；已核 05-30 初赛、06-13—06-14 第一场决赛；报名总截止 07-26；本届报名规则、初赛通知、决赛调整通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届报名规则",
        "url": "https://new.saikr.com/vse/SXJM"
      },
      {
        "title": "往届参考 · 初赛通知",
        "url": "https://m.saikr.com/contest/notice_detail/43225"
      },
      {
        "title": "往届参考 · 决赛调整通知",
        "url": "https://m.saikr.com/contest/notice_detail/43819"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-05",
      "2027-06",
      "2027-07"
    ]
  },
  {
    "id": "E03-2027",
    "seriesId": "E03",
    "year": 2027,
    "name": "数学周报全国大学生数学能力大赛—数学建模赛道",
    "shortName": "数学周报全国大学生数学能力大赛—数学建模赛道",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：数学周报社；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：高校学生等",
    "description": "以下为往届赛事介绍，2027 规则待公布。基础模型、数学知识与计算题考试；与 A27 的“数学建模大赛”分开，不能因主办相同而合并",
    "scheduleNote": "2027 赛程待公布；目前资料不足以推定比赛月份。\n往届依据：2026 第五届，官网列报名至 08-23；单场考试日期待核；本届活动主页、往届赛道规则及本届入口提示",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 本届活动主页",
        "url": "https://sxzbmath.saikr.com/"
      },
      {
        "title": "往届参考 · 往届赛道规则及本届入口提示",
        "url": "https://www.saikr.com/vse/sxzb2ndjm"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": []
  },
  {
    "id": "E04-2027",
    "seriesId": "E04",
    "year": 2027,
    "name": "科创杯大学生数学建模竞赛—知识赛道",
    "shortName": "科创杯大学生数学建模竞赛—知识赛道",
    "category": "knowledge",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：创赛云（陕西）教育科技有限合伙企业；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：大学生",
    "description": "以下为往届赛事介绍，2027 规则待公布。在线知识测评，有题库和模拟练习；与 A23 共用品牌，但作品要求不同",
    "scheduleNote": "2027 赛程待公布；目前资料不足以推定比赛月份。\n往届依据：2026-12-01 24:00 前自选考试时间；官网知识赛道说明",
    "status": "tba",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": "https://www.simcm.org.cn/",
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 官网知识赛道说明",
        "url": "https://www.simcm.org.cn/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": []
  },
  {
    "id": "F01-2027",
    "seriesId": "F01",
    "year": 2027,
    "name": "全国高校密码数学挑战赛",
    "shortName": "全国高校密码数学挑战赛",
    "category": "adjacent",
    "audiences": [
      "other"
    ],
    "organizer": "往届组织信息：中国密码学会密码数学理论专业委员会、天融信科技集团；2026 南开大学承办；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：具体参赛资格以当届官方规程为准。",
    "description": "以下为往届赛事介绍，2027 规则待公布。密码数学、算法研究与计算验证，专业门槛较高；不能与“全国密码技术竞赛”混为一项",
    "scheduleNote": "预计 3 月、4 月、5 月、6 月、8 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：2026-03-31 发布赛题；06-30 报名及作品截止；计划 8 月总决赛；学会年度计划、本届赛题通知转发、赛事入口",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 学会年度计划",
        "url": "https://www.cacrnet.org.cn/site/content/1719.html"
      },
      {
        "title": "往届参考 · 本届赛题通知转发",
        "url": "https://www.cmathc.org.cn/mcm/st/434.html"
      },
      {
        "title": "往届参考 · 赛事入口",
        "url": "https://www.cmsecc.com/"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-08"
    ]
  },
  {
    "id": "F02-2027",
    "seriesId": "F02",
    "year": 2027,
    "name": "正大杯全国大学生市场调查与分析大赛",
    "shortName": "正大杯全国大学生市场调查与分析大赛",
    "category": "adjacent",
    "audiences": [
      "undergraduate",
      "vocational",
      "graduate"
    ],
    "organizer": "往届组织信息：中国商业统计学会；2027 主办与承办安排待公布。",
    "eligibility": "2027 参赛资格待主办方确认。往届参考：专科、本科、研究生及在华留学生组",
    "description": "以下为往届赛事介绍，2027 规则待公布。调查设计、抽样、统计分析与报告答辩；跨学年赛季，各组赛程不同；不等同于纯数学建模命题赛",
    "scheduleNote": "预计 4 月、5 月，仅据往届月份安排备赛，不代表已公布 2027 日期。\n往届依据：第十六届：2025 年秋报名，2026 年 4—5 月省赛／国赛阶段；主办学会本届通知",
    "status": "estimated",
    "timeZone": "Asia/Shanghai",
    "websiteUrl": null,
    "registrationUrl": null,
    "sources": [
      {
        "title": "往届参考 · 主办学会本届通知",
        "url": "https://www.china-cssc.org/show-568-1912-1.html"
      }
    ],
    "events": [],
    "verifiedAt": "2026-09-13",
    "estimatedMonths": [
      "2027-04",
      "2027-05"
    ]
  }
];

/**
 * 展示名一律取 i18n（\`competitions.*\` 命名空间），这里只给「键后缀映射」，
 * 避免文案在代码里再抄一份。
 */

/** 分类 → i18n 路径后缀（competitions.categories.<x>） */
export const CATEGORY_KEY: Record<CompetitionCategory, string> = {
  national: 'national',
  regional: 'regional',
  international: 'international',
  campus: 'campus',
  knowledge: 'knowledge',
  adjacent: 'adjacent',
  historical: 'historical',
};

/**
 * 赛事状态 → i18n 路径后缀（competitions.stages.<x>）。
 * 注意应用约定把「已公布/预计/待定/暂停/历史」与「即将开始/比赛中/已结束」
 * 分开表达：前者是数据状态，后者是相对当前时间的展示阶段。
 */
export const STATUS_KEY: Record<CompetitionStatus, string> = {
  scheduled: 'tba',
  estimated: 'estimated',
  tba: 'tba',
  paused: 'paused',
  historical: 'historical',
};

/** 时间节点 → i18n 路径后缀（competitions.kinds.<x>） */
export const EVENT_KIND_KEY: Record<EventKind, string> = {
  registration: 'registration',
  competition: 'competition',
  submission: 'submission',
};

/** 受众 → i18n 路径后缀（competitions.audiences.<x>） */
export const AUDIENCE_KEY: Record<CompetitionAudience, string> = {
  undergraduate: 'undergraduate',
  vocational: 'vocational',
  graduate: 'graduate',
  teacher: 'teacher',
  school: 'school',
  other: 'other',
};

/**
 * 根据当前时间推算赛事的展示阶段（competitions.stages.<x>）。
 * 当前有此概念：upcoming / ongoing / ended / estimated / tba / paused / historical。
 */
export function stageOf(c: Competition, now = new Date()): string {
  if (c.status === 'paused') return 'paused';
  if (c.status === 'historical') return 'historical';
  if (c.status === 'estimated') return 'estimated';
  if (c.status === 'tba' || c.events.length === 0) return 'tba';

  const comp = c.events.filter((e) => e.kind === 'competition');
  if (!comp.length) return 'tba';

  const t = now.getTime();
  let started = false;
  let ended = true;
  for (const e of comp) {
    const s = Date.parse(e.start);
    const en = e.end ? Date.parse(e.end) : s;
    if (Number.isNaN(s)) continue;
    if (t >= s) started = true;
    if (t <= en) ended = false;
  }
  if (ended) return 'ended';
  if (started) return 'ongoing';
  return 'upcoming';
}

/** 全部赛事系列（去掉年份后缀，用于「全部赛事」列表） */
export function competitionSeries(): Array<{
  seriesId: string;
  name: string;
  shortName: string;
  category: CompetitionCategory;
}> {
  const seen = new Map<
    string,
    { seriesId: string; name: string; shortName: string; category: CompetitionCategory }
  >();
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
