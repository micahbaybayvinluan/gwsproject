import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bell, Menu, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cn } from '@/lib/utils';

interface NavItem { to: string; label: string; any?: string[]; hideFor?: string[] }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Work', items: [
    { to: '/', label: 'Dashboard' },
    { to: '/approvals', label: 'Approvals', any: ['approval.act.COST_ON_RECEIVING', 'approval.act.TRANSFER_INTERNAL', 'approval.act.SPECIAL_PRICE', 'approval.act.POST_CLOSE_EDIT', 'approval.act.POST_CLOSE_EDIT_FRANCHISE', 'approval.act.WRITEOFF', 'approval.act.PRICE_CHANGE', 'approval.act.DISCREPANCY_RESOLUTION', 'approval.act.PERIOD_LOCK', 'approval.act.WAREHOUSE_EDIT', 'approval.act.TRANSFER_TO_FRANCHISE', 'approval.act.EDIT_REQUEST', 'approval.act.CONSIGNMENT_OUT', 'approval.act.AR_PAYMENT', 'approval.act.COUNT_REVISION', 'approval.act.DISCREPANCY_EXPLANATION', 'approval.act.WRITEOFF'] },
    { to: '/sales/new', label: 'New Sale', any: ['sale.create'] },
    { to: '/sales', label: 'Sales', any: ['sale.create', 'report.sales.own', 'report.sales.all'] },
    { to: '/ar', label: 'AR / Credit', any: ['ar.view'] },
    { to: '/expenses', label: 'Expenses', any: ['expense.create.branch', 'expense.create.main', 'expense.view'] },
    { to: '/closing', label: 'Daily Close', any: ['sale.create', 'report.sales.own', 'report.sales.all'] },
    { to: '/cash-fund', label: 'Cash Fund', any: ['cashfund.view.all', 'cashfund.use', 'cashfund.manage', 'cashfund.check'] },
    { to: '/inspections', label: 'Store Inspections', any: ['inspection.create', 'inspection.view', 'inspection.review'] },
    { to: '/my-hr', label: 'My Pay & Charges', hideFor: ['ADMIN'] },
  ] },
  { group: 'Inventory', items: [
    { to: '/stock', label: 'Stock on Hand', any: ['report.inventory.own', 'report.inventory.all'] },
    { to: '/receiving', label: 'Receiving', any: ['receiving.create', 'report.inventory.all'] },
    { to: '/transfers', label: 'Transfers', any: ['transfer.create', 'transfer.confirm', 'report.inventory.all'] },
    { to: '/counts', label: 'Inventory Count', any: ['count.create', 'discrepancy.view'] },
    { to: '/discrepancies', label: 'Discrepancies', any: ['discrepancy.view', 'discrepancy.resolve', 'count.create'] },
    { to: '/expiry', label: 'Expiry & Alerts', any: ['report.inventory.own', 'report.inventory.all'] },
    { to: '/writeoffs', label: 'Write-offs', any: ['writeoff.create', 'writeoff.approve'] },
    { to: '/consignment', label: 'Consignment', any: ['consignment.manage'] },
  ] },
  { group: 'Catalogue', items: [
    { to: '/products', label: 'Products', any: ['product.view'], hideFor: ['HR_STAFF'] },
    { to: '/price-changes', label: 'Price Changes', any: ['price.edit'] },
    { to: '/suppliers', label: 'Suppliers', any: ['supplier.view.code'] },
    { to: '/imports', label: 'Imports', any: ['product.create', 'gl.account.edit', 'settings.thresholds'] },
  ] },
  { group: 'Reports', items: [
    { to: '/reports/daily-sales', label: 'Daily Sales Report', any: ['report.sales.own', 'report.sales.all'] },
    { to: '/reports/inventory', label: 'Inventory Reports', any: ['report.inventory.own', 'report.inventory.all'] },
    { to: '/reports/customers', label: 'Customer Contacts', any: ['report.sales.own', 'report.sales.all'] },
    { to: '/franchise', label: 'Franchise Portal', any: ['franchise.portal'] },
  ] },
  { group: 'Accounting', items: [
    { to: '/accounting/accounts', label: 'Chart of Accounts', any: ['gl.view'] },
    { to: '/accounting/vouchers', label: 'Journal Vouchers', any: ['gl.view'] },
    { to: '/accounting/trial-balance', label: 'Trial Balance', any: ['gl.view'] },
    { to: '/accounting/statements', label: 'Financial Statements', any: ['fs.income_statement', 'fs.balance_sheet'] },
    { to: '/accounting/periods', label: 'Periods & Opening', any: ['gl.view'] },
    { to: '/accounting/inventory-cost', label: 'Inventory & Direct Cost', any: ['gl.view'] },
  ] },
  { group: 'HR', items: [
    { to: '/charge-forms', label: 'Charge Forms', any: ['charge_form.finalize', 'discrepancy.view'] },
    { to: '/payroll', label: 'Payroll & Contributions', any: ['payroll.view.summary', 'payroll.view.detail', 'payroll.edit'] },
    { to: '/hr/weekly-counts', label: 'Weekly Count Compliance', any: ['employee.manage', 'discrepancy.resolve', 'discrepancy.view'] },
  ] },
  { group: 'Admin', items: [
    { to: '/users', label: 'Users & Roles', any: ['user.manage'] },
    { to: '/audit-log', label: 'Audit Log', any: ['audit_log.view'] },
    { to: '/settings', label: 'Settings', any: ['settings.thresholds'] },
  ] },
];

