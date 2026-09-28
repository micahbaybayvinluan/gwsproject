# GWS-ERP — Simulation guide and login details

Everything runs on your Mac at **http://localhost:5173** (see README "Quick start"). Every account below uses the password:

> **ChangeMe!2026**

**Each account belongs to one person.** The first time you sign in to an account it shows an accountability statement with the person's name and company ID (the demo accounts use DEMO-001 … DEMO-023). Tick the box and press **I accept**. Only one device can be signed in to an account at a time: signing in to the same account in another window signs the first window out, with a message. To play two roles side by side, use two different browsers (for example Safari and Chrome) or a normal and a private window.

Two-factor codes are switched off for the simulation (`AUTH_TOTP_OPTIONAL=true` in `api/.env`). Set it to `false` before real use; Admin, External Auditor, Head Auditor and Accounting Head will then be asked to enrol an authenticator app on first login.

## Accounts (numbered as in your role list)

| # | Role | Username | Branch / scope | Cost visible? |
|---|---|---|---|---|
| I | ADMIN – Owner (all access, can edit, final approver) | `admin` | All | Yes |
| II | External Auditor (read-only, incl. financial statements & payroll) | `ext.auditor` | All | Yes |
| III | Head Auditor | `head.auditor` | All | Yes |
| IV | Asst Auditor | `asst.auditor` | All | Yes |
| V | Audit Associate (branch reports, corrections approved by the Head Auditor) | `audit.assoc` | All branches, reports only | Yes |
| VI | Warehouse in Charge | `wh.incharge` | Warehouse | No |
| VII | Warehouse Associate | `wh.assoc` | Warehouse | No |
| VIII | Sales Associate – **West Ave** | `sales.westave` | West Ave | No |
| VIII | Sales Associate – **CSR** | `sales.csr` | CSR | No |
| VIII | Sales Associate – **Imus Cavite** | `sales.imus` | Imus Cavite | No |
| VIII | Sales Associate – **Laguna** | `sales.laguna` | Laguna | No |
| VIII | Sales Associate – **Dasmariñas** | `sales.dasma` | Dasmariñas | No |
| VIII | Sales Associate – **Vito Cruz** | `sales.vitocruz` | Vito Cruz | No |
| VIII | Sales Associate – **Warehouse store** | `sales.wh` | Warehouse (selling counter) | No |
| IX | Franchise Sales Associate – **Mayon** | `fr.mayon.assoc` | Mayon | No |
| IX | Franchise Sales Associate – **Malolos Bulacan** | `fr.malolos.assoc` | Malolos Bulacan | No |
| X | Franchise Owner – **Mayon** | `fr.mayon.owner` | Mayon | Franchise price only |
| X | Franchise Owner – **Malolos Bulacan** | `fr.malolos.owner` | Malolos Bulacan | Franchise price only |
| XI | Other users (custom permissions ticked by Admin) | `custom.user` | As configured | As configured |
| XII | Accounting Head | `acct.head` | Finance | Yes |
| XIII | Accounting Associate | `acct.assoc` | Finance (payroll totals only) | Yes |
| XIV | HR Staff | `hr.staff` | Payroll & charge forms only | No |
| XV | Field Auditor | `field.auditor` | Every branch, franchise and the warehouse (inventory only, counts, inspections) | No |
| XVI | Executive Assistant | `exec.assistant` | Main-office bank accounts, supplier payables, office expenses, balance-sheet accounts | No |
| XVII | E-comm Associate (TikTok, Shopee, Lazada) | `ecomm.assoc` | E-commerce only; items come from the Warehouse | No |

Admin can add more users of any role under **Admin → Users & Roles** (for example a Sales Associate for another branch or a Franchise Owner for Parañaque): username, email, the person's full name, their **company ID number** (required), role, a temporary password, and the branch(es) to assign. At first sign-in that person must set their own password and accept the accountability statement. Users & Roles shows each person's ID, whether they accepted, their last sign-in and recent devices; **Activity** opens everything they did in the Audit Log.

Riders already exist for each branch (e.g. Jaime and Carlo at West Ave); agents Jerick Quinto (West Ave), Matt Angelo Asma (Dasmariñas), Raymart Bagatua (Warehouse); dealers Topform, Level Up, Good Stuff, Juan Whey, Whey Avenue and the dealers from your chart of accounts.

Your real data is loaded: 1,120 products with prices, Warehouse opening stock from `inventory.xlsm`, and the full chart of accounts with 2026 beginning balances.

