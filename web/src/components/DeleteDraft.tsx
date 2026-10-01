import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/primitives';

/** Deletes an unfinished draft (owner request 2026-10-01). The form numbers after it adjust by themselves. */
export function DeleteDraft({ kind, id, name, to, size = 'sm' }: { kind: 'transfer' | 'receiving' | 'count' | 'inspection'; id: string; name: string; to: string; size?: 'sm' | 'md' }) {
  const nav = useNavigate(); const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.delete<{ deleted: string; renumbered: { from: string; to: string }[] }>(`/api/drafts/${kind}/${id}`),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      if (r.renumbered.length) window.alert(`Deleted ${r.deleted}.\n\nThe form numbers were adjusted:\n${r.renumbered.map((m) => `${m.from} is now ${m.to}`).join('\n')}`);
      nav(to);
    },
    onError: (e: unknown) => window.alert((e as Error).message || 'Could not delete the draft'),
  });
  return <Button size={size} variant="danger" disabled={del.isPending} onClick={() => { if (window.confirm(`Delete the draft ${name}?\n\nIt is removed for good. The numbers of the drafts after it move down by one so there is no gap.`)) del.mutate(); }} data-testid="delete-draft">Delete draft</Button>;
}