export function Layout() {
  const { me, logout, canAny } = useAuth(); const nav = useNavigate(); const { pathname } = useLocation(); const [open, setOpen] = useState(false);
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ count: number }>('/api/notifications/unread-count'), refetchInterval: 30000 });
  const approvals = useQuery({ queryKey: ['approvals-count'], queryFn: () => api.get<{ count: number }>('/api/approvals/inbox').then((r) => ({ count: r.count })), refetchInterval: 30000, enabled: !!me });
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => (!i.any || canAny(...i.any)) && !(i.hideFor?.includes(me?.roleKey ?? ''))) })).filter((g) => g.items.length);
  return <div className="flex min-h-full">
    <aside className={cn('fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto border-r border-slate-200 bg-slate-900 text-slate-100 transition lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between px-4 py-4"><div><div className="text-lg font-bold">GWS-ERP</div><div className="text-xs text-slate-400">Get Wheysted Supplements</div></div><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">✕</button></div>
      <nav className="px-2 pb-6">{groups.map((g) => <div key={g.group} className="mb-3"><div className="px-2 py-1 text-[11px] uppercase tracking-wider text-slate-500">{g.group}</div>{g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/sales'} onClick={() => setOpen(false)} className={({ isActive }) => cn('flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-slate-800', isActive && 'bg-brand text-white')}>{i.label}{i.to === '/approvals' && !!approvals.data?.count && <span className="rounded-full bg-amber-400 px-2 text-xs font-semibold text-slate-900">{approvals.data.count}</span>}</NavLink>)}</div>)}</nav>
    </aside>
    {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
        <div className="min-w-0 flex-1 truncate text-sm"><span className="font-medium">{me?.fullName}</span> <span className="text-slate-500">· {me?.roleKey.replace(/_/g, ' ')}{me?.locations.length ? ` · ${me.locations.map((l) => l.name).join(', ')}` : ''}</span></div>
        <button className="relative" onClick={() => nav('/notifications')} aria-label="Notifications"><Bell />{!!unread.data?.count && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{unread.data.count}</span>}</button>
        <button onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={20} /></button>
      </header>
      <main className="flex-1 p-4 lg:p-6"><ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary></main>
    </div>
  </div>;
}
