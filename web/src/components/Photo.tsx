import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** A picture stored as an attachment, loaded with the sign-in token; tap to see it large. */
export function Photo({ id, className, caption, big = true }: { id: string | null | undefined; className?: string; caption?: string; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let u: string | null = null; let live = true;
    void api.blob(`/api/attachments/file/${id}`).then((b) => { if (live) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [id]);
  if (!id) return <div className={cn('flex items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400', className ?? 'h-20 w-20')}>no photo</div>;
  if (!url) return <div className={cn('animate-pulse rounded-xl bg-slate-100', className ?? 'h-20 w-20')} />;
  return <>
    <img src={url} alt={caption ?? 'photo'} className={cn('cursor-zoom-in rounded-xl object-cover', className ?? 'h-20 w-20')} onClick={() => big && setOpen(true)} />
    {open && <Modal title={caption ?? 'Photo'} onClose={() => setOpen(false)} wide><img src={url} alt={caption ?? 'photo'} className="mx-auto max-h-[70vh] rounded-xl" /></Modal>}
  </>;
}

/** Row of pictures, each with the time it was uploaded (the time stamp of a visit photo). */
export function PhotoRow({ photos, className }: { photos: { id: string; createdAt: string }[]; className?: string }) {
  if (!photos.length) return <span className="text-xs text-slate-400">no photo</span>;
  return <div className="flex flex-wrap gap-2">{photos.map((p) => <figure key={p.id} className="text-center"><Photo id={p.id} className={className ?? 'h-16 w-16'} caption={new Date(p.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} /><figcaption className="mt-0.5 text-[10px] text-slate-500">{new Date(p.createdAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}</figcaption></figure>)}</div>;
}
