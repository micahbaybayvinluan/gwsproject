import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bell, KeyRound, Menu, LogOut, X } from 'lucide-react';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';
import { BrandMark } from '@/components/Brand';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cn } from '@/lib/utils';
import { PAGES, pageInfo } from '@/lib/pages';
import { Info } from 'lucide-react';

interface NavItem { to: string; label: string; any?: string[]; hideFor?: string[] }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Work', items: [
    { to: '/', label: 'Dashboard' },
    { to: '/approvals', label: 'Approvals', any: ['approval.act.COST_ON_RECEIVING', 'approval.act.TRANSFER_INTERNAL', 'approval.act.SPECIAL_PRICE', 'approval.act.POST_CLOSE_EDIT', 'approval.act.POST_CLOSE_EDIT_FRANCHISE', 'approval.act.WRITEOFF', 'approval.act.PRICE_CHANGE', 'approval.act.DISCREPANCY_RESOLUTION', 'approval.act.PERIOD_LOCK', 'approval.act.WAREHOUSE_EDIT', 'approval.act.AUDIT_REVISION', 'approval.act.MASTER_DATA_NEW', 'approval.act.WAREHOUSE_IN', 'approval.act.WAREHOUSE_OUT', 'approval.act.TRANSFER_TO_FRANCHISE', 'approval.act.EDIT_REQUEST', 'approval.act.CONSIGNMENT_OUT', 'approval.act.AR_PAYMENT', 'approval.act.COUNT_REVISION', 'approval.act.DISCREPANCY_EXPLANATION', 'approval.act.WRITEOFF', 'approval.act.ECOM_PULLOUT', 'approval.act.ECOM_SETTLEMENT', 'approval.act.TRANSFER_DIFF_REVIEW', 'approval.act.TRANSFER_DIFF_SENDER', 'approval.act.TRANSFER_DIFF_ADMIN', 'approval.act.CASH_DEPOSIT_AUDIT', 'approval.act.CASH_DEPOSIT_ACCOUNTING', 'approval.act.FRANCHISE_AR_EXTENSION', 'approval.act.SIXPACK_OVERRIDE', 'approval.act.FRANCHISE_SHIPPING_EDIT', 'approval.act.MARKETING_PULLOUT', 'approval.act.PULLOUT_EXPENSE', 'approval.act.REPLACEMENT_TICKET', 'approval.act.REPLACEMENT_PAYMENT', 'approval.act.PURCHASE_ORDER', 'approval.act.SUPPLIER_RETURN', 'approval.act.OPENING_AR', 'approval.act.AGENT_INCENTIVE', 'approval.act.AGENT_CONSIGNMENT_LIMIT', 'approval.act.OUTLET_DELETE'] },
    { to: '/my-sales', label: 'My Sales', any: ['agent.self'] },
    { to: '/members', label: 'Wheysted Members', any: ['member.view', 'member.manage'] },
    { to: '/campaigns', label: 'Campaigns', any: ['member.blast'] },
    { to: '/customer-service', label: 'Customer Service', any: ['sale.create', 'sale.create.warehouse', 'member.view', 'report.sales.all'] },
    { to: '/promos', label: 'Promos' },
    { to: '/purchase-orders', label: 'Restock & POs', any: ['po.manage', 'po.view'] },
    { to: '/restock-plan', label: 'Restock Plan', any: ['sale.create', 'sale.create.warehouse'] },
    { to: '/reservations', label: 'Member Reservations', any: ['member.view', 'member.manage', 'sale.create', 'sale.create.warehouse'] },
    { to: '/itinerary', label: 'My Itinerary', any: ['agent.self'] },
    { to: '/outlets', label: 'Outlets', any: ['agent.self', 'outlet.view.all', 'outlet.manage'] },
    { to: '/field', label: 'Field Monitoring', any: ['outlet.view.all', 'outlet.manage'] },
    { to: '/field/consignments', label: 'Agent Consignments', any: ['agent.self', 'outlet.view.all', 'outlet.manage'] },
    { to: '/sales/new', label: 'New Sale', any: ['sale.create', 'sale.create.warehouse'] },
    { to: '/sales', label: 'Sales', any: ['sale.create', 'sale.create.warehouse', 'report.sales.own', 'report.sales.all'] },
    { to: '/ar', label: 'AR / Credit', any: ['ar.view'] },
    { to: '/franchise-ar', label: 'Franchise AR', any: ['franchise.ar.view', 'franchise.ar.own'] },
    { to: '/six-pack', label: '6-Pack Card', any: ['sixpack.issue', 'sixpack.view.all'] },
    { to: '/memos', label: 'Memorandums', any: ['notification.view', 'memo.create'] },
    { to: '/expenses', label: 'Expenses', any: ['expense.create.branch', 'expense.create.main', 'expense.view'] },
    { to: '/closing', label: 'Daily Close', any: ['sale.create', 'report.sales.own', 'report.sales.all'], hideFor: ['SALES_MANAGER'] },
    { to: '/cash-on-hand', label: 'Cash on Hand', any: ['cashdeposit.view.all', 'sale.create'], hideFor: ['FRANCHISE_OWNER', 'FRANCHISE_SALES_ASSOCIATE'] },
    { to: '/cash-fund', label: 'Cash Fund', any: ['cashfund.view.all', 'cashfund.use', 'cashfund.manage', 'cashfund.check'] },
    { to: '/replacements', label: 'Replacement Tickets', any: ['replacement.create', 'replacement.view'] },
    { to: '/marketing-pullouts', label: 'Marketing & BO Pull-outs', any: ['marketing.summary', 'transfer.create'] },
    { to: '/inspections', label: 'Store Inspections', any: ['inspection.create', 'inspection.view', 'inspection.review'] },
    { to: '/bank', label: 'Bank & Office', any: ['bank.entry'] },
    { to: '/my-hr', label: 'My Pay & Charges', hideFor: ['ADMIN', 'FRANCHISE_OWNER'] },
  ] },
  { group: 'E-commerce', items: [
    { to: '/ecommerce', label: 'E-commerce', any: ['ecom.manage', 'ecom.view', 'ecom.receive'] },
    { to: '/ecom-waybills', label: 'Waybill Report', any: ['ecom.waybill'] },
    { to: '/ecom-analysis', label: 'E-com Margin Analysis', any: ['ecom.analysis'] },
  ] },
  { group: 'Inventory', items: [
    { to: '/stock', label: 'Stock on Hand', any: ['report.inventory.own', 'report.inventory.all'] },
    { to: '/receiving', label: 'Receiving', any: ['receiving.create', 'report.inventory.all'] },
    { to: '/transfers', label: 'Transfers', any: ['transfer.create', 'transfer.confirm', 'report.inventory.all'] },
    { to: '/counts', label: 'Inventory Count', any: ['count.create', 'discrepancy.view'] },
    { to: '/discrepancies', label: 'Discrepancies', any: ['discrepancy.view', 'discrepancy.resolve', 'count.create'] },
    { to: '/expiry', label: 'Expiry & Alerts', any: ['report.inventory.own', 'report.inventory.all'] },
    { to: '/writeoffs', label: 'Write-offs', any: ['writeoff.create', 'writeoff.approve'] },
    { to: '/consignment', label: 'Consignment', any: ['consignment.manage', 'consignment.request'] },
  ] },
  { group: 'Catalogue', items: [
    { to: '/products', label: 'Products', any: ['product.view'], hideFor: ['HR_STAFF'] },
    { to: '/price-changes', label: 'Price Changes', any: ['price.edit'] },
    { to: '/ecom-prices', label: 'E-com & Card Prices', any: ['ecom.price.edit'] },
    { to: '/suppliers', label: 'Suppliers', any: ['supplier.view.code'] },
    { to: '/consignees', label: 'Consignees', any: ['consignment.manage'] },
    { to: '/imports', label: 'Imports', any: ['product.create', 'gl.account.edit', 'settings.thresholds'] },
  ] },
  { group: 'Reports', items: [
    { to: '/targets', label: 'Sales Targets', any: ['target.view', 'target.manage'] },
    { to: '/incentives', label: 'Agent Incentives', any: ['incentive.view', 'incentive.prepare', 'agent.self'] },
    { to: '/reports/sales', label: 'Sales Report', any: ['report.sales.own', 'report.sales.all'] },
    { to: '/reports/performance', label: 'Sales Graphs', any: ['report.sales.own', 'report.sales.all'] },
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
    { to: '/accounting/inventory-cost', label: 'Inventory Cost', any: ['gl.view'] },
  ] },
  { group: 'HR', items: [
    { to: '/charge-forms', label: 'Charge Forms', any: ['charge_form.finalize', 'discrepancy.view'], hideFor: ['FIELD_AUDITOR'] },
    { to: '/payroll', label: 'Payroll & Contributions', any: ['payroll.view.summary', 'payroll.view.detail', 'payroll.edit'] },
    { to: '/hr/weekly-counts', label: 'Weekly Count Check', any: ['employee.manage', 'discrepancy.resolve', 'discrepancy.view'], hideFor: ['FIELD_AUDITOR'] },
    { to: '/revisions', label: 'Revision Log (errors per staff)', any: ['revision.view'] },
    { to: '/hr-notices', label: 'HR Notices (NTE)', any: ['hr.notice'] },
  ] },
  { group: 'Help', items: [
    { to: '/help', label: 'Help & Guide' },
  ] },
  { group: 'Admin', items: [
    { to: '/users', label: 'Users & Roles', any: ['user.manage'] },
    { to: '/audit-log', label: 'Audit Log', any: ['audit_log.view'] },
    { to: '/settings', label: 'Settings', any: ['settings.thresholds'] },
  ] },
];

