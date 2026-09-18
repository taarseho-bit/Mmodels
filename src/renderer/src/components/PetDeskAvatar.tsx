import './pet-desk.css';

export const PET_APPEARANCES = [
  { id: 'student', name: '卫衣同学', description: '奶油色书桌、紫色卫衣，陪你一起拆题。' },
  { id: 'pixel', name: '探险家', description: '背着行囊跃过方块，举起地图寻找下一条路。' },
  { id: 'researcher', name: '漫画研究员', description: '站着翻阅笔记，用放大镜捕捉遗漏的线索。' },
  { id: 'astronaut', name: '太空建模员', description: '失重漂浮、探索星球，伸手收集宇宙中的灵感。' },
] as const;
export type PetAppearance = typeof PET_APPEARANCES[number]['id'];
export function resolvePetAppearance(value: unknown): PetAppearance {
  return PET_APPEARANCES.find((item) => item.id === value)?.id ?? 'student';
}

function PixelExplorer(): JSX.Element {
  return <svg className="pet-desk-avatar pixel-explorer" viewBox="0 0 220 190" role="img" aria-label="像素探险家背着行囊在方块地形探索" shapeRendering="crispEdges">
    <path d="M18 158h61v12H18m52-26h65v14H70m61-34h64v14h-64" fill="#72b887" />
    <path d="M18 170h61v16H18m52-28h65v20H70m61-34h64v23h-64" fill="#ad815f" />
    <path d="M28 173h9v7h-9m55-13h10v6H83m66-27h8v7h-8" fill="#d3af78" />
    <g className="pixel-treasure" fill="#efbc58"><path d="m173 58 10-10 10 10-10 12z" /><path d="M35 50h5v5h-5m123-24h4v4h-4" /></g>
    <g className="pixel-walker">
      <path d="M61 77H48v43h20" fill="#7c657b" /><path d="M49 86h12v19H49" fill="#b39791" />
      <path d="M66 33h34v8h9v35h-8v8H66v-8h-8V41h8z" fill="#f2c593" />
      <path d="M59 36h8V24h33v9h10v16H78v-7H59" fill="#4d3f58" />
      <path d="M62 29h42v12H62m-9 0h65v7H53" fill="#d49c50" /><path d="M66 37h37v4H66" fill="#926439" />
      <g className="desk-eyes" fill="#37394e"><path d="M73 55h5v7h-5m20-7h5v7h-5" /></g>
      <path d="M81 70h12v3H81" fill="#b77468" />
      <path d="M64 84h38v40H64" fill="#db9860" /><path d="M68 84h7v39h-7m22-39h7v39h-7" fill="#776279" />
      <g className="pixel-boot-left"><path d="M66 124h13v20H66" fill="#526276" /><path d="M59 142h21v9H59" fill="#3a3a51" /></g>
      <g className="pixel-boot-right"><path d="M88 124h13v14H88" fill="#526276" /><path d="M88 136h23v9H88" fill="#3a3a51" /></g>
      <g className="pixel-map"><path d="M99 91h16v15H99" fill="#f2c593" /><path d="m109 74 17 5 15-5 17 5v39l-17-5-15 5-17-5z" fill="#f3e3b5" /><path d="M126 80v32m15-33v31" stroke="#cfbb91" strokeWidth="2" /><path d="m116 102 11-14 13 12 9-12" fill="none" stroke="#79a481" strokeWidth="3" /></g>
      <path d="M59 91h9v22h-9v8h-9v-13h9z" fill="#f2c593" />
    </g>
    <path d="M185 107V82m0 0h17l-6 9h-11" fill="#b989ca" stroke="#725880" strokeWidth="3" />
  </svg>;
}

function FieldResearcher(): JSX.Element {
  return <svg className="pet-desk-avatar field-researcher" viewBox="0 0 220 190" role="img" aria-label="漫画研究员站着拿笔记本和放大镜寻找线索">
    <ellipse cx="110" cy="177" rx="65" ry="7" fill="#314b4220" />
    <g className="research-notes" fill="#f7eacb" stroke="#d0bb91" strokeWidth="1.5"><path d="m27 50 29-5 6 40-29 5z" /><path d="m161 25 33 7-8 40-33-7z" /></g>
    <g stroke="#94b3a1" strokeWidth="2" fill="none"><path d="m36 62 15-3m-13 11 13-3m116-27 15 3m-17 6 13 3" /></g>
    <g className="research-person">
      <path d="M91 135v31m24-31 3 31" stroke="#4e5664" strokeWidth="13" strokeLinecap="round" />
      <path d="M83 166h16v9H79q-3-5 4-9m28 0h13l9 6v4h-24z" fill="#3e414f" />
      <path d="M78 79q24-13 48 0l7 63H72z" fill="#faf7e9" stroke="#c5cabe" strokeWidth="2" />
      <path d="m91 78 12 20 12-20v53H90z" fill="#6fab98" /><path d="m85 78 16 18-13 10-8-9m40-19-16 18 13 10 9-10" fill="#e0e9dd" />
      <g className="research-head"><ellipse cx="101" cy="45" rx="28" ry="31" fill="#f8d1b3" /><path d="M73 44Q63 10 88 10q33-12 42 15l-3 26-12-27q-16 19-33 9l-7 19z" fill="#51454c" /><path d="M127 29q20 5 13 25l-13-7" fill="#51454c" />
        <g className="desk-eyes" fill="#353c47"><circle cx="91" cy="48" r="3" /><circle cx="113" cy="48" r="3" /></g>
        <g fill="none" stroke="#475a61" strokeWidth="2.5"><circle cx="90" cy="48" r="10" /><circle cx="114" cy="48" r="10" /><path d="M100 46h4" /></g><path d="M96 62q5 4 10-1" fill="none" stroke="#b17370" strokeWidth="2" />
      </g>
      <path d="M79 88 64 116l21 5" fill="none" stroke="#e5eadd" strokeWidth="13" strokeLinecap="round" />
      <g className="research-book"><path d="m74 106 21-4 12 5 19-2-4 32-18 2-12-5-20 3z" fill="#547e72" /><path d="m78 109 16-3 11 5 16-2-3 24-14 2-11-5-17 2z" fill="#fff2cf" /><path d="m95 109-2 20m13-16-2 19m-23-17 8-1m19 4 8-1" stroke="#c5b78c" strokeWidth="1.5" /><ellipse cx="79" cy="124" rx="7" ry="5" fill="#f8d1b3" /></g>
      <g className="research-lens"><path d="m125 87 19 14 12-23" fill="none" stroke="#e5eadd" strokeWidth="12" strokeLinecap="round" /><path d="m151 82 9-16" stroke="#526c6c" strokeWidth="6" strokeLinecap="round" /><circle cx="168" cy="50" r="21" fill="#b9e8e780" stroke="#597e7d" strokeWidth="5" /><path d="M155 47q2-9 10-10" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" /><ellipse cx="152" cy="83" rx="6" ry="7" fill="#f8d1b3" /></g>
    </g>
  </svg>;
}