## Suggested walk-through (about 30 minutes)

Use two browser windows, or log out and in between steps. Each step names the account to use.

**1. Warehouse receives stock** — `wh.assoc`
Inventory → Receiving → New receiving: pick a supplier code, add "Prothin Whey Ripped 60s (Choco)" qty 24 with an expiry date next year, create draft, open it, upload any photo as the supplier invoice, **Submit for cost approval**. Notice there is no cost column for this role.

**2. Head Auditor approves the cost** — `head.auditor`
Approvals (badge in the menu) → the receiving shows "new" per line → open it, type the unit cost (e.g. 900) → Save costs → Approve. Stock now appears in Stock on Hand at the Warehouse with its batch and expiry.

**3. Branch requests stock** — `sales.westave`
Inventory → Transfers: From Warehouse, To West Ave, type RESTOCK, add the product qty 12 → Create draft → Submit for approval. The system picks the earliest-expiry batches.

**4. Approve the transfer** — `asst.auditor` (either auditor is enough for internal transfers)
Approvals → Approve. Stock is now "in transit".

**5. Branch confirms receipt** — `sales.westave`
Transfers → open the incoming transfer. This is the branch's copy (print it with **Transfer-In copy**). Tick each line that arrived complete, or tick **Tick all** if everything is correct → Confirm receipt. To see the shortfall flow, leave a line unticked and type the quantity actually received (e.g. 11 instead of 12) with a note. If short, `head.auditor` resolves it under Transfers → Resolve shortfall.

**6. Sell** — `sales.westave` (works on a phone too)
New Sale: DR number, channel Walk in, Cash, search "whey", qty 2, Save. Then a Delivery sale with rider Jaime and a delivery fee. Then a sale where you lower the price below SRP: it saves, and Admin gets a **Special price** approval showing cost and margin (only Admin sees that).
Try an Online sale: it refuses until you upload proof of payment and pick the GCash/bank account.

**7. Approve the special price** — `admin`
Approvals → Special price → expand to see tier price, sold price, discount %, margin → Approve (or tick several and use Approve selected).

**8. Dealer on credit, then collection** — `sales.westave`
New Sale: channel Prothin Dealer, payment AR/PDC, customer Topform, due date. Then AR / Credit → tick the invoice → Record payment (partial amount) → a Credit Note number is issued.

**9. Branch expense and daily close** — `sales.westave`
Expenses: pick "Meralco - West Ave" (only West Ave accounts are listed), amount 300, cash drawer. Daily Close: fill the Money Breakdown, Save cash count, then **Daily Sales Report xlsx**. Open the file: it is your `SAles Report Sample.xlsx` layout with today's numbers.

**10. Try to edit a closed day** — `sales.westave` (any sale dated before today)
Open the sale → Void: it is refused because the day is closed → "Request post-close void". `head.auditor` approves, nothing changes yet; `asst.auditor` approves, then it applies. Both are needed.

**11. Inventory count and discrepancy** — `field.auditor`, then `head.auditor`, then `hr.staff`
Inventory Count → Create count sheet for West Ave → enter actual quantities with one item short → Submit. A discrepancy case opens with a 7-day deadline. Admin can force the deadline with Discrepancies → run-deadline (Settings → or the API button) to produce the Final Discrepancy Report and a Charge Form at franchise cost. `hr.staff` opens HR → Charge Forms, splits it between two employees, Finalize. HR never sees product cost.

**12. Franchise side** — `fr.mayon.owner` / `fr.mayon.assoc`
Admin first sends stock: Transfers From Warehouse To Mayon (needs Admin approval). The franchise associate confirms it under Transfers; the owner sees stock, incoming transfers, today's sales, what they owe GWS and their own P&L under Franchise Portal. The associate cannot change prices.

**13. Alerts** — `admin`
Settings-free: Expiry & Alerts shows critical stock (set minimums under Catalogue → Products / min stock) and expiring batches; the nightly job sends notifications (bell icon). Admin can run it now from Expiry & Alerts → API `/api/alerts/run` or wait for 00:30 Manila.

**14. Accounting (Phase 2)** — `acct.head`, `admin`, `ext.auditor`
Settings → set `gl.auto_posting_enabled` to `true`. From then every sale, expense, transfer and receiving posts a journal voucher (Accounting → Journal Vouchers, "View journal entry"). Trial Balance shows the imported beginning balances. `acct.head` can request a period lock; `admin` approves. Only `admin` and `ext.auditor` can open Financial Statements (Income Statement, Balance Sheet with the "Should be 0" row, NI per Branch, Cash Flow); `acct.head` gets a 403 there by design.

