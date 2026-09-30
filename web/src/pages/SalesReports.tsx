import { locLabel } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, fmtDate, peso, today } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Empty, Field, Input, Select, Stat } from '@/components/ui/primitives';

/** Validated categorical order (dataviz reference palette); a branch keeps its slot in every chart. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const MODE_LABEL: Record<string, string> = { CASH: 'Cash', ONLINE: 'Online (bank / GCash)', CREDIT_CARD: 'Credit card', AR_PDC: 'AR / PDC (credit)' };
const short = (n: number) => (Math.abs(n) >= 1e6 ? `₱${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `₱${Math.round(n / 1e3)}k` : `₱${Math.round(n)}`);
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

interface Summary {
  from: string; to: string; branch: string;
  totals: { sales: number; transactions: number; average: number; products: number; byMode: Record<string, number>; costOfSales?: number; grossProfit?: number; grossMarginPct?: number };
  perDay: { date: string; transactions: number; CASH: number; ONLINE: number; CREDIT_CARD: number; AR_PDC: number; total: number }[];
  perBranch: { id: string; name: string; transactions: number; products: number; total: number; sharePct: number }[];
  byChannel: { channel: string; amount: number }[];
  topProducts: { sku: string; name: string; qty: number; amount: number }[];
}

/** Sales Report: choose the branch (or all) and the period; totals, per day, payment modes, channels, branches and top products. */
export function SalesReportPage() {
  const { me } = useAuth();
  const [f, setF] = useState({ locationId: me!.locationScoped ? me!.locations[0]?.id ?? '' : '', from: `${today().slice(0, 8)}01`, to: today() });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get<{ id: string; name: string; isSelling: boolean; type: string }[]>('/api/locations'), enabled: !me!.locationScoped });
  const qs = `from=${f.from}&to=${f.to}${f.locationId ? `&locationId=${f.locationId}` : ''}`;
  const q = useQuery({ queryKey: ['sales-summary', qs], queryFn: () => api.get<Summary>(`/api/reports/sales-summary?${qs}`), enabled: !!f.from && !!f.to && f.from <= f.to });
  const r = q.data;
  const quick = (from: string, to: string) => setF({ ...f, from, to });
  const d = new Date(`${today()}T00:00:00Z`); const iso = (x: Date) => x.toISOString().slice(0, 10);
  const lastMonthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); const lastMonthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Sales Report</h1>
      {!me!.locationScoped && <Field label="Branch"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">All branches</option>{locations.data?.filter((l) => l.isSelling && l.type !== 'FRANCHISE').map((l) => <option key={l.id} value={l.id}>{locLabel(l)}</option>)}</Select></Field>}
      <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      <Button variant="outline" disabled={!r} onClick={() => api.download(`/api/reports/sales-summary.xlsx?${qs}`, `SalesReport_${f.from}_${f.to}.xlsx`)}>Excel</Button>
    </div>
    <div className="flex flex-wrap gap-2 text-sm">{[['Today', today(), today()], ['This month', `${today().slice(0, 8)}01`, today()], ['Last month', iso(lastMonthStart), iso(lastMonthEnd)], ['This year', `${today().slice(0, 4)}-01-01`, today()]].map(([l, a, b]) => <Button key={l} size="sm" variant={f.from === a && f.to === b ? 'default' : 'outline'} onClick={() => quick(a, b)}>{l}</Button>)}</div>
    {f.from > f.to && <p className="text-sm text-red-700">"From" must be on or before "To".</p>}
    {r && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Total sales — ${r.branch}`} value={peso(r.totals.sales)} sub={`${fmtDate(r.from)} to ${fmtDate(r.to)}`} />
        <Stat label="Number of sales" value={r.totals.transactions} sub={`average ${peso(r.totals.average)} per sale`} />
        <Stat label="Products sold" value={r.totals.products} />
        {r.totals.grossProfit != null ? <Stat label="Gross profit" value={peso(r.totals.grossProfit)} sub={`${r.totals.grossMarginPct}% margin · cost ${peso(r.totals.costOfSales)}`} tone="green" /> : <Stat label="Cash sales" value={peso(r.totals.byMode.CASH)} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="How customers paid"><table className="w-full text-sm"><tbody>{Object.entries(r.totals.byMode).map(([k, v]) => <tr key={k} className="border-t"><td className="py-1.5">{MODE_LABEL[k] ?? k}</td><td className="num">{peso(v)}</td><td className="num w-14 text-slate-500">{r.totals.sales ? Math.round((v / r.totals.sales) * 100) : 0}%</td></tr>)}</tbody></table></Card>
        <Card title="By channel"><table className="w-full text-sm"><tbody>{r.byChannel.map((c) => <tr key={c.channel} className="border-t"><td className="py-1.5">{c.channel.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase())}</td><td className="num">{peso(c.amount)}</td></tr>)}</tbody></table>{!r.byChannel.length && <Empty>No sales.</Empty>}</Card>
        <Card title="Top products"><table className="w-full text-sm"><tbody>{r.topProducts.slice(0, 8).map((p) => <tr key={p.sku} className="border-t"><td className="py-1.5">{p.name}</td><td className="num text-slate-500">{p.qty}</td><td className="num">{peso(p.amount)}</td></tr>)}</tbody></table>{!r.topProducts.length && <Empty>No sales.</Empty>}</Card>
      </div>
      {r.perBranch.length > 1 && <Card title="Per branch"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Branch</th><th className="num">Sales</th><th className="num">Products</th><th className="num pr-6">Total</th><th className="w-1/3 pl-2">Share</th></tr></thead><tbody>{r.perBranch.map((b) => <tr key={b.id} className="border-t"><td className="py-2 font-medium">{b.name}</td><td className="num">{b.transactions}</td><td className="num">{b.products}</td><td className="num pr-6">{peso(b.total)}</td><td className="pl-2"><div className="flex items-center gap-2"><div className="h-2 flex-1 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-navy" style={{ width: `${b.sharePct}%` }} /></div><span className="w-12 text-right text-xs text-slate-600">{b.sharePct}%</span></div></td></tr>)}</tbody></table></Card>}
      <Card title="Per day"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Date</th><th className="num">Sales</th><th className="num">Cash</th><th className="num">Online</th><th className="num">Card</th><th className="num">AR / PDC</th><th className="num">Total</th></tr></thead><tbody>{r.perDay.map((x) => <tr key={x.date} className="border-t"><td className="py-1.5">{fmtDate(x.date)}</td><td className="num">{x.transactions}</td><td className="num">{peso(x.CASH)}</td><td className="num">{peso(x.ONLINE)}</td><td className="num">{peso(x.CREDIT_CARD)}</td><td className="num">{peso(x.AR_PDC)}</td><td className="num font-semibold">{peso(x.total)}</td></tr>)}</tbody><tfoot className="font-semibold"><tr className="border-t-2"><td className="py-2">Total</td><td className="num">{r.totals.transactions}</td><td className="num">{peso(r.totals.byMode.CASH)}</td><td className="num">{peso(r.totals.byMode.ONLINE)}</td><td className="num">{peso(r.totals.byMode.CREDIT_CARD)}</td><td className="num">{peso(r.totals.byMode.AR_PDC)}</td><td className="num">{peso(r.totals.sales)}</td></tr></tfoot></table></div>{!r.perDay.length && <Empty>No sales in this period.</Empty>}</Card>
    </>}
    {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
  </div>;
}

interface Perf { year: number; month: number; days: number[]; branches: { id: string; name: string }[]; cumulative: Record<string, number[]>; monthNames: string[]; byMonth: Record<string, number[]>; monthToDate: { total: number; perBranch: { id: string; name: string; total: number }[] } }

/** Line chart with a snapping crosshair and one tooltip listing every series at that day. */
function LineChart({ xs, series, xLabel }: { xs: number[]; series: { name: string; color: string; values: number[] }[]; xLabel: (x: number) => string }) {
  const W = 760, H = 280, L = 64, R = 16, T = 12, B = 30;
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => L + (xs.length <= 1 ? 0 : (i / (xs.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return <div className="relative">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative sales per day"
      onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - L) / (W - L - R)) * (xs.length - 1)); setHover(Math.max(0, Math.min(xs.length - 1, i))); }} onPointerLeave={() => setHover(null)}>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e7e9ee" strokeWidth={1} /><text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">{short(t)}</text></g>)}
      {xs.map((d, i) => (i === 0 || i === xs.length - 1 || d % 5 === 0) && <text key={d} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#64748b">{xLabel(d)}</text>)}
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#94a3b8" strokeWidth={1} />}
      {series.map((s) => <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />)}
      {hover != null && series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />)}
    </svg>
    {hover != null && <div className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white/95 p-2 text-xs shadow-lg" style={{ left: `${Math.min(70, (x(hover) / W) * 100 + 2)}%` }}>
      <div className="mb-1 font-semibold text-navy">{xLabel(xs[hover])}</div>
      {[...series].sort((a, b) => (b.values[hover] ?? 0) - (a.values[hover] ?? 0)).map((s) => <div key={s.name} className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} /><b className="text-slate-900">{peso(s.values[hover] ?? 0)}</b><span className="text-slate-600">{s.name}</span></div>)}
    </div>}
  </div>;
}

/** Stacked columns (one per month, one segment per branch, 2px gaps) with a per-segment tooltip; the column height is the company total. */
function StackedColumns({ labels, series }: { labels: string[]; series: { name: string; color: string; values: number[] }[] }) {
  const W = 760, H = 280, L = 64, R = 16, T = 12, B = 30;
  const [tip, setTip] = useState<{ x: number; y: number; text: string; total: number; label: string } | null>(null);
  const totals = labels.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const band = (W - L - R) / Math.max(1, labels.length); const bw = Math.min(46, band * 0.6);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return <div className="relative">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Sales per month per branch" onPointerLeave={() => setTip(null)}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t * max)} y2={y(t * max)} stroke="#e7e9ee" /><text x={L - 8} y={y(t * max) + 4} textAnchor="end" fontSize="11" fill="#64748b">{short(t * max)}</text></g>)}
      {labels.map((m, i) => { let acc = 0; const cx = L + band * i + band / 2; return <g key={m}>
        {series.map((s) => { const v = s.values[i] ?? 0; if (v <= 0) return null; const y1 = y(acc + v), y0 = y(acc); acc += v; const h = Math.max(0, y0 - y1 - 2); return <rect key={s.name} x={cx - bw / 2} y={y1} width={bw} height={h} rx={h > 8 ? 3 : 1} fill={s.color} onPointerMove={(e) => { const r = ((e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text: s.name, total: v, label: m }); }} />; })}
        <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" fill="#64748b">{m}</text>
        {totals[i] > 0 && <text x={cx} y={y(totals[i]) - 5} textAnchor="middle" fontSize="9.5" fill="#334155">{peso(totals[i])}</text>}
      </g>; })}
    </svg>
    {tip && <div className="pointer-events-none absolute rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow-lg" style={{ left: tip.x + 12, top: tip.y - 10 }}><b>{peso(tip.total)}</b> <span className="text-slate-600">{tip.text} · {tip.label}</span></div>}
  </div>;
}

function Legend({ items }: { items: { name: string; color: string; value?: number }[] }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700">{items.map((i) => <span key={i.name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.name}{i.value != null && <span className="text-slate-500">{short(i.value)}</span>}</span>)}</div>;
}

/** Month to date per branch and for the whole company, and this year month by month. */
export function PerformancePage() {
  const [ym, setYm] = useState(today().slice(0, 7)); const [year, month] = ym.split('-').map(Number);
  const [tables, setTables] = useState(false);
  const q = useQuery({ queryKey: ['sales-performance', ym], queryFn: () => api.get<Perf>(`/api/reports/sales-performance?year=${year}&month=${month}`) });
  const p = q.data;
  const series = useMemo(() => (p?.branches ?? []).map((b, i) => ({ name: b.name, color: SERIES[i % SERIES.length], values: p!.cumulative[b.id] ?? [] })), [p]);
  const monthSeries = useMemo(() => (p?.branches ?? []).map((b, i) => ({ name: b.name, color: SERIES[i % SERIES.length], values: p!.byMonth[b.id] ?? [] })), [p]);
  const company = useMemo(() => p ? [{ name: 'All branches', color: '#0b1f3a', values: p.days.map((_, i) => series.reduce((t, s) => t + (s.values[i] ?? 0), 0)) }] : [], [p, series]);
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric' });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-2"><h1 className="mr-auto text-2xl font-bold tracking-tight text-navy">Sales Graphs</h1><Field label="Month"><Input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></Field><Button variant="outline" onClick={() => setTables(!tables)}>{tables ? 'Hide tables' : 'Show as tables'}</Button></div>
    {p && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={`Company sales — ${monthName} to date`} value={peso(p.monthToDate.total)} sub={`${p.days.length} day(s)`} />
        <Stat label="Best branch this month" value={[...p.monthToDate.perBranch].sort((a, b) => b.total - a.total)[0]?.name ?? '—'} sub={peso([...p.monthToDate.perBranch].sort((a, b) => b.total - a.total)[0]?.total ?? 0)} />
        <Stat label="Average per day" value={peso(p.days.length ? p.monthToDate.total / p.days.length : 0)} />
      </div>
      <Card title={`${monthName} to date — sales per branch (running total)`} actions={<span className="text-xs text-slate-500">hover to compare branches on a day</span>}>
        {series.length > 1 && <div className="mb-2"><Legend items={series.map((s) => ({ name: s.name, color: s.color, value: s.values.at(-1) }))} /></div>}
        {series.length ? <LineChart xs={p.days} series={series} xLabel={(d) => `${new Date(Date.UTC(year, month - 1, d)).toLocaleString('en', { month: 'short' })} ${d}`} /> : <Empty>No branches.</Empty>}
        {tables && <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="py-1 text-left">Branch</th>{p.days.map((d) => <th key={d} className="px-1 text-right">{d}</th>)}</tr></thead><tbody>{series.map((s) => <tr key={s.name} className="border-t"><td className="py-1 pr-2">{s.name}</td>{s.values.map((v, i) => <td key={i} className="px-1 text-right tabular-nums">{Math.round(v).toLocaleString()}</td>)}</tr>)}</tbody></table></div>}
      </Card>
      {series.length > 1 && <Card title={`${monthName} to date — all branches (company running total)`}>
        <LineChart xs={p.days} series={company} xLabel={(d) => `${new Date(Date.UTC(year, month - 1, d)).toLocaleString('en', { month: 'short' })} ${d}`} />
      </Card>}
      <Card title={`${year} — sales per month, per branch`} actions={<span className="text-xs text-slate-500">column height = company total</span>}>
        {monthSeries.length > 1 && <div className="mb-2"><Legend items={monthSeries.map((s) => ({ name: s.name, color: s.color }))} /></div>}
        <StackedColumns labels={p.monthNames} series={monthSeries} />
        {tables && <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="py-1 text-left">Branch</th>{p.monthNames.map((m) => <th key={m} className="px-1 text-right">{m}</th>)}</tr></thead><tbody>{monthSeries.map((s) => <tr key={s.name} className="border-t"><td className="py-1 pr-2">{s.name}</td>{s.values.map((v, i) => <td key={i} className="px-1 text-right tabular-nums">{Math.round(v).toLocaleString()}</td>)}</tr>)}<tr className="border-t font-semibold"><td className="py-1">All branches</td>{p.monthNames.map((_, i) => <td key={i} className="px-1 text-right tabular-nums">{Math.round(monthSeries.reduce((t, s) => t + (s.values[i] ?? 0), 0)).toLocaleString()}</td>)}</tr></tbody></table></div>}
      </Card>
    </>}
    {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
  </div>;
}
