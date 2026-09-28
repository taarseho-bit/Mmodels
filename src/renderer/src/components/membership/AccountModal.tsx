import type { AccountStatusInfo } from '@shared/types';
import { t } from '../../i18n';
import { Icon } from '../Icon';
import { AccountSection } from '../settings/AccountSection';

export function AccountModal({
  open,
  onClose,
  onOpenMembership,
  onStatusChange,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMembership: () => void;
  onStatusChange: (status: AccountStatusInfo) => void;
}): JSX.Element | null {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal account-center-dialog" role="dialog" aria-modal="true" aria-labelledby="account-center-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span id="account-center-title" className="modal-title">{t('账号与会员')}</span>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body account-center-body">
          <AccountSection standalone onStatusChange={onStatusChange} onOpenMembership={onOpenMembership} />
        </div>
      </div>
    </div>
  );
}
