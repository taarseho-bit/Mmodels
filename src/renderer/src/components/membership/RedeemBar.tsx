import { useState } from 'react';
import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';

export function RedeemBar({
  onStatusChange,
}: {
  onStatusChange?: (status: AccountStatusInfo) => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const redeem = async (): Promise<void> => {
    if (code.trim().length < 8 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const status = await window.mathmodel.account.redeem({ code: code.trim().toUpperCase() });
      setCode('');
      onStatusChange?.(status);
      setMessage(t('兑换成功，会员时长已叠加'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('兑换失败，请稍后重试'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="membership-redeem">
        <input
          className="input"
          aria-label={t('卡密')}
          placeholder={t('输入卡密，如 XXXX-XXXX-XXXX-XXXX')}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void redeem(); }}
          disabled={busy}
        />
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || code.trim().length < 8} onClick={() => void redeem()}>
          {busy ? t('兑换中…') : t('立即兑换')}
        </button>
      </div>
      {message && <div className="membership-modal-message" role="status">{message}</div>}
    </div>
  );
}