**15. Payroll** — `hr.staff` then `acct.head`
HR → Payroll: add employees, create a run for a period (charge-form deductions are pulled in automatically), Finalize. `acct.head` picks the paying bank account and closes the run.

**16. Custom role** — `admin`
Users & Roles → click `custom.user` → tick the exact permissions and approvals that person may have → Save overrides. Log in as `custom.user` to see only those menus.

**17. Daily Inventory Report (every role)** — try `wh.assoc`, then `sales.westave`, then `head.auditor`
Reports → Inventory Reports → Daily Inventory Report: pick From/To dates, press **Generate xlsx** or read it on screen. "Show" switches between the whole period and one day at a time. Columns: Beg, Receive, Transfer In, Returns, Pull Out, Sales, Other Out (freebies/tasting), Adj (count adjustments & write-offs), End. Associates, franchise users, field auditors and the audit associate get quantities only. Admin, the auditors, and Accounting get the same report with costing added automatically (Transfer In Cost, Pull Out Cost, Cost of Sales, End Value, average unit cost). Each user only sees their own location(s); `hr.staff` has no inventory access (§5.4).

**18. Warehouse sends to a branch or franchise, with a printable draft** — `wh.assoc`
Inventory → Transfers → "Send stock from the warehouse": To = any branch or franchise (e.g. Mayon (franchise)), add items → Create draft. On the draft: **Print Pull-Out (draft)** gives a form stamped DRAFT with your name as preparer; **Edit draft** changes items or quantities; when it is right, **Submit for approval** (franchise → Admin approves; company branch → either auditor). The receiving branch does not see the draft; it gets its copy once you submit.

**19. In-Charge corrects the associate's entry** — `wh.incharge`, then `wh.assoc`
As `wh.incharge`, open a draft (or submitted, not yet approved) receiving or transfer that `wh.assoc` prepared → **Propose edit** → change a quantity → Send. Nothing changes yet. Sign in as `wh.assoc`: the bell and Approvals show "Warehouse edit" with the exact changes (e.g. "qty 3 → 2") → **Accept** (applied, and a submitted document goes back through approval) or **Reject** (stays as it was). The document's "Who did what" panel lists each step with the person's name and ID. The In-Charge also enters receiving and transfers directly, like the associate; costs are still entered and approved by the Head Auditor.

**20. One person per account** — `admin`
Users & Roles → New user: full name, company ID, role, temporary password, branch → Create. Sign in as the new user: they must set their own password, then accept the statement. Sign in to the same account in a second window: the first window is signed out and the person gets a notification.

**21. Charges from HR, with no uploads** — `hr.staff`, then `sales.westave`
As `hr.staff`: HR → Charge Forms → New charge form → kind "Damaged" (or Expired, Cash shortage, Other), branch West Ave, tick the staff, add a line → Create. Open it → Finalize with the number of pay periods → print the Charge Form or the Salary Deduction Authorization. As `sales.westave`: the dashboard shows "My charges"; My Pay & Charges → Acknowledge.

**22. Expired or damaged items: company or staff** — `sales.westave`, then `head.auditor`
Inventory → Write-offs → choose "Charged to staff" and tick who, or "Expensed by the company". After approval, the stock leaves the inventory. A staff charge appears in HR's Charge Forms and in the staff member's My Pay & Charges.

**23. Government contributions** — `hr.staff`, then `acct.assoc`
HR → Payroll & Contributions → run a payroll (the SSS, PhilHealth and Pag-IBIG tables are already loaded) → the Contributions register lists each employee's share and the employer share → Record payment. Sign in as `acct.assoc`: the same screens show totals only, without names.

**24. Branch cash fund** — `sales.westave`, then `admin`, then `field.auditor`
Expenses → Paid from "Cash fund" → save. Cash Fund → "Replenish from today's cash sales"; Daily Close shows it lowers the cash for deposit. `admin` sees every branch fund on the dashboard. `field.auditor` → Cash Fund → pick the branch → type the cash found → Confirm count.

**25. Field Auditor: count sheet and store inspection** — `field.auditor`, then `head.auditor`
Inventory Count → choose the branch → Create count sheet. Every item is listed with its beginning count; type the actual counts → Submit. The sheet is now locked; "Correct this count…" sends a revision to the Head Auditor, and Admin is notified. Store Inspections → New → fill the 19 checklist items from the paper form → Submit to HR. HR, Admin and the Head Auditor are notified.

