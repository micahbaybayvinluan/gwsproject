import { useEffect, useRef } from 'react';

declare global { interface Window { L?: any } } // eslint-disable-line @typescript-eslint/no-explicit-any

let loader: Promise<void> | null = null;
/** Leaflet (OpenStreetMap) is loaded only when a map is opened, so nothing else depends on it. */
function loadLeaflet(): Promise<void> {
  if (window.L) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.onload = () => resolve(); js.onerror = () => reject(new Error('The map could not be loaded (internet needed)')); document.head.appendChild(js);
  });
  return loader;
}

export interface Pin { id: string; name: string; lat: number; lng: number; agentName?: string; area?: string | null; stage?: string; city?: string | null }

/** Pins of outlets on a street map: where the agents' outlets are and where there are gaps. */
export function OutletMap({ pins, height = 460, onPick }: { pins: Pin[]; height?: number; onPick?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: any = null; let dead = false; // eslint-disable-line @typescript-eslint/no-explicit-any
    void loadLeaflet().then(() => {
      if (dead || !ref.current || !window.L) return;
      const L = window.L;
      map = L.map(ref.current).setView(pins.length ? [pins[0].lat, pins[0].lng] : [14.5995, 120.9842], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      const pts: [number, number][] = [];
      for (const p of pins) {
        const m = L.marker([p.lat, p.lng]).addTo(map);
        m.bindPopup(`<b>${p.name.replace(/</g, '&lt;')}</b><br/>${(p.agentName ?? '').replace(/</g, '&lt;')}${p.area ? ` · ${p.area.replace(/</g, '&lt;')}` : ''}<br/>${p.stage ?? ''}`);
        if (onPick) m.on('click', () => onPick(p.id));
        pts.push([p.lat, p.lng]);
      }
      if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
    }).catch(() => { if (ref.current) ref.current.innerText = 'The map could not be loaded. It needs an internet connection.'; });
    return () => { dead = true; if (map) map.remove(); };
  }, [pins, onPick]);
  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-2xl bg-slate-100 text-sm text-slate-500" />;
}
