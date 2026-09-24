# Decisions log

Things the build had to decide that the spec does not cover, or where the spec left room. Owner-facing ASSUMPTIONS from §18 are listed in the README; this file is the engineering log.

| # | Area | Decision | Why |
|---|---|---|---|
| D1 | Sales & stock | A sale posts stock **on save** (FEFO batch per line) and the journal (R3/R4 + R5) in the same transaction; only the special price is gated by approval. A rejected special price flags the sale for correction via void / post-close edit. | §6.2 exception. |
| D2 | Bundles | Selling a bundle product consumes its components (FEFO per component) and records the bundle SKU on the sale line; component picks are recorded in the ledger. | §4.2 "Selling a bundle consumes components". |
| D3 | Transfers | Stock moves sender → virtual `IN_TRANSIT` on approval and `IN_TRANSIT` → receiver on confirmation; shortfalls stay in transit until the Head Auditor picks TO_SENDER / TO_RECEIVER / WRITEOFF. Consignment-out and customer returns skip the transit hop (received immediately). | §7.3, §7.4. |
| D4 | Customer returns | Modelled as a RETURN transfer from the virtual `V-CUSTRET` location with a reason; posts `SALE_RETURN` at the branch against the newest (or chosen) batch. Requires no approval because it only adds stock. | Mirrors LEDGER4. |
| D5 | Control numbers | Per document type and per location where paper forms do so (`RCV-WH-000001`, `PO-WESTAVE-000001`, `DR-WESTAVE-…`, `EXP-…`, `CNT-…`, `WO-…`, `CN-000001`, `CHG-000001`). Implemented with `INSERT … ON CONFLICT` on NOT NULL key columns (NULL keys defeat ON CONFLICT — found by the e2e suite). | §4.4. |
| D6 | Daily close | Any business day earlier than the Manila calendar date counts as closed, whether or not the midnight job ran (job failures cannot reopen a day). Expected cash includes **cash AR collections** received at the branch that day. | §8.4. |
| D7 | Post-close edits | Stored as a JSON diff and applied on approval to header fields (DR no., channel, payment details, fees, notes) or as a void; quantity/price changes are handled by void + re-entry (itself an edit request). | Keeps stock and journal consistent. |
| D8 | Posting switch | Auto journal posting is behind `gl.auto_posting_enabled` (default off). When enabled, a missing account (e.g. branch accounts not yet generated) is logged as `POSTING_SKIPPED` in the audit log instead of failing the operational document. | Phase 1 go-live before Phase 2. |
| D9 | Account resolution | Posting rules resolve accounts through templates (`AccountTemplate` × branch tag) and a fixed list of company-wide accounts (`GLOBAL_ACCOUNTS`, codes 1010–9120). The COA import matches imported titles to templates so old and new branches behave identically. | §10.2. |
| D10 | 13th month | The 13th-month accrual expense in R13 is offset to a new "13th Month Pay Payable" liability (2230) so the payroll entry balances. | Spec listed the debit only. |
| D11 | Consignee AR | Consignment-out sale reports create a customer of type CONSIGNEE linked to the consignee location; AR resolves to that customer's AR account if one exists, else "AR – Others ({warehouse})". | §7.4. |
| D12 | Charge forms | Unit charge = FRANCHISE tier in effect on the count date; batch cost is stored on the line for R11 but stripped from every API response for roles without `cost.view` (HR). Positive variances are shown but not charged. Manual charge forms use the same allocation UI. | §7.7, §11. |
| D13 | Discrepancy finalisation | At the deadline the job also posts `ADJUST_COUNT` rows so on-hand matches the counted quantities; R11 later moves the shortfall value to Advances to Employees when HR finalizes. | Keeps stock truthful after the window. |
| D14 | Alerts dedupe | One notification per (kind, location, product/batch) per day; expiry: first notice at T-6 months, then the 1st of each month, then daily once expired. Stored in `alert_states`. | §7.5, §7.6, §12. |
| D15 | Sessions | Cookie (httpOnly) **and** bearer token are accepted; the web app stores the token for mobile Safari cookie quirks. | Phone usage. |
| D16 | Uploads | Local-disk storage when `S3_ENDPOINT` is empty (dev); MinIO/S3 otherwise. ClamAV INSTREAM over TCP; `CLAMAV_REQUIRED=false` degrades to `SKIPPED` scan status so dev works without clamd. | §3. |
| D17 | Reports layout | The Daily Branch Sales Report builder and the xlsx/PDF renderers follow the section list in §8.5. Exact cell positions must be aligned against `SAles Report Sample.xlsx` once the file is in `/seed/`. | File not available at build time. |
| D18 | Cash flow | Indirect method derived from balance-sheet movements (NI + depreciation ± working capital; investing = fixed assets; financing = equity/advances-from). | §10.5 gave the sheet name only. |
| D19 | Payroll contributions | SSS/PHIC/HDMF tables are editable JSON config (`contribution_tables`): SSS as brackets `{from,to,ee,er}`, PHIC/HDMF as rates with min/max. No table → zero contributions until HR loads them. | §11 "current government tables stored as editable config". |
| D20 | Prisma Decimals | Decimals are serialised as strings in API responses (both the fast path and the redaction walker). Frontend formats them with `peso()`. | Exactness. |

## Proposals not implemented (out of scope / for later)

- Shopee/Lazada/TikTok CSV import of platform orders.
- AP payments module (AP ageing currently derives from unpaid receiving docs).
- Barcode label printing.
- Per-branch rider incentive rules (incentive is entered per delivery sale today).