**26. Weekly count and discrepancy countdown** — `sales.csr`, then `hr.staff`
Sign in as `sales.csr`: the dashboard shows a red "weekly count sheet" alarm → Start my weekly count → type actual counts → Submit. `hr.staff` → Weekly Count Compliance shows who submitted. When a discrepancy is open, the sales associate's dashboard shows the days left in bold red and an Explain button.

**27. AR payment from the branch** — `sales.westave`, then `acct.assoc`
AR / Credit → tick an invoice → enter the amount → "Send payment for Accounting approval". The payment shows "Waiting for Accounting". As `acct.assoc`: Approvals → AR payment → Approve. The invoice balance drops and the credit note is issued.

**28. Audit Associate correction and the Revision Log** — `audit.assoc`, then `head.auditor`, then `hr.staff`
As `audit.assoc`: open a sale → "Request a correction" → choose the field, type the new value and the error found → Send. The sales associate is notified. As `head.auditor`: Approvals → "Audit Associate correction" → Approve (only the Head Auditor can). HR → Revision Log shows every correction and a count per staff member.

**29. Stock request and fixed "From"** — `sales.westave`, then `wh.assoc`
Transfers → "Request stock from the warehouse" → add items → Send. The pull-out form's "From" is fixed to West Ave. As `wh.assoc`: the notification opens Transfers with the branch already chosen as "To". Receiving → "+ another expiry" records one item with two expiry dates.

**30. Help & Guide** — any account, e.g. `sales.westave`, then `hr.staff`
Menu → Help & Guide. The guide shows only your role's sections: compare `sales.westave` with `hr.staff`. Type a question in Ask (e.g. "How do I request stock from the warehouse?"). Without an AI key you get the matching sections; with a key in `api/.env` (see README → Help & Guide and the AI assistant) you get a written answer with "Read more" links.

**31. Owner approves new products, suppliers and employees** — `head.auditor` or `hr.staff`, then `admin`
As `head.auditor`: Products → New product → Save. The list shows "Product waiting for the Owner's approval". As `hr.staff`: Payroll & Contributions → Employees → Add employee (same). As `admin`: Approvals → "New master data (Owner approves)" → Approve. The item is created and the person who entered it is notified. Admin's own new items are created at once.

**32. HR creates a user account** — `hr.staff`, then `admin`
Employees → an approved employee → "Create user account…" → username, role, temporary password, branch → Send. As `admin`: Approvals → Approve. The person can now sign in with that password.

**33. Warehouse In-Charge approval** — `wh.assoc`, then `head.auditor`, then `wh.incharge`
As `wh.assoc`: Receiving → New → Submit. As `head.auditor`: approve the cost. The receiving shows "Cost approved · waiting for the In-Charge". As `wh.incharge`: Approvals → "Goods into the warehouse" → Approve; only now does stock go up. A transfer out prepared by `wh.assoc` also waits for "Goods out of the warehouse". Repeat as `wh.incharge` yourself: only the cost approval is needed. Warehouse sales need no In-Charge approval.

**34. Visual workflow and price notices** — `sales.westave`, `admin`, `fr.mayon.owner`
Open any document waiting for approval: the workflow bar shows each step, who must approve and who already did. The dashboard's "My requests" shows the same. As `admin`: Price Changes → change a retail and a franchise price → approve. `sales.westave` sees the retail change under "Price updates"; `fr.mayon.owner` sees only the franchise price. A cost change on receiving shows only for `admin`, `head.auditor`, `ext.auditor` and `acct.head`.

**35. Franchise owner controls** — `fr.mayon.owner`, then `fr.mayon.assoc`
Franchise Portal → Overview → allow or stop the associate receiving stock. With it on, `fr.mayon.assoc` confirms a delivery and the owner is notified (the associate never sees franchise cost). Staff pay & charges → record a salary for the associate (it becomes a franchise expense) and a charge. Income statement & balance sheet → pick dates. As `fr.mayon.assoc`: My Pay & Charges shows only that person's own pay. `hr.staff` cannot see any of it.

**36. Executive Assistant** — `exec.assistant`
Bank & Office → Bank entries → choose the bank account, the book (e.g. Advances to), the account, amount and payee → Save; a journal voucher is posted. Supplier payables, Office expenses and Balance sheet accounts are view-only. Reports, cost and branch pages are not in the menu.

