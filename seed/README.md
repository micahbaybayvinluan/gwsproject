# Seed workbooks

The owner's three source workbooks live here and are loaded automatically by `pnpm --filter @gws/api prisma:seed` (see `api/prisma/seed-workbooks.ts`):

| File | What the seed loads from it |
|---|---|
| `inventory.xlsm` | Sheet `DAILY INVTY COUNT`: every product (col B), brand (from the ALL-CAPS brand header rows), FRANCHISEE / DEALER / RETAILER prices (cols C–E), COST (col F, blank in the file) and the opening quantity on hand (col G) posted to the Warehouse as of the sheet's "BEG. INVTY." date. Products the classifier is unsure about get `needsReview=true`. |
| `ACCTG PROGRAM - FORMAT.xlsm` | Sheets `BALANCE SHEET` + `INCOME STATEMENT`: the full chart of accounts with branch/channel tags and template links; codes from the sheet or from `CA`, generated in the workbook's ranges otherwise; beginning balances for the fiscal year from the BEG column (statement-side sign); `AR - Dealer (…)` accounts create dealer customers. |
| `SAles Report Sample.xlsx` | Copied to `api/templates/daily-sales-report.xlsx`; the Daily Branch Sales Report export fills this workbook so FRONT matches the sample cell for cell (`api/src/reports/daily-sales-template.ts`). |

The same imports are available in the app under **Catalogue → Imports** for re-runs and for new files. Re-running the seed never duplicates: existing products/accounts are kept and opening stock is posted only once.

The `.xlsm` files contain legacy VML comment drawings that the Excel library rejects; `api/src/imports/workbook-readers.ts` strips those parts before loading.
