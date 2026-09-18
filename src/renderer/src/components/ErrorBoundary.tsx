/**
 * 错误边界。
 *
 * 桌面应用最怕白屏 —— 一个组件抛错，用户看到的是全黑窗口，
 * 完全不知道发生了什么，也没法反馈。这个边界保证至少能给出：
 *   1. 出错的组件栈
 *   2. 错误信息
 *   3. 一键重试 / 复制错误
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';
import { t, tx } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] 未捕获的组件错误:', error, info);
    this.setState({ info });
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  private copy = (): void => {
    const { error, info } = this.state;
    const text = [
      `${t('错误：')}${error?.message ?? tx('common.unknown')}`,
      '',
      t('调用栈：'),
      error?.stack ?? '(无)',
      '',
      t('组件栈：'),
      info?.componentStack ?? '(无)',
    ].join('\n');
    void navigator.clipboard.writeText(text);
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div style={{ marginBottom: 8 }}>
          <Icon name="triangle-alert" size={32} />
        </div>
        <h2 style={{ marginTop: 0 }}>{t('界面出现异常')}</h2>
        <p className="secondary" style={{ lineHeight: 1.7 }}>
          {t('这不是致命错误，应用其他部分仍然可用。你可以尝试重试；如果反复出现，请把下面的信息复制出来反馈。')}
        </p>

        <div className="row" style={{ gap: 8, margin: '16px 0' }}>
          <button className="btn btn-primary" onClick={this.reset}>
            {tx('common.retry')}
          </button>
          <button className="btn" onClick={this.copy}>
            {t('复制错误信息')}
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            {t('重新加载界面')}
          </button>
        </div>

        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('错误信息')}</div>
        <pre>{error.message}</pre>

        {error.stack && (
          <>
            <div style={{ fontWeight: 600, margin: '14px 0 6px' }}>{t('调用栈')}</div>
            <pre>{error.stack}</pre>
          </>
        )}

        {info?.componentStack && (
          <>
            <div style={{ fontWeight: 600, margin: '14px 0 6px' }}>{t('组件栈')}</div>
            <pre>{info.componentStack}</pre>
          </>
        )}
      </div>
    );
  }
}