const ROLE_LABEL = (k?: string) => (k ?? '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const initials = (n?: string) => (n ?? '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Layout() {
  const { me, logout, canAny } = useAuth(); const nav = useNavigate(); const { pathname } = useLocation(); const [open, setOpen] = useState(false); const [pwOpen, setPwOpen] = useState(false);
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ count: number }>('/api/notifications/unread-count'), refetchInterval: 30000 });
  const approvals = useQuery({ queryKey: ['approvals-count'], queryFn: () => api.get<{ count: number }>('/api/approvals/inbox').then((r) => ({ count: r.count })), refetchInterval: 30000, enabled: !!me });
  const groups = NAV.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, label: PAGES[i.to]?.label ?? i.label })).filter((i) => (!i.any || canAny(...i.any)) && !(i.hideFor?.includes(me?.roleKey ?? ''))) })).filter((g) => g.items.length);
  return <div className="flex min-h-full">
    <aside className={cn('fixed inset-y-0 left-0 z-30 flex w-72 transform flex-col bg-white transition-transform duration-200 lg:sticky lg:top-3 lg:m-3 lg:mr-0 lg:h-[calc(100vh-1.5rem)] lg:translate-x-0 lg:rounded-[28px] lg:shadow-card', open ? 'translate-x-0 shadow-2xl' : '-translate-x-full')}>
      <div className="flex items-center justify-between px-5 pb-2 pt-5"><BrandMark size="sm" /><button className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">{groups.map((g) => <div key={g.group} className="mb-5">
        <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-slate-400">{g.group}</div>
        {g.items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/sales'} onClick={() => setOpen(false)} className={({ isActive }) => cn('group relative my-0.5 flex items-center justify-between rounded-2xl px-3.5 py-2.5 text-[14px] font-semibold transition-all', isActive ? 'grad-brand text-white shadow-[0_10px_18px_-8px_rgba(224,18,63,.6)]' : 'text-slate-600 hover:bg-slate-100 hover:text-navy')}>
          {({ isActive }) => <><span>{i.label}</span>{i.to === '/approvals' && !!approvals.data?.count && <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-bold shadow-sm', isActive ? 'bg-white text-brand-dark' : 'grad-brand text-white')}>{approvals.data.count}</span>}</>}
        </NavLink>)}
      </div>)}</nav>
      <div className="px-5 py-3 text-[11px] text-slate-400">GWS-ERP · Get Wheysted Supplements</div>
    </aside>
    {open && <div className="fixed inset-0 z-20 bg-navy/30 backdrop-blur-[2px] lg:hidden" onClick={() => setOpen(false)} />}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 mx-3 mt-3 flex items-center gap-3 rounded-[22px] bg-white/90 px-4 py-2.5 shadow-soft backdrop-blur-md lg:mx-5 lg:px-6">
        <button className="rounded-lg p-1.5 text-navy hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu /></button>
        <div className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold text-navy">{me?.fullName}</span> <span className="ml-1 hidden rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-bold text-brand-dark sm:inline">{ROLE_LABEL(me?.roleKey)}</span>{me?.locations.length ? <span className="ml-2 hidden text-xs text-slate-500 md:inline">{me.locations.map((l) => l.name).join(', ')}</span> : null}</div>
        <button className="relative rounded-full p-2 text-navy transition hover:bg-slate-100" onClick={() => nav('/notifications')} aria-label="Notifications"><Bell size={20} />{!!unread.data?.count && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-white">{unread.data.count}</span>}</button>
        <div className="hidden size-10 place-items-center rounded-full grad-brand text-xs font-bold text-white shadow-md shadow-brand/30 sm:grid" title={me?.fullName}>{initials(me?.fullName)}</div>
        <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand" onClick={() => setPwOpen(true)} aria-label="Change my password" title="Change my password"><KeyRound size={19} /></button>
        <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-brand" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={19} /></button>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-7">{pageInfo(pathname) && pathname !== '/' && <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-soft" data-testid="page-summary"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /><span><b className="text-navy">What this page is for:</b> {pageInfo(pathname)!.summary}</span></div>}<ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary></main>
    </div>
    {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
  </div>;
}