**37. Journal edit and deletions** — `acct.head`, then `admin`
Accounting → Journal Vouchers → open one → Edit entry → change the lines (they must balance) → Save. The voucher's maker and `admin` are notified. As `admin`: Products → delete a product never used (removed) and one already sold (archived instead).

**38. Company letterhead and logo** — `admin`
Settings → Company letterhead → type the details → Save details. Upload a logo… → slide "Remove the background" until the background is checkered → Use this logo. Print any form: the letterhead is at the top; the sign-in page and menu show the logo.

**39. Incentive and daily report submission** — `sales.westave`
New Sale → add an item → **+ Add incentive expense** (Sales incentive, given to "Juan", ₱50) → Save. Daily Close: expected cash is ₱50 lower. Daily Branch Sales Report → **Submit today's report…** → tick "true and correct" → **I agree — submit**. Try a new sale: the day is closed.

**40. Count sheet with every item** — `sales.csr`, then `head.auditor`, `hr.staff`
Inventory Count Sheets → Start my weekly count sheet. Items in the system come first, then items not in the system. Download the sheet, type the counts in Excel (one item short), upload, submit. Everyone concerned is notified; the case gives 7 days to explain.

**41. Cash on hand** — `head.auditor`, then `sales.westave`, `admin`
Cash on Hand → set West Ave "Days allowed" to 0. As `sales.westave`: the dashboard shows cash due today; **Request extension** with a reason. `head.auditor` and `admin` both approve in Approvals. Record the deposit in Daily Close (choose **Gcash (GWS)** or a bank).

**42. Consignments** — `admin`, then `sales.westave`, `asst.auditor`, `admin`
As `admin`: Catalogue → Consignees → New consignee. As `sales.westave`: Consignment → 1. Send goods → Save draft → Print draft → Submit. `asst.auditor` approves the check, `admin` gives the final approval. Then 2. Record consignee sales: prices are pre-filled and editable; print the draft and submit.

**43. Cost edit, days to consume and customer follow-ups** — `head.auditor`, `admin`, `sales.westave`
As `head.auditor`: open a product → Edit cost → Send for approval; `admin` approves. Set "Days to consume one unit" to 30. As `sales.westave`: sell it with the customer's mobile number. As `admin`: Settings → Customer re-order messages → edit the SMS. Customer Contact List & Follow-ups shows the items ordered and, when due, the customer to call with SMS / Email buttons.

**44. Help** — any account
Help & User Guide opens on **My guide** (the steps for your role), with **Guide for everyone** and **More topics** next to it. `admin` also sees **Every role** for training.

**45. Sales Report and graphs** — `admin`, then `sales.westave`
Reports → Sales Report: choose All branches and This month, then one branch and Last month; Excel. Reports → Monthly Sales Performance: each branch's running total in its own colour, the company total, and each month of the year (hover for amounts, or Show as tables). As `sales.westave` only West Ave appears.

**46. E-commerce: TikTok, Shopee and Lazada** — `ecomm.assoc`, `wh.incharge`, `acct.head`, `admin`
As `ecomm.assoc`: E-commerce → TikTok Shop → 1. Orders → pull-out → **GWS orders template** → fill two orders with GWS SKUs → upload. A draft pull-out appears; open it, **Print picking list**, **Submit**. As `wh.incharge`: Approvals → approve it (stock moves to "TikTok – with courier"). As `ecomm.assoc`: 2. Payouts → **GWS payout template** → one row per order (gross, fees, payout) → upload → check ✓ → **Send to Accounting**. As `acct.head`: approve; Journal Vouchers shows the payout, each TikTok fee, withholding tax and the cost of sales. Back as `ecomm.assoc`: 3. Returns → type an order ID → `wh.incharge` receives it (E-commerce → Returned parcels) marking one item damaged. 4. Ads → record ₱1,000. As `admin`: E-commerce → All platforms: profit report. Do the same on the Shopee and Lazada tabs: each keeps its own orders, payouts and totals.

## Where the files come out

All exports download through the browser: Daily Sales Report (xlsx/PDF), Daily Inventory Report (xlsx, one sheet per day plus Summary and Per-day sheets), every paper form (Pull-Out, Transfer-In, DR-Sales, Supplier's Form, Count sheet, Discrepancy Report, Charge Form, Credit Note, Journal Voucher), every list (Export xlsx / CSV buttons), Trial Balance and the financial statements.
