import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code drawn in the browser (nothing is sent anywhere). */
export function QrCode({ value, size = 220, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let live = true; void QRCode.toDataURL(value, { margin: 1, width: size, errorCorrectionLevel: 'M' }).then((u) => { if (live) setSrc(u); }); return () => { live = false; }; }, [value, size]);
  return src ? <img src={src} alt="Member QR code" width={size} height={size} className={className} /> : <div style={{ width: size, height: size }} className="animate-pulse rounded-xl bg-slate-100" />;
}
