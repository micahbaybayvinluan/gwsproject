# Seed workbooks

Place the three source workbooks here (they are not committed):

| File | Used by | Sheet(s) |
|---|---|---|
| `inventory.xlsm` | `pnpm --filter @gws/api import:products seed/inventory.xlsm` or Imports → "Seed workbook" | `DAILY INVTY COUNT` (B name, C FRANCHISEE, D DEALER, E RETAILER/SRP, F COST) |
| `ACCTG PROGRAM - FORMAT.xlsm` | `pnpm --filter @gws/api import:coa "seed/ACCTG PROGRAM - FORMAT.xlsm"` or Imports → "Chart of accounts import" (preview + review) | `BALANCE SHEET`, `INCOME STATEMENT` (codes filled from `CA` where present, otherwise generated 6xxx/7xxx/8xxx) |
| `SAles Report Sample.xlsx` | Layout target for the Daily Branch Sales Report export (`api/src/reports/xlsx.service.ts`) | `FRONT`, `WALK IN`, `DELIVERY`, `SHIPPING`, `CREDIT CARD`, `RECEIPT TRACKER` |

The importers are tolerant of the workbooks' messy suffixes ("West Ave." vs "West Ave", "Imus Cavite" vs "Imus", "CSR Ave Dealers") — see `api/src/gl/coa-import.spec.ts` for the cases covered. Rows the product classifier is unsure about are created with `needsReview=true` for the Head Auditor.
