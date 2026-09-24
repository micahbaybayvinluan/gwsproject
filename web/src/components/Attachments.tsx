import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, Empty, ErrorBox } from './ui/primitives';

/** §13 attachments panel: upload (photo/PDF/xlsx), preview, download. */
export function Attachments({ type, id, onUploaded }: { type: string; id: string; onUploaded?: (a: { id: string }) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attachments', type, id], queryFn: () => api.get<{ id: string; fileName: string; contentType: string; sizeBytes: number; scanStatus: string }[]>(`/api/attachments/${type}/${id}`) });
  const up = useMutation({ mutationFn: (f: File) => api.upload<{ id: string }>(`/api/attachments/${type}/${id}`, f), onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['attachments', type, id] }); onUploaded?.(a); } });
  return <Card title="Attachments" actions={<label className="cursor-pointer"><span className="inline-flex min-h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm">{up.isPending ? 'Uploading…' : 'Upload'}</span><input type="file" className="hidden" accept="image/*,application/pdf,.xlsx" capture="environment" onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} /></label>}>
    <ErrorBox error={up.error} />
    {!q.data?.length ? <Empty>No attachments</Empty> : <ul className="divide-y text-sm">{q.data.map((a) => <li key={a.id} className="flex items-center justify-between gap-2 py-2"><span>{a.fileName} <span className="text-xs text-slate-500">({Math.round(a.sizeBytes / 1024)} KB · {a.scanStatus})</span></span><Button size="sm" variant="outline" onClick={() => api.download(`/api/attachments/file/${a.id}`, a.fileName)}>Open</Button></li>)}</ul>}
  </Card>;
}
