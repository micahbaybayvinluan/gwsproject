import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { AccountGate } from '@/components/AccountGate';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { ApprovalsPage } from './pages/Approvals';
import { NotificationsPage } from './pages/Notifications';
import { NewSalePage, SaleDetailPage, SalesListPage } from './pages/Sales';
import { ArPage } from './pages/Ar';
import { ExpensesPage } from './pages/Expenses';
import { ClosingPage } from './pages/Closing';
import { StockPage, ExpiryPage } from './pages/Stock';
import { ReceivingDetailPage, ReceivingPage } from './pages/Receiving';
import { TransferDetailPage, TransfersPage } from './pages/Transfers';
import { CountDetailPage, CountsPage, DiscrepanciesPage, DiscrepancyDetailPage } from './pages/Counts';
import { WriteoffsPage } from './pages/Writeoffs';
import { ConsignmentPage, ConsigneesPage } from './pages/Consignment';
import { EcommercePage } from './pages/Ecommerce';
import { MySalesPage, TargetsPage } from './pages/Targets';
import { ProductDetailPage, ProductsPage, PriceChangesPage, SuppliersPage } from './pages/Products';
import { ImportsPage } from './pages/Imports';
import { DailySalesReportPage, InventoryReportsPage } from './pages/Reports';
import { FranchisePage } from './pages/Franchise';
import { AccountsPage, VouchersPage, TrialBalancePage, StatementsPage, PeriodsPage } from './pages/Accounting';
import { ChargeFormsPage, PayrollPage } from './pages/Hr';
import { UsersPage, AuditLogPage, SettingsPage } from './pages/Admin';
import { MyHrPage, WeeklyCompliancePage } from './pages/HrExtra';
import { RevisionsPage } from './pages/Revisions';
import { HelpPage } from './pages/Help';
import { BankOfficePage } from './pages/BankOffice';
import { CashOnHandPage, HrNoticesPage } from './pages/CashOnHand';
import { PerformancePage, SalesReportPage } from './pages/SalesReports';
import { CashFundPage } from './pages/CashFund';
import { InspectionDetailPage, InspectionFormPage, InspectionsPage } from './pages/Inspections';
import { CustomersReportPage, InventoryCostPage } from './pages/ReportsExtra';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10000 } } });

function Guard({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  if (!me.totpVerified) return <Navigate to="/login?totp=1" replace />;
  if (me.mustChangePassword || !me.accountabilityAcceptedAt) return <AccountGate />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Guard><Layout /></Guard>}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/sales" element={<SalesListPage />} />
              <Route path="/sales/new" element={<NewSalePage />} />
              <Route path="/sales/:id" element={<SaleDetailPage />} />
              <Route path="/ar" element={<ArPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/closing" element={<ClosingPage />} />
              <Route path="/stock" element={<StockPage />} />
              <Route path="/expiry" element={<ExpiryPage />} />
              <Route path="/receiving" element={<ReceivingPage />} />
              <Route path="/receiving/:id" element={<ReceivingDetailPage />} />
              <Route path="/transfers" element={<TransfersPage />} />
              <Route path="/transfers/:id" element={<TransferDetailPage />} />
              <Route path="/counts" element={<CountsPage />} />
              <Route path="/counts/:id" element={<CountDetailPage />} />
              <Route path="/discrepancies" element={<DiscrepanciesPage />} />
              <Route path="/discrepancies/:id" element={<DiscrepancyDetailPage />} />
              <Route path="/writeoffs" element={<WriteoffsPage />} />
              <Route path="/consignment" element={<ConsignmentPage />} />
              <Route path="/consignees" element={<ConsigneesPage />} />
              <Route path="/ecommerce" element={<EcommercePage />} />
              <Route path="/targets" element={<TargetsPage />} />
              <Route path="/my-sales" element={<MySalesPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:id" element={<ProductDetailPage />} />
              <Route path="/price-changes" element={<PriceChangesPage />} />
              <Route path="/price-changes/:id" element={<PriceChangesPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/imports" element={<ImportsPage />} />
              <Route path="/reports/daily-sales" element={<DailySalesReportPage />} />
              <Route path="/reports/inventory" element={<InventoryReportsPage />} />
              <Route path="/franchise" element={<FranchisePage />} />
              <Route path="/accounting/accounts" element={<AccountsPage />} />
              <Route path="/accounting/vouchers" element={<VouchersPage />} />
              <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
              <Route path="/accounting/statements" element={<StatementsPage />} />
              <Route path="/accounting/periods" element={<PeriodsPage />} />
              <Route path="/charge-forms" element={<ChargeFormsPage />} />
              <Route path="/charge-forms/:id" element={<ChargeFormsPage />} />
              <Route path="/payroll" element={<PayrollPage />} />
              <Route path="/my-hr" element={<MyHrPage />} />
              <Route path="/hr/weekly-counts" element={<WeeklyCompliancePage />} />
              <Route path="/revisions" element={<RevisionsPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/bank" element={<BankOfficePage />} />
              <Route path="/cash-on-hand" element={<CashOnHandPage />} />
              <Route path="/reports/sales" element={<SalesReportPage />} />
              <Route path="/reports/performance" element={<PerformancePage />} />
              <Route path="/hr-notices" element={<HrNoticesPage />} />
              <Route path="/cash-fund" element={<CashFundPage />} />
              <Route path="/inspections" element={<InspectionsPage />} />
              <Route path="/inspections/new" element={<InspectionFormPage />} />
              <Route path="/inspections/:id/edit" element={<InspectionFormPage />} />
              <Route path="/inspections/:id" element={<InspectionDetailPage />} />
              <Route path="/reports/customers" element={<CustomersReportPage />} />
              <Route path="/accounting/inventory-cost" element={<InventoryCostPage />} />
              <Route path="/payroll/:id" element={<PayrollPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/audit-log" element={<AuditLogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
