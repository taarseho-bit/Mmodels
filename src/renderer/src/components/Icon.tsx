/**
 * 图标组件 —— 渲染从项目契约提取的 Lucide 路径数据（见 `./icons/lucide-data.ts`）。
 *
 * 为什么不用 `lucide-react`：
 *   项目契约用 lucide-react，但本项目只需要其中一百多个图标，
 *   而路径数据已从项目契约 chunk 里**逐字提取**。自己渲染零依赖、体积可控，
 *   视觉与项目契约一致（同样的 viewBox、stroke、路径）。
 *
 * 默认参数对齐 lucide 的默认值：
 *   viewBox 0 0 24 24 / fill none / stroke currentColor / stroke-width 2
 *   / linecap round / linejoin round
 */
import { LUCIDE_ICONS, type IconNode } from './icons/lucide-data';

/** 从 camelCase / 下划线写法归一化到 kebab-case 图标名 */
function normalize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

export interface IconProps {
  /** 图标名（kebab-case，与项目契约一致，如 `chart-column`） */
  name: string;
  size?: number | string;
  /** 线宽，lucide 默认 2 */
  strokeWidth?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** 语义标签（无则视为装饰性图标，加 aria-hidden） */
  title?: string;
}

/** 缺图标时的兜底：画一个空心圆，避免整块空白让人误以为样式错 */
function Fallback({ strokeWidth = 2 }: { strokeWidth?: number | string }): JSX.Element {
  return (
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={strokeWidth} data-missing-icon="1" />
  );
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
  style,
  title,
}: IconProps): JSX.Element {
  const key = normalize(name);
  const node: IconNode | undefined = LUCIDE_ICONS[key];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-icon={key}
    >
      {title ? <title>{title}</title> : null}
      {node ? (
        node.map(([tag, attrs], i) => {
          // 用 createElement 而不是手写 JSX：标签名是动态的（path/circle/line/rect/polyline…）
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag key={i} {...(attrs as Record<string, string>)} />;
        })
      ) : (
        <Fallback strokeWidth={strokeWidth} />
      )}
    </svg>
  );
}

/** 资源里是否有这个图标（用于开发期自查） */
export function hasIcon(name: string): boolean {
  return normalize(name) in LUCIDE_ICONS;
}

/** 全部可用图标名（开发期自查用） */
export function iconNames(): string[] {
  return Object.keys(LUCIDE_ICONS).sort();
}