function SpaceExplorer(): JSX.Element {
  return <svg className="pet-desk-avatar space-explorer" viewBox="0 0 220 190" role="img" aria-label="太空建模员在失重状态下漂浮探索星球">
    <g className="space-stars" fill="#a5afd9"><path d="m31 32 3-9 3 9 9 3-9 3-3 9-3-9-9-3zM174 91l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" /><circle cx="184" cy="23" r="2" /><circle cx="20" cy="108" r="2" /><circle cx="143" cy="13" r="2" /><circle cx="201" cy="132" r="3" /></g>
    <g className="space-planet"><circle cx="176" cy="153" r="25" fill="#b5a4dc" /><path d="M161 137q16 1 26 10m-30 9q19-1 35 10" stroke="#9585c5" strokeWidth="5" fill="none" /><ellipse cx="176" cy="153" rx="39" ry="9" transform="rotate(-25 176 153)" fill="none" stroke="#d5bda0" strokeWidth="5" /></g>
    <path className="space-tether" d="M89 112Q19 173 38 127T29 63" fill="none" stroke="#a7b9d4" strokeWidth="3" strokeDasharray="5 3" />
    <g className="space-floater">
      <rect x="71" y="66" width="28" height="60" rx="10" fill="#8a9dbd" />
      <g className="space-legs" fill="none" strokeLinecap="round"><path d="m100 120-20 18-18-7m50-4 8 22-17 14" stroke="#c5d3e7" strokeWidth="16" /><path d="m62 131-9-3m50 35-8 7" stroke="#788aac" strokeWidth="17" /></g>
      <rect x="85" y="69" width="45" height="65" rx="19" fill="#e7eff7" stroke="#a2b6d0" strokeWidth="2" />
      <rect x="98" y="87" width="22" height="26" rx="5" fill="#a2b9d7" /><path d="M102 93h14m-14 6h7" stroke="#defaff" strokeWidth="3" /><circle cx="113" cy="106" r="3" fill="#f6ba7d" />
      <path d="M88 86 65 96l-12-14" fill="none" stroke="#d8e4f2" strokeWidth="14" strokeLinecap="round" /><ellipse cx="52" cy="80" rx="8" ry="9" fill="#97accb" />
      <g className="space-reach"><path d="m125 82 20-11 9-19" fill="none" stroke="#e7eff7" strokeWidth="14" strokeLinecap="round" /><ellipse cx="154" cy="49" rx="8" ry="9" fill="#97accb" /></g>
      <circle cx="105" cy="46" r="34" fill="#e9f3fc" stroke="#a4b7d2" strokeWidth="3" /><ellipse cx="107" cy="45" rx="27" ry="26" fill="#425477" />
      <ellipse cx="108" cy="47" rx="19" ry="21" fill="#f5ceb1" /><path d="M89 43q-2-23 18-23 20 0 20 19l-12-10-14 11-7-7z" fill="#605269" />
      <g className="desk-eyes" fill="#34374f"><circle cx="102" cy="47" r="2.8" /><circle cx="118" cy="46" r="2.8" /></g><path d="M105 58q5 4 9-1" fill="none" stroke="#b67578" strokeWidth="2" />
      <path d="M86 34q4-11 15-12" fill="none" stroke="#ffffffc0" strokeWidth="4" strokeLinecap="round" /><rect x="71" y="39" width="10" height="16" rx="4" fill="#8398bb" />
    </g>
    <g className="space-sample"><path d="m162 29 10-8 9 9-9 14z" fill="#87d7dc" stroke="#6bbbc7" strokeWidth="2" /><path d="m167 29 6-4" stroke="#e8ffff" strokeWidth="2" /></g>
  </svg>;
}

/** 设置预览与桌面使用同一个角色组件，所有动作均作用于真实角色。 */
export function PetDeskAvatar({ appearance = 'student' }: { appearance?: PetAppearance }): JSX.Element {
  if (appearance === 'pixel') return <PixelExplorer />;
  if (appearance === 'researcher') return <FieldResearcher />;
  if (appearance === 'astronaut') return <SpaceExplorer />;
  const space = false;
  const scholar = false;
  const coat = '#9681da';
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
