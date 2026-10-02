import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Button, Empty } from './primitives';
import { api } from '@/lib/api';

/** TanStack Table with sorting, optional row selection, and export of the current rows to xlsx/csv (§13). */
export function DataTable<T>({ columns, data, exportName, onRowClick, selectable, selected, onSelectedChange, footer, search = true }: { columns: ColumnDef<T, unknown>[]; data: T[]; exportName?: string; onRowClick?: (row: T) => void; selectable?: boolean; selected?: Set<string>; onSelectedChange?: (s: Set<string>) => void; footer?: ReactNode; /** search box above the table (shown from 6 rows); pages that have their own search turn it off */ search?: boolean }) {
  const [sorting, setSorting] = useState<SortingState>([]); const [q, setQ] = useState('');
  // TanStack Table throws (a blank `Error` in production builds) for a column without an id, e.g. an icon column with `header: ''`
  // or an accessorFn column whose header is not a string. Derive a stable id so no page can white-screen over a column definition.
  const cols = columns.map((c, i) => c.id ? c : { ...c, id: ('accessorKey' in c && typeof c.accessorKey === 'string' && c.accessorKey) || (typeof c.header === 'string' && c.header) || `col_${i}` });
  // search (owner request 2026-10-02): every typed word must appear somewhere in the row (what is shown, or any value of the record)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    if (!words.length) return data;
    return data.filter((row) => {
      const parts: string[] = [JSON.stringify(row)];
      for (const c of cols as { accessorFn?: (r: T, i: number) => unknown }[]) if (c.accessorFn) { try { parts.push(String(c.accessorFn(row, 0) ?? '')); } catch { /* column that needs more than the row */ } }
      const hay = parts.join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q]);
  const table = useReactTable({ data: shown, columns: cols, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r, i) => ((r as { id?: string }).id ?? String(i)) });
  const rows = table.getRowModel().rows;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.id));
  const toggleAll = () => onSelectedChange?.(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const flat = () => shown.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([, v]) => typeof v !== 'object' || v === null)));
  return <div>
    {search && data.length >= 6 && <div className="mb-2 flex flex-wrap items-center gap-2"><label className="relative block w-full max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this list…" aria-label="Search this list" className="w-full rounded-xl border-0 bg-white py-2 pl-9 pr-3 text-sm shadow-soft outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-brand/50" /></label>{words.length > 0 && <span className="text-xs text-slate-500">{shown.length} of {data.length} rows</span>}</div>}
    {exportName && <div className="mb-2 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => api.downloadPost('/api/reports/export.xlsx', { name: exportName, rows: flat() }, `${exportName}.xlsx`)}>Export xlsx</Button><Button size="sm" variant="outline" onClick={() => api.downloadPost('/api/reports/export.csv', { name: exportName, rows: flat() }, `${exportName}.csv`)}>CSV</Button></div>}
    <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(11,31,58,.04)]">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] uppercase tracking-[.06em] text-slate-500">
          {table.getHeaderGroups().map((hg) => <tr key={hg.id}>{selectable && <th className="w-8 px-3 py-2"><input type="checkbox" checked={!!allSelected} onChange={toggleAll} aria-label="Select all" /></th>}{hg.headers.map((h) => <th key={h.id} className="cursor-pointer select-none px-3 py-2 font-medium" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}</th>)}</tr>)}
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length + 1}><Empty /></td></tr>}
          {rows.map((r) => <tr key={r.id} className={`border-t border-slate-100 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-brand-soft/40' : 'hover:bg-slate-50/60'}`} onClick={() => onRowClick?.(r.original)}>{selectable && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!selected?.has(r.id)} onChange={() => { const n = new Set(selected); n.has(r.id) ? n.delete(r.id) : n.add(r.id); onSelectedChange?.(n); }} /></td>}{r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}
        </tbody>
        {footer && <tfoot className="bg-slate-50 font-medium">{footer}</tfoot>}
      </table>
    </div>
  </div>;
}
