import './pet-desk.css';

export const PET_APPEARANCES = [
  { id: 'student', name: '卫衣同学', description: '奶油色书桌、紫色卫衣，陪你一起拆题。' },
  { id: 'pixel', name: '像素小人', description: '复古电脑、小盆栽，一间像素小书房。' },
  { id: 'researcher', name: '漫画研究员', description: '圆框眼镜、薄荷绿针织衫，认真核对每一步。' },
  { id: 'astronaut', name: '太空建模员', description: '透明头盔、星际控制台，在宇宙里寻找答案。' },
] as const;
export type PetAppearance = typeof PET_APPEARANCES[number]['id'];
export function resolvePetAppearance(value: unknown): PetAppearance {
  return PET_APPEARANCES.find((item) => item.id === value)?.id ?? 'student';
}

/** 设置预览与桌面使用同一个角色组件，所有动作均作用于真实角色。 */
export function PetDeskAvatar({ appearance = 'student' }: { appearance?: PetAppearance }): JSX.Element {
  const space = appearance === 'astronaut';
  const scholar = appearance === 'researcher';
  const coat = space ? '#e5edf8' : scholar ? '#69ad99' : '#9681da';
  if (appearance === 'pixel') return (
    <svg className="pet-desk-avatar pet-desk-pixel" viewBox="0 0 220 190" role="img" aria-label="像素小人坐在电脑桌前" shapeRendering="crispEdges">
      <ellipse cx="110" cy="180" rx="95" ry="7" fill="#242c4820" />
      <path d="M43 79h55v64H43z" fill="#465270" /><path d="M52 140h9v33h-9m32-33h9v33h-9" fill="#333b56" />
      <g className="desk-person">
        <path d="M51 20h38v7h8v39h-8v8H50v-9h-8V31h9z" fill="#fac69e" />
        <path d="M43 24h8V14h37v7h10v24h-9V33H75v7H59v-7H43z" fill="#504055" />
        <g className="desk-eyes" fill="#33364e"><path d="M58 46h5v7h-5m20-7h5v7h-5" /></g>
        <path d="M65 61h13v3H65" fill="#ac655f" />
        <path d="M51 77h39v40H48V85h3z" fill="#d88a62" /><path d="M60 78h20v6H60" fill="#ffe5ba" />
        <path d="M52 117h33v26h-8v23H65v-32H52z" fill="#424965" />
        <path d="M62 164h25v8H62z" fill="#292d43" />
        <g className="desk-hand"><path d="M85 83h10v18h21v9H84z" fill="#d88a62" /><path d="M108 100h15v10h-15z" fill="#fac69e" /></g>
      </g>
      <path d="M22 115h177v12H22z" fill="#ba865e" /><path d="M26 127h10v47H26m147-47h10v47h-10" fill="#735440" />
      <path d="M109 47h70v55h-70z" fill="#3b4359" /><path d="M116 54h56v38h-56z" fill="#b4d9ae" />
      <path className="desk-screen-lines" d="M123 62h22v4h-22m0 7h36v4h-36m0 7h16v4h-16" fill="#478365" />
      <path d="M140 102h9v10h-9m-15 0h39v4h-39" fill="#4a526a" />
      <path d="M178 105h17v10h-17" fill="#e8b98a" /><path d="M184 84h6v22h-6m-8-16h8v8h-8m14-17h8v13h-8" fill="#6eac75" />
      <path d="M47 106h27v8H47z" fill="#f4dbac" /><path d="M47 102h25v4H47z" fill="#859bc4" />
    </svg>
  );
  return (
    <svg className={`pet-desk-avatar pet-desk-${appearance}`} viewBox="0 0 220 190" role="img" aria-label={`${PET_APPEARANCES.find((item) => item.id === appearance)?.name}坐在电脑桌前`}>
      <ellipse cx="112" cy="178" rx="94" ry="8" fill="#25234720" />
      {space && <g fill="#b6c7ff"><path d="m18 40 2-7 2 7 7 2-7 2-2 7-2-7-7-2z" /><circle cx="194" cy="25" r="3" /><circle cx="204" cy="58" r="2" /></g>}
      <rect x="36" y="75" width="61" height="66" rx="20" fill={space ? '#545e8e' : scholar ? '#65837d' : '#c4a6bd'} />
      <path d="M53 137v34m29-34v34" stroke="#525575" strokeWidth="7" strokeLinecap="round" />
      <g className="desk-person">
        <path d="M57 116h30v24l-9 24H64l6-30H56" fill={space ? '#c5d5eb' : '#505772'} />
        <path d="M64 161h14l9 7q2 5-5 5H62z" fill={space ? '#858fb2' : '#363952'} />
        <path d="M46 88q1-16 20-16h11q18 1 20 21l-5 26H48z" fill={coat} stroke={space ? '#a6b9d6' : coat} strokeWidth="2" />
        {scholar ? <path d="m62 76 9 13 9-13M71 90v24" fill="#eff8e8" stroke="#416e65" strokeWidth="2" /> : <path d="M59 76q12 18 24 0m-19 8v13m14-13v13" fill="none" stroke={space ? '#7d92b7' : '#d9ccf4'} strokeWidth="3" />}
        <g className="desk-head">
          {space && <circle cx="70" cy="43" r="37" fill="#e6f7ff72" stroke="#b7c9e5" strokeWidth="5" />}
          <ellipse cx="70" cy="43" rx="27" ry="29" fill="#ffd9bc" />
          <path d={scholar ? 'M42 44Q32 4 70 10Q106 9 98 45L87 28Q75 40 57 28L49 45Z' : 'M42 42Q32 12 52 15Q57 2 72 11Q96 5 100 32L97 44 87 27Q78 38 65 29L55 36 51 29Z'} fill={scholar ? '#493e46' : '#61506e'} />
          <g className="desk-eyes" fill="#383344"><ellipse cx="59" cy="47" rx="3" ry="4" /><ellipse cx="80" cy="47" rx="3" ry="4" /><circle cx="60" cy="46" r="1" fill="white" /><circle cx="81" cy="46" r="1" fill="white" /></g>
          {scholar && <g fill="none" stroke="#4a5268" strokeWidth="2"><circle cx="58" cy="47" r="10" /><circle cx="81" cy="47" r="10" /><path d="M68 46h3" /></g>}
          <path d="M65 59q5 5 10 0" fill="none" stroke="#ad6870" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="49" cy="55" rx="5" ry="2" fill="#f1a3a580" /><ellipse cx="91" cy="55" rx="5" ry="2" fill="#f1a3a580" />
          {space && <><path d="M44 24q10-13 20-12" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" /><rect x="32" y="35" width="10" height="20" rx="4" fill="#7c8fc3" /><rect x="98" y="35" width="10" height="20" rx="4" fill="#7c8fc3" /></>}
        </g>
        <g className="desk-hand"><path d="M85 87q6 16 26 17" fill="none" stroke={coat} strokeWidth="14" strokeLinecap="round" /><ellipse cx="115" cy="105" rx="10" ry="6" fill={space ? '#dfeafa' : '#ffd9bc'} /></g>
      </g>
      <path d="M25 120v54m161-54v54" stroke={space ? '#7789bd' : '#b78b6b'} strokeWidth="8" strokeLinecap="round" />
      <rect x="13" y="112" width="190" height="12" rx="5" fill={space ? '#747da9' : scholar ? '#b79272' : '#e4bd97'} />
      <rect x="17" y="112" width="182" height="3" rx="2" fill={space ? '#9ef1ff' : '#f7dbb7'} />
      <g className="desk-computer"><rect x="113" y="53" width="76" height="49" rx="6" fill={space ? '#6574b0' : '#4e536e'} /><rect x="118" y="58" width="66" height="38" rx="3" fill={space ? '#192952' : scholar ? '#d6f1e7' : '#dcdcf8'} />
        <path className="desk-screen-lines" d="M125 84l11-9 10 4 13-13 17 5M125 90h50" fill="none" stroke={space ? '#80edff' : '#8185c2'} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M147 102v9m-13 0h31" stroke="#777d9a" strokeWidth="4" strokeLinecap="round" />
      </g>
      {space ? <g fill="#92e5f2"><circle cx="37" cy="106" r="4" /><circle cx="50" cy="106" r="4" /><circle cx="63" cy="106" r="4" /></g> : <><rect x="31" y="96" width="18" height="16" rx="4" fill={scholar ? '#a5cfb7' : '#f3decc'} /><path d="M49 100q12-2 7 8h-7" fill="none" stroke={scholar ? '#a5cfb7' : '#f3decc'} strokeWidth="3" /><path d="M67 103h27v8H67z" fill="#f7e8c9" /><path d="M67 102h27" stroke="#a89acd" strokeWidth="3" /></>}
    </svg>
  );
}
