import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState, type ReactNode } from 'react';
import { Button, Empty } from './primitives';
import { api } from '@/lib/api';

/** TanStack Table with sorting, optional row selection, and export of the current rows to xlsx/csv (§13). */
export function DataTable<T>({ columns, data, exportName, onRowClick, selectable, selected, onSelectedChange, footer }: { columns: ColumnDef<T, unknown>[]; data: T[]; exportName?: string; onRowClick?: (row: T) => void; selectable?: boolean; selected?: Set<string>; onSelectedChange?: (s: Set<string>) => void; footer?: ReactNode }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  // TanStack Table throws (a blank `Error` in production builds) for a column without an id, e.g. an icon column with `header: ''`
  // or an accessorFn column whose header is not a string. Derive a stable id so no page can white-screen over a column definition.
  const cols = columns.map((c, i) => c.id ? c : { ...c, id: ('accessorKey' in c && typeof c.accessorKey === 'string' && c.accessorKey) || (typeof c.header === 'string' && c.header) || `col_${i}` });
  const table = useReactTable({ data, columns: cols, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r, i) => ((r as { id?: string }).id ?? String(i)) });
  const rows = table.getRowModel().rows;
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.id));
  const toggleAll = () => onSelectedChange?.(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const flat = () => data.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([, v]) => typeof v !== 'object' || v === null)));
  return <div>
    {exportName && <div className="mb-2 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => api.downloadPost('/api/reports/export.xlsx', { name: exportName, rows: flat() }, `${exportName}.xlsx`)}>Export xlsx</Button><Button size="sm" variant="outline" onClick={() => api.downloadPost('/api/reports/export.csv', { name: exportName, rows: flat() }, `${exportName}.csv`)}>CSV</Button></div>}
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          {table.getHeaderGroups().map((hg) => <tr key={hg.id}>{selectable && <th className="w-8 px-3 py-2"><input type="checkbox" checked={!!allSelected} onChange={toggleAll} aria-label="Select all" /></th>}{hg.headers.map((h) => <th key={h.id} className="cursor-pointer select-none px-3 py-2 font-medium" onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}</th>)}</tr>)}
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length + 1}><Empty /></td></tr>}
          {rows.map((r) => <tr key={r.id} className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => onRowClick?.(r.original)}>{selectable && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!selected?.has(r.id)} onChange={() => { const n = new Set(selected); n.has(r.id) ? n.delete(r.id) : n.add(r.id); onSelectedChange?.(n); }} /></td>}{r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}
        </tbody>
        {footer && <tfoot className="bg-slate-50 font-medium">{footer}</tfoot>}
      </table>
    </div>
  </div>;
}
