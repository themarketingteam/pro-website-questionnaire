import { ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { changeRecoveryRecordLifecycle } from '@/lib/draftRecoveryApi';

export default function RecoveryLifecycleActions({
  recordType,
  record,
  recoveryGrant,
  disabled = false,
  onChanged,
}) {
  const isDeleted = Boolean(record?.soft_deleted_at);

  const changeState = async (event) => {
    event?.stopPropagation?.();
    let reason = '';
    const action = isDeleted ? 'restore' : 'soft_delete';

    if (!isDeleted) {
      reason = window.prompt('Why should this record be moved to Deleted Records?')?.trim() || '';
      if (!reason) return;
      if (!window.confirm('Move this record to Deleted Records? It will remain retained and can be restored.')) return;
    }

    try {
      const data = await changeRecoveryRecordLifecycle({
        recoveryGrant,
        recordType,
        recordId: record.id,
        action,
        reason,
      });
      toast.success(isDeleted ? 'Recovery record restored.' : 'Recovery record moved to Deleted Records.');
      onChanged?.(data.record);
    } catch (error) {
      toast.error(error?.message || 'Unable to change the recovery record state.');
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={isDeleted ? 'brand-button-secondary gap-2' : 'gap-2 border-red-200 text-red-700 hover:bg-red-50'}
      disabled={disabled}
      onClick={changeState}
    >
      {isDeleted ? <ArchiveRestore className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
      {isDeleted ? 'Restore Record' : 'Move to Deleted'}
    </Button>
  );
}
