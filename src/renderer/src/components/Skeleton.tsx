/**
 * 骨架屏 —— 按语义对应应用约定 `Skeleton` chunk。
 *
 * 应用约定实现（`Skeleton-C3dMNXDK.js`）：
 *   <div className="animate-pulse rounded-md bg-muted" />
 * 这里用等价的 CSS 类 `.skeleton` 实现（本项目不用 tailwind）。
 */

interface SkeletonProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  /** 圆角形态 */
  radius?: 'sm' | 'md' | 'lg' | 'full';
  style?: React.CSSProperties;
}

export function Skeleton({
  className = '',
  width,
  height,
  radius = 'md',
  style,
}: SkeletonProps): JSX.Element {
  return (
    <div
      className={`skeleton skeleton-${radius} ${className}`.trim()}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  );
}

/** 多行文本骨架 */
export function SkeletonLines({
  lines = 3,
  gap = 8,
}: {
  lines?: number;
  gap?: number;
}): JSX.Element {
  return (
    <div className="col" style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '62%' : '100%'} />
      ))}
    </div>
  );
}

/** 卡片列表骨架 */
export function SkeletonCards({ count = 4, height = 64 }: { count?: number; height?: number }): JSX.Element {
  return (
    <div className="col" style={{ gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} radius="lg" />
      ))}
    </div>
  );
}
