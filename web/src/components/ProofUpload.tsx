import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Upload the proof of a payment (screenshot, slip, cheque photo): a big box that shows the picture once it is in,
 * so the person sees at once that it is attached. `type` is the kind of record the file belongs to.
 * The report prints these automatically beside the transaction, so nothing needs to be printed and stapled.
 */
export function ProofUpload({ type, label, onChange, required = true, hint }: { type: string; label: string; onChange: (attachmentId: string | null) => void; required?: boolean; hint?: string }) {
  const docId = useMemo(() => crypto.randomUUID(), []);
  const [file, setFile] = useState<File | null>(null); const [url, setUrl] = useState<string | null>(null); const [done, setDone] = useState(false);
  useEffect(() => { if (!file || !file.type.startsWith('image/')) { setUrl(null); return; } const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  const up = useMutation({ mutationFn: (f: File) => api.upload<{ id: string }>(`/api/attachments/${type}/${docId}`, f), onSuccess: (a) => { setDone(true); onChange(a.id); }, onError: () => { setDone(false); onChange(null); } });
  return <div className={`rounded-xl border p-3 ${done ? 'border-emerald-300 bg-emerald-50/60' : required ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50'}`}>
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-slate-700">{label}{required && <span className="text-brand"> *</span>}</div>
        <div className="text-xs text-slate-500">{hint ?? 'Take a photo or choose the screenshot. It is printed with the report, no paper copy needed.'}</div>
        {done && file && <div className="mt-1 text-xs font-semibold text-emerald-700">✔ {file.name} attached</div>}
        {!done && required && !up.isPending && <div className="mt-1 text-xs font-semibold text-amber-800">Required before you can save.</div>}
        {up.isPending && <div className="mt-1 text-xs text-slate-600">Uploading…</div>}
        {up.error && <div className="mt-1 text-xs text-red-700">{(up.error as Error).message}</div>}
      </div>
      {url && <img src={url} alt="proof" className="h-16 w-16 rounded-lg border object-cover" />}
      <label className="cursor-pointer"><span className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold shadow-soft">{done ? 'Change file' : 'Upload / take photo'}</span>
        <input type="file" className="hidden" accept="image/*,application/pdf" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setDone(false); onChange(null); up.mutate(f); } }} /></label>
    </div>
  </div>;
}
