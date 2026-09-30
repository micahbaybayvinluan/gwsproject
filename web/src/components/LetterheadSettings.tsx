import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, ErrorBox, Field, Input } from '@/components/ui/primitives';
import { BrandMark, useLetterhead } from '@/components/Brand';

/**
 * Removes the background around a logo: starting from every edge pixel, it clears neighbouring pixels whose colour changes
 * gradually (so glows and gradients go too) and stops at the logo's edges. `strength` 0–100 sets how different a neighbour may be.
 */
export function removeBackground(img: HTMLImageElement, strength: number, maxSize = 700): string {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, w, h);
  if (strength <= 0) return c.toDataURL('image/png');
  const data = ctx.getImageData(0, 0, w, h); const px = data.data;
  const tol = 4 + strength * 0.9; // per-step colour distance
  const seen = new Uint8Array(w * h); const queue = new Int32Array(w * h); let head = 0, tail = 0;
  const push = (i: number) => { if (!seen[i]) { seen[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  const dist = (a: number, b: number) => Math.abs(px[a * 4] - px[b * 4]) + Math.abs(px[a * 4 + 1] - px[b * 4 + 1]) + Math.abs(px[a * 4 + 2] - px[b * 4 + 2]);
  while (head < tail) {
    const i = queue[head++]; const x = i % w, y = (i / w) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx; if (seen[j]) continue;
      if (dist(i, j) <= tol) push(j);
    }
  }
  for (let i = 0; i < w * h; i++) if (seen[i]) px[i * 4 + 3] = 0;
  // soften the cut edge a little
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (seen[i]) continue; const n = seen[i - 1] + seen[i + 1] + seen[i - w] + seen[i + w]; if (n) px[i * 4 + 3] = Math.min(px[i * 4 + 3], 255 - n * 40); }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

const dataUrlToFile = async (url: string, name: string) => new File([await (await fetch(url)).blob()], name, { type: 'image/png' });
const checker = { backgroundImage: 'linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)', backgroundSize: '16px 16px', backgroundPosition: '0 0,0 8px,8px -8px,-8px 0' };

/** Owner: company details and logo for the letterhead on every printed form and the app header. */
export function LetterheadSettings() {
  const qc = useQueryClient(); const lh = useLetterhead();
  const [f, setF] = useState({ name: '', address: '', contact: '', tin: '' });
  useEffect(() => { if (lh.data) setF({ name: lh.data.name, address: lh.data.address, contact: lh.data.contact, tin: lh.data.tin }); }, [lh.data]);
  const [src, setSrc] = useState<HTMLImageElement | null>(null); const [strength, setStrength] = useState(35); const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (src) setPreview(removeBackground(src, strength)); }, [src, strength]);
  const inv = () => void qc.invalidateQueries({ queryKey: ['letterhead'] });
  const save = useMutation({ mutationFn: () => api.put('/api/letterhead', f), onSuccess: inv });
  const upload = useMutation({ mutationFn: async () => api.upload('/api/letterhead/logo', await dataUrlToFile(preview!, 'logo.png')), onSuccess: () => { setSrc(null); setPreview(null); inv(); } });
  const remove = useMutation({ mutationFn: () => api.delete('/api/letterhead/logo'), onSuccess: inv });
  const pick = (file?: File) => { if (!file) return; const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => setSrc(im); im.src = String(r.result); }; r.readAsDataURL(file); };
  return <Card title="Company letterhead" actions={<span className="text-xs text-slate-500">printed on every form</span>}>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="Company name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="TIN"><Input value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} /></Field><Field label="Contact (phone / email)"><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save details</Button>{save.isSuccess && <span className="ml-2 text-sm text-emerald-700">Saved</span>}
        <ErrorBox error={save.error} />
      </div>
      <div className="space-y-3">
        <div className="text-[13px] font-medium text-slate-600">Logo</div>
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3" style={checker}>{lh.data?.logoDataUrl ? <img src={lh.data.logoDataUrl} alt="Current logo" className="h-20 w-auto" /> : <BrandMark />}</div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => fileRef.current?.click()}>Upload a logo…</Button>{lh.data?.logoDataUrl && <Button variant="ghost" onClick={() => remove.mutate()}>Remove logo</Button>}<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} /></div>
        {src && <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="text-sm font-semibold text-navy">Remove the background</div>
          <div className="grid place-items-center rounded-lg p-3" style={checker}>{preview && <img src={preview} alt="Preview" className="max-h-56 w-auto" />}</div>
          <label className="block text-xs text-slate-600">Strength: {strength} <input type="range" min={0} max={100} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-full accent-[#c8102e]" /></label>
          <p className="text-xs text-slate-500">Slide until the background is checkered and the logo is whole. 0 keeps the picture as it is. For a perfect cut, upload a PNG that already has a transparent background.</p>
          <div className="flex gap-2"><Button disabled={!preview || upload.isPending} onClick={() => upload.mutate()}>Use this logo</Button><Button variant="ghost" onClick={() => { setSrc(null); setPreview(null); }}>Cancel</Button></div>
        </div>}
        <ErrorBox error={upload.error || remove.error} />
      </div>
    </div>
  </Card>;
}
