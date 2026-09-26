import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface LetterheadInfo { name: string; address: string; contact: string; tin: string; logoDataUrl: string | null }
export const useLetterhead = () => useQuery({ queryKey: ['letterhead'], queryFn: () => api.get<LetterheadInfo>('/api/letterhead'), staleTime: 5 * 60_000, retry: false });

/** GWS brand mark: the uploaded logo when there is one, otherwise the GET WHEYSTED wordmark in the logo's red and navy. */
export function BrandMark({ size = 'md', light = false, className }: { size?: 'sm' | 'md' | 'lg'; light?: boolean; className?: string }) {
  const lh = useLetterhead();
  const logo = lh.data?.logoDataUrl;
  const h = size === 'lg' ? 'h-20' : size === 'sm' ? 'h-9' : 'h-12';
  return <div className={cn('flex items-center gap-3', className)}>
    {logo ? <img src={logo} alt="" className={cn(h, 'w-auto object-contain drop-shadow-sm')} /> : <div className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-dark font-[family-name:var(--font-display)] font-bold text-white shadow-md shadow-brand/30', size === 'lg' ? 'size-20 text-2xl' : size === 'sm' ? 'size-9 text-sm' : 'size-12 text-base')}>GWS</div>}
    <div className="leading-none">
      <div className={cn('font-[family-name:var(--font-display)] font-bold uppercase tracking-wide', size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-base' : 'text-xl')}>
        <span className={light ? 'text-white/80' : 'text-slate-400'} style={{ fontSize: '.6em', letterSpacing: '.12em' }}>GET </span>
        <span className="text-brand">WHEY</span><span className={light ? 'text-white' : 'text-navy'}>STED</span>
      </div>
      <div className={cn('mt-1 text-[10px] font-semibold uppercase tracking-[.3em]', light ? 'text-white/60' : 'text-slate-400')}>Supplements</div>
    </div>
  </div>;
}
