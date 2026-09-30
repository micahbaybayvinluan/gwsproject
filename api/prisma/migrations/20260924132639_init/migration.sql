-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'BRANCH', 'FRANCHISE', 'OFFICE', 'CONSIGNEE', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "AccountingClass" AS ENUM ('SUPPLEMENT', 'FREEBIE', 'PLASTIC', 'APPAREL', 'EQUIPMENT', 'OTHER', 'REPACKED', 'BUNDLE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE', 'SALE_RETURN', 'RETURN_TO_WAREHOUSE', 'RETURN_TO_SUPPLIER', 'CONSIGN_OUT', 'CONSIGN_SALE', 'CONSIGN_RETURN', 'ADJUST_COUNT', 'EXPIRED_WRITEOFF', 'FREEBIE_ISSUE', 'TASTING', 'BUNDLE_BUILD', 'BUNDLE_BREAK');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('RESTOCK', 'RETURN', 'REPLACEMENT', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'DISCREPANCY', 'RESOLVED', 'VOIDED');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WALK_IN', 'DELIVERY', 'SHIPPING_COURIER', 'SHIPPING_MARKETPLACE', 'FRANCHISE', 'DEALER', 'AGENT', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'ONLINE', 'CREDIT_CARD', 'AR_PDC');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('DEALER', 'FRANCHISE', 'AGENT', 'CONSIGNEE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "PaidFrom" AS ENUM ('CASH_DRAWER', 'PETTY_CASH', 'BANK_ACCOUNT', 'OWNER_ADVANCE');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('OPEN', 'RESOLVED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "WriteoffReason" AS ENUM ('EXPIRED', 'DAMAGED', 'SPOILED');

-- CreateEnum
CREATE TYPE "ConsignmentDirection" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "ValuationBasis" AS ENUM ('SRP', 'COST', 'CONSIGNEE_PRICE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('CASH', 'AR', 'INVENTORY', 'ADVANCES_TO', 'FIXED_ASSET', 'ACCUM_DEPN', 'CURRENT_LIABILITY', 'ADVANCES_FROM', 'EQUITY', 'REVENUE', 'DIRECT_COST', 'OPEX', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "EntryScope" AS ENUM ('BRANCH', 'MAIN', 'BOTH');

-- CreateEnum
CREATE TYPE "PaymentAccountType" AS ENUM ('CASH_DRAWER', 'PETTY_CASH', 'BANK', 'GCASH', 'PLATFORM', 'CREDIT_CARD_SETTLEMENT');

-- CreateEnum
CREATE TYPE "Book" AS ENUM ('BENTA', 'GENERAL', 'ADVANCES', 'GASTOS_OPEX', 'GASTOS_DC');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CLOSED');

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "is_selling" BOOLEAN NOT NULL DEFAULT false,
    "franchise_owner_user_id" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "email_digest" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_location_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "terms_days" INTEGER NOT NULL DEFAULT 0,
    "ap_account_id" TEXT,
    "is_consignor" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accounting_class" "AccountingClass" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "brand" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pc',
    "supplier_id" TEXT,
    "track_expiry" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_bundle" BOOLEAN NOT NULL DEFAULT false,
    "franchise_visible" BOOLEAN NOT NULL DEFAULT true,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_components" (
    "id" TEXT NOT NULL,
    "bundle_product_id" TEXT NOT NULL,
    "component_product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "bundle_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "approved_by" TEXT,
    "source_doc_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costs" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "approved_by" TEXT,
    "source_doc_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "product_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "min_stock_levels" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "min_qty" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "min_stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_no" TEXT,
    "expiry_date" DATE,
    "received_ref" TEXT,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "original_unit_cost" DECIMAL(14,2),
    "supplier_id" TEXT,
    "is_consignment_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty_delta" INTEGER NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_date" DATE NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "location_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("location_id","product_id","batch_id")
);

-- CreateTable
CREATE TABLE "control_sequences" (
    "id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "location_id" TEXT,
    "year" INTEGER,
    "next_no" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "control_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "scan_status" TEXT NOT NULL DEFAULT 'CLEAN',
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_ref" TEXT,
    "is_consignment_in" BOOLEAN NOT NULL DEFAULT false,
    "paid_on_receipt" BOOLEAN NOT NULL DEFAULT false,
    "payment_account_id" TEXT,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "receiving_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receiving_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "free_qty" INTEGER NOT NULL DEFAULT 0,
    "expiry_date" DATE,
    "batch_no" TEXT,
    "unit_cost" DECIMAL(14,2),
    "cost_unchanged" BOOLEAN NOT NULL DEFAULT false,
    "is_new_product" BOOLEAN NOT NULL DEFAULT false,
    "batch_id" TEXT,
    "remarks" TEXT,

    CONSTRAINT "receiving_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "from_location_id" TEXT NOT NULL,
    "to_location_id" TEXT NOT NULL,
    "transfer_type" "TransferType" NOT NULL,
    "return_reason" TEXT,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "received_by" TEXT,
    "received_at" TIMESTAMP(3),
    "discrepancy_case_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "transfer_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty_sent" INTEGER NOT NULL,
    "qty_received" INTEGER,
    "checker_remarks" TEXT,
    "discrepancy_note" TEXT,
    "shortfall_resolution" TEXT,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "location_id" TEXT,
    "agent_id" TEXT,
    "ar_account_id" TEXT,
    "contact" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "on_payroll" BOOLEAN NOT NULL DEFAULT false,
    "default_tier" TEXT NOT NULL DEFAULT 'AGENT',
    "employee_id" TEXT,
    "ar_account_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'POSTED',
    "location_id" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "channel_sub" TEXT,
    "customer_id" TEXT,
    "agent_id" TEXT,
    "rider_id" TEXT,
    "customer_name" TEXT,
    "dr_si_no" TEXT NOT NULL,
    "payment_mode" "PaymentMode" NOT NULL,
    "payment_account_id" TEXT,
    "proof_of_payment_attachment_id" TEXT,
    "card_mid" TEXT,
    "card_slip_no" TEXT,
    "card_approval_code" TEXT,
    "card_batch_no" TEXT,
    "delivery_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rider_incentive" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipping_expense" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "marketplace_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "product_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE,
    "pdc_bank" TEXT,
    "pdc_cheque_no" TEXT,
    "pdc_date" DATE,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "special_price_approval_id" TEXT,
    "special_price_status" TEXT,
    "discrepancy_case_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "sales_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price_tier" TEXT NOT NULL,
    "tier_price" DECIMAL(14,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "is_freebie" BOOLEAN NOT NULL DEFAULT false,
    "line_remarks" TEXT,
    "near_expiry_warn" BOOLEAN NOT NULL DEFAULT false,
    "special_price_flag" TEXT,

    CONSTRAINT "sales_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "credit_note_no" TEXT NOT NULL,
    "customer_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_mode" "PaymentMode" NOT NULL,
    "payment_account_id" TEXT,
    "proof_attachment_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "business_date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "sales_doc_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_deposits" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "deposited_at" DATE NOT NULL,
    "slip_attachment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "cash_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'POSTED',
    "location_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "payee" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_from" "PaidFrom" NOT NULL,
    "paid_from_account_id" TEXT,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "expense_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "franchise_expenses" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "payee" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "franchise_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closes" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,
    "closed_by" TEXT,
    "cash_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_expenses" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_cash" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "counted_cash" DECIMAL(14,2),
    "cash_variance" DECIMAL(14,2),
    "money_breakdown" JSONB,
    "total_cash_deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "daily_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_close_edits" (
    "id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "approval_request_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_close_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" TEXT NOT NULL,
    "count_date" DATE NOT NULL,
    "counted_by" TEXT NOT NULL,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "count_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "count_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "actual_qty" INTEGER,
    "variance" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discrepancy_cases" (
    "id" TEXT NOT NULL,
    "count_doc_id" TEXT NOT NULL,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
    "deadline" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "final_report_generated_at" TIMESTAMP(3),
    "charge_form_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discrepancy_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_forms" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "discrepancy_case_id" TEXT,
    "reason" TEXT,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "finalized_by_hr_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "payroll_deduction_schedule" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_form_lines" (
    "id" TEXT NOT NULL,
    "charge_form_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_charge" DECIMAL(14,2) NOT NULL,
    "batch_cost" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "charge_form_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_form_allocations" (
    "id" TEXT NOT NULL,
    "charge_form_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "deducted_to_date" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "charge_form_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expiry_writeoff_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" TEXT NOT NULL,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expiry_writeoff_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expiry_writeoff_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" "WriteoffReason" NOT NULL,

    CONSTRAINT "expiry_writeoff_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignment_agreements" (
    "id" TEXT NOT NULL,
    "direction" "ConsignmentDirection" NOT NULL,
    "counterparty_location_id" TEXT,
    "supplier_id" TEXT,
    "valuation_basis" "ValuationBasis" NOT NULL DEFAULT 'COST',
    "settlement_terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consignment_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignment_sale_reports" (
    "id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "sales_doc_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "consignment_sale_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignment_sale_lines" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "consignment_sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_change_docs" (
    "id" TEXT NOT NULL,
    "control_no" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE NOT NULL,
    "notes" TEXT,
    "prepared_by" TEXT NOT NULL,
    "approval_request_id" TEXT,
    "revaluation_request_id" TEXT,
    "revaluation_status" TEXT,
    "applied_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_change_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_change_lines" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "tier" TEXT,
    "old_price" DECIMAL(14,2),
    "new_price" DECIMAL(14,2),
    "cost_old" DECIMAL(14,2),
    "cost_new" DECIMAL(14,2),

    CONSTRAINT "price_change_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revaluation_entries" (
    "id" TEXT NOT NULL,
    "price_change_doc_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "cost_old" DECIMAL(14,2) NOT NULL,
    "cost_new" DECIMAL(14,2) NOT NULL,
    "total_gain" DECIMAL(14,2) NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voucher_id" TEXT,

    CONSTRAINT "revaluation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revaluation_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "gain" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "revaluation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "required_approver_roles" TEXT[],
    "any_of" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "auto_approve_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "discrepancy_case_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "alert_states" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_key" TEXT NOT NULL,
    "last_sent_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title_pattern" TEXT NOT NULL,
    "class" "AccountClass" NOT NULL,
    "channel_tag" TEXT,
    "entry_scope" "EntryScope" NOT NULL DEFAULT 'BRANCH',
    "applies_to" TEXT NOT NULL DEFAULT 'BRANCH',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "account_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "class" "AccountClass" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "branch_tag_id" TEXT,
    "channel_tag" TEXT,
    "entry_scope" "EntryScope" NOT NULL DEFAULT 'MAIN',
    "is_payment_account" BOOLEAN NOT NULL DEFAULT false,
    "payment_account_type" "PaymentAccountType",
    "counterparty_type" TEXT,
    "counterparty_id" TEXT,
    "template_id" TEXT,
    "parent_code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_vouchers" (
    "id" TEXT NOT NULL,
    "voucher_no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "book" "Book" NOT NULL,
    "reference" TEXT,
    "remarks" TEXT,
    "name" TEXT,
    "source_document_type" TEXT,
    "source_document_id" TEXT,
    "rule" TEXT,
    "is_reversal" BOOLEAN NOT NULL DEFAULT false,
    "reverses_voucher_id" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "journal_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "voucher_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beginning_balances" (
    "id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approval_request_id" TEXT,
    "posted_voucher_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "beginning_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "approval_request_id" TEXT,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_sequences" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_no" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "voucher_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_account_id" TEXT NOT NULL,
    "accum_depn_account_id" TEXT NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL,
    "salvage_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "useful_life_months" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "location_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "voucher_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_no" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "location_id" TEXT,
    "position" TEXT,
    "basic_rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pay_frequency" TEXT NOT NULL DEFAULT 'SEMI_MONTHLY',
    "sss_no" TEXT,
    "phic_no" TEXT,
    "hdmf_no" TEXT,
    "bank_account" TEXT,
    "user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "per_period" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "finalized_at" TIMESTAMP(3),
    "finalized_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "paid_from_account_id" TEXT,
    "finalize_voucher_id" TEXT,
    "close_voucher_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overtime" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "incentives" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "thirteenth_month_accrual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sss_ee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sss_er" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "phic_ee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "phic_er" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hdmf_ee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hdmf_er" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loans" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "charge_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_tables" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "rows" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_session_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "login_session_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_location_assignments_user_id_location_id_key" ON "user_location_assignments"("user_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_key_key" ON "user_permission_overrides"("user_id", "permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_components_bundle_product_id_component_product_id_key" ON "bundle_components"("bundle_product_id", "component_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_tiers_key_key" ON "price_tiers"("key");

-- CreateIndex
CREATE INDEX "price_lists_product_id_tier_idx" ON "price_lists"("product_id", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_product_id_tier_effective_from_key" ON "price_lists"("product_id", "tier", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "product_costs_product_id_effective_from_key" ON "product_costs"("product_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "min_stock_levels_product_id_location_id_key" ON "min_stock_levels"("product_id", "location_id");

-- CreateIndex
CREATE INDEX "batches_product_id_expiry_date_idx" ON "batches"("product_id", "expiry_date");

-- CreateIndex
CREATE INDEX "stock_ledger_location_id_product_id_idx" ON "stock_ledger"("location_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_ledger_document_type_document_id_idx" ON "stock_ledger"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "stock_ledger_business_date_idx" ON "stock_ledger"("business_date");

-- CreateIndex
CREATE INDEX "stock_balances_location_id_product_id_idx" ON "stock_balances"("location_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "control_sequences_doc_type_location_id_year_key" ON "control_sequences"("doc_type", "location_id", "year");

-- CreateIndex
CREATE INDEX "attachments_document_type_document_id_idx" ON "attachments"("document_type", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "receiving_docs_location_id_control_no_key" ON "receiving_docs"("location_id", "control_no");

-- CreateIndex
CREATE INDEX "transfer_docs_to_location_id_status_idx" ON "transfer_docs"("to_location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_docs_from_location_id_control_no_key" ON "transfer_docs"("from_location_id", "control_no");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "sales_docs_location_id_doc_date_idx" ON "sales_docs"("location_id", "doc_date");

-- CreateIndex
CREATE INDEX "sales_docs_payment_mode_due_date_idx" ON "sales_docs"("payment_mode", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_docs_location_id_dr_si_no_key" ON "sales_docs"("location_id", "dr_si_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_credit_note_no_key" ON "payments"("credit_note_no");

-- CreateIndex
CREATE INDEX "expense_docs_location_id_doc_date_idx" ON "expense_docs"("location_id", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "expense_docs_location_id_control_no_key" ON "expense_docs"("location_id", "control_no");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closes_location_id_business_date_key" ON "daily_closes"("location_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "count_docs_location_id_control_no_key" ON "count_docs"("location_id", "control_no");

-- CreateIndex
CREATE UNIQUE INDEX "count_lines_doc_id_product_id_key" ON "count_lines"("doc_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "discrepancy_cases_count_doc_id_key" ON "discrepancy_cases"("count_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "discrepancy_cases_charge_form_id_key" ON "discrepancy_cases"("charge_form_id");

-- CreateIndex
CREATE UNIQUE INDEX "charge_forms_control_no_key" ON "charge_forms"("control_no");

-- CreateIndex
CREATE UNIQUE INDEX "expiry_writeoff_docs_location_id_control_no_key" ON "expiry_writeoff_docs"("location_id", "control_no");

-- CreateIndex
CREATE UNIQUE INDEX "price_change_docs_control_no_key" ON "price_change_docs"("control_no");

-- CreateIndex
CREATE INDEX "approval_requests_status_type_idx" ON "approval_requests"("status", "type");

-- CreateIndex
CREATE INDEX "approval_requests_document_type_document_id_idx" ON "approval_requests"("document_type", "document_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_user_id_at_idx" ON "audit_log"("user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_states_kind_ref_key_key" ON "alert_states"("kind", "ref_key");

-- CreateIndex
CREATE UNIQUE INDEX "account_templates_key_key" ON "account_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "accounts_class_idx" ON "accounts"("class");

-- CreateIndex
CREATE INDEX "accounts_branch_tag_id_idx" ON "accounts"("branch_tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_vouchers_voucher_no_key" ON "journal_vouchers"("voucher_no");

-- CreateIndex
CREATE INDEX "journal_vouchers_date_idx" ON "journal_vouchers"("date");

-- CreateIndex
CREATE INDEX "journal_vouchers_source_document_type_source_document_id_idx" ON "journal_vouchers"("source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "beginning_balances_fiscal_year_account_id_key" ON "beginning_balances"("fiscal_year", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_year_month_key" ON "accounting_periods"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_sequences_prefix_year_key" ON "voucher_sequences"("prefix", "year");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_asset_id_year_month_key" ON "depreciation_entries"("asset_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_no_key" ON "employees"("employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_run_id_employee_id_key" ON "payroll_lines"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_session_records_session_id_key" ON "login_session_records"("session_id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_franchise_owner_user_id_fkey" FOREIGN KEY ("franchise_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_location_assignments" ADD CONSTRAINT "user_location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_ap_account_id_fkey" FOREIGN KEY ("ap_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_bundle_product_id_fkey" FOREIGN KEY ("bundle_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costs" ADD CONSTRAINT "product_costs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "min_stock_levels" ADD CONSTRAINT "min_stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "min_stock_levels" ADD CONSTRAINT "min_stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_sequences" ADD CONSTRAINT "control_sequences_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_docs" ADD CONSTRAINT "receiving_docs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_docs" ADD CONSTRAINT "receiving_docs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "receiving_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_docs" ADD CONSTRAINT "transfer_docs_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_docs" ADD CONSTRAINT "transfer_docs_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "transfer_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_ar_account_id_fkey" FOREIGN KEY ("ar_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_ar_account_id_fkey" FOREIGN KEY ("ar_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "sales_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_sales_doc_id_fkey" FOREIGN KEY ("sales_doc_id") REFERENCES "sales_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_deposits" ADD CONSTRAINT "cash_deposits_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_docs" ADD CONSTRAINT "expense_docs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_docs" ADD CONSTRAINT "expense_docs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_docs" ADD CONSTRAINT "expense_docs_paid_from_account_id_fkey" FOREIGN KEY ("paid_from_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "franchise_expenses" ADD CONSTRAINT "franchise_expenses_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_docs" ADD CONSTRAINT "count_docs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "count_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "count_lines" ADD CONSTRAINT "count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancy_cases" ADD CONSTRAINT "discrepancy_cases_count_doc_id_fkey" FOREIGN KEY ("count_doc_id") REFERENCES "count_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discrepancy_cases" ADD CONSTRAINT "discrepancy_cases_charge_form_id_fkey" FOREIGN KEY ("charge_form_id") REFERENCES "charge_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_forms" ADD CONSTRAINT "charge_forms_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_form_lines" ADD CONSTRAINT "charge_form_lines_charge_form_id_fkey" FOREIGN KEY ("charge_form_id") REFERENCES "charge_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_form_lines" ADD CONSTRAINT "charge_form_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_form_allocations" ADD CONSTRAINT "charge_form_allocations_charge_form_id_fkey" FOREIGN KEY ("charge_form_id") REFERENCES "charge_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_form_allocations" ADD CONSTRAINT "charge_form_allocations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_writeoff_docs" ADD CONSTRAINT "expiry_writeoff_docs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_writeoff_lines" ADD CONSTRAINT "expiry_writeoff_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "expiry_writeoff_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_writeoff_lines" ADD CONSTRAINT "expiry_writeoff_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expiry_writeoff_lines" ADD CONSTRAINT "expiry_writeoff_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_agreements" ADD CONSTRAINT "consignment_agreements_counterparty_location_id_fkey" FOREIGN KEY ("counterparty_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_agreements" ADD CONSTRAINT "consignment_agreements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_sale_reports" ADD CONSTRAINT "consignment_sale_reports_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "consignment_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_sale_lines" ADD CONSTRAINT "consignment_sale_lines_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "consignment_sale_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_sale_lines" ADD CONSTRAINT "consignment_sale_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change_lines" ADD CONSTRAINT "price_change_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "price_change_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change_lines" ADD CONSTRAINT "price_change_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revaluation_lines" ADD CONSTRAINT "revaluation_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "revaluation_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revaluation_lines" ADD CONSTRAINT "revaluation_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_branch_tag_id_fkey" FOREIGN KEY ("branch_tag_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "account_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beginning_balances" ADD CONSTRAINT "beginning_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_fkey" FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accum_depn_account_id_fkey" FOREIGN KEY ("accum_depn_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
