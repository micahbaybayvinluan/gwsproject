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
| XVIII | Sales Manager | `sales.manager` | Sales of every branch, agents and platforms; targets; AR | No |
| XIX | Agent (Jerick Quinto) | `agent.jerick` | Own sales at every branch, own target | No |

Admin can add more users of any role under **Admin → Users & Roles** (for example a Sales Associate for another branch or a Franchise Owner for Parañaque): username, email, the person's full name, their **company ID number** (required), role, a temporary password, and the branch(es) to assign. At first sign-in that person must set their own password and accept the accountability statement. Users & Roles shows each person's ID, whether they accepted, their last sign-in and recent devices; **Activity** opens everything they did in the Audit Log.

Riders already exist for each branch (e.g. Jaime and Carlo at West Ave); agents Jerick Quinto (West Ave), Matt Angelo Asma (Dasmariñas), Raymart Bagatua (Warehouse); dealers Topform, Level Up, Good Stuff, Juan Whey, Whey Avenue and the dealers from your chart of accounts.

Your real data is loaded: 1,120 products with prices, Warehouse opening stock from `inventory.xlsm`, and the full chart of accounts with 2026 beginning balances.

## Suggested walk-through (about 30 minutes)

Use two browser windows, or log out and in between steps. Each step names the account to use.

**1. Warehouse receives stock** — `wh.assoc`
Inventory → Receiving → New receiving: pick a supplier code, add "Prothin Whey Ripped 60s (Choco)" qty 24 with an expiry date next year, create draft, open it, upload any photo as the supplier invoice, **Submit for cost approval**. Notice there is no cost column for this role.

**2. In-Charge checks the goods, then the Head Auditor approves the cost** — `wh.incharge`, then `head.auditor`
As `wh.incharge`: My Approvals → "Goods into the warehouse" → compare with the delivery receipt → Approve. As `head.auditor`: My Approvals → the receiving shows "new" per line → open it, type the unit cost (e.g. 900) → Save costs → Approve. Stock now appears in Stock on Hand at the Warehouse with its batch and expiry.

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
Expenses: pick "Meralco - West Ave" (only West Ave accounts are listed), amount 300, Cash on hand. Daily Close: fill the Money Breakdown, Save cash count, then **Daily Sales Report xlsx**. Open the file: it is your `SAles Report Sample.xlsx` layout with today's numbers.

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
Sign in as `sales.csr`: the dashboard shows a red "weekly count sheet" alarm → Start my weekly count → type actual counts → Submit. `hr.staff` → Weekly Count Check shows who submitted. When a discrepancy is open, the sales associate's dashboard shows the days left in bold red and an Explain button.

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

**33. Warehouse In-Charge approval** — `wh.assoc`, then `wh.incharge`, then `head.auditor`
As `wh.assoc`: Supplier Deliveries → New → Submit. As `wh.incharge`: My Approvals → "Goods into the warehouse" → Approve; the receiving shows "2. Goods checked · waiting for the Head Auditor's cost approval". As `head.auditor`: approve the cost; only now does stock go up. A transfer out prepared by `wh.assoc` also waits for "Goods out of the warehouse". Repeat as `wh.incharge` yourself: only the cost approval is needed. Warehouse sales need no In-Charge approval.

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
New Sale → add an item → **+ Add incentive expense** (Sales incentive, given to "Juan", ₱50) → Save. Daily Close: expected cash is ₱50 lower. Daily Sales Report → **Submit today's report…** → tick "true and correct" → **I agree — submit**. Try a new sale: the day is closed.

**40. Count sheet with every item** — `sales.csr`, then `head.auditor`, `hr.staff`
Stock Counts → Start my weekly count sheet. Items in the system come first, then items not in the system. Download the sheet, type the counts in Excel (one item short), upload, submit. Everyone concerned is notified; the case gives 7 days to explain.

**41. Cash on hand** — `head.auditor`, then `sales.westave`, `admin`
Cash on Hand → set West Ave "Days allowed" to 0. As `sales.westave`: the dashboard shows cash due today; **Request extension** with a reason. `head.auditor` and `admin` both approve in Approvals. Record the deposit in Daily Close (choose **Gcash (GWS)** or a bank).

**42. Consignments** — `admin`, then `sales.westave`, `asst.auditor`, `admin`
As `admin`: Catalogue → Consignees → New consignee. As `sales.westave`: Consignment → 1. Send goods → Save draft → Print draft → Submit. `asst.auditor` approves the check, `admin` gives the final approval. Then 2. Record consignee sales: prices are pre-filled and editable; print the draft and submit.

**43. Cost edit, days to consume and customer follow-ups** — `head.auditor`, `admin`, `sales.westave`
As `head.auditor`: open a product → Edit cost → Send for approval; `admin` approves. Set "Days to consume one unit" to 30. As `sales.westave`: sell it with the customer's mobile number. As `admin`: Settings → Customer re-order messages → edit the SMS. Customers & Follow-ups shows the items ordered and, when due, the customer to call with SMS / Email buttons.

**44. Help** — any account
Help & Guide opens on **My guide** (the steps for your role), with **Guide for everyone** and **More topics** next to it. `admin` also sees **Every role** for training.

**45. Sales Report and graphs** — `admin`, then `sales.westave`
Reports → Sales Report: choose All branches and This month, then one branch and Last month; Excel. Reports → Sales Graphs: each branch's running total in its own colour, the company total, and each month of the year (hover for amounts, or Show as tables). As `sales.westave` only West Ave appears.

**46. E-commerce: TikTok, Shopee and Lazada** — `ecomm.assoc`, `wh.incharge`, `acct.head`, `admin`
As `ecomm.assoc`: E-commerce → TikTok Shop → 1. Orders → pull-out → **GWS orders template** → fill two orders with GWS SKUs → upload. A draft pull-out appears; open it, **Print picking list**, **Submit**. As `wh.incharge`: Approvals → approve it (stock moves to "TikTok – with courier"). As `ecomm.assoc`: 2. Payouts → **GWS payout template** → one row per order (gross, fees, payout) → upload → check ✓ → **Send to Accounting**. As `acct.head`: approve; Journal Vouchers shows the payout, each TikTok fee, withholding tax and the cost of sales. Back as `ecomm.assoc`: 3. Returns → type an order ID → `wh.incharge` receives it (E-commerce → Returned parcels) marking one item damaged. 4. Ads → record ₱1,000. As `admin`: E-commerce → All platforms: profit report. Do the same on the Shopee and Lazada tabs: each keeps its own orders, payouts and totals.

**47. Transfer received with a different quantity** — `wh.incharge`, `sales.westave`, `head.auditor`, `admin`, `hr.staff`
As `wh.incharge`: Transfers & Pull-outs → new transfer to West Ave with 2 of an item → submit; `head.auditor` approves. As `sales.westave`: open it, leave the line unticked, type **1** and "only 1 in the box", add an item that is not on the form, **Confirm receipt**. As `head.auditor`: My Approvals → **Confirm the difference**. As `wh.incharge`: My Approvals → **Agree** (or Disagree with a note: then `admin` decides on the transfer page). The transfer page shows the -002 and -003 forms. As `hr.staff`: HR Notices shows the case.

**48. AR, PDC and approvals with proof** — `sales.westave`, `acct.head`
New Sale → payment AR / PDC → **Dealer** (only dealers are listed) → due date; tick **There is a PDC** to type the cheque. AR & Collections → tick the invoice → record an online payment with a screenshot. As `acct.head`: My Approvals shows the proof and the account; **Reject** asks for the reason.

**49. Expense from the cash on hand** — `sales.csr`
Expenses → Paid from **Cash on hand** → type an amount bigger than the cash on hand shown → **Save**: a notice pops up; press **Pay from the cash fund**.

**50. Sales targets** — `sales.manager`, `admin`, `agent.jerick`
As `sales.manager`: Sales Targets → set a target for West Ave and for Jerick Quinto → Send. As `admin`: approve both in My Approvals. As `sales.manager`: the bars show % achieved against the days gone. As `agent.jerick`: My Sales shows his sales at every branch, his target and his customers' unpaid balances.

**51. Opening AR from before GWS-ERP** — `acct.assoc`, `admin`, `sales.csr`
As `acct.assoc`: AR & Collections → Opening AR → **+ Enter opening AR** → CSR, Dealer, a dealer, DR/SI "OLD-001", invoice date last June, due date last July, ₱12,500 → Send. Add a second one with a PDC. As `admin`: My Approvals → Opening AR → **Tick all** → **Approve all**. As `sales.csr`: the bell shows the new AR; AR & Collections lists both, overdue in red.

**52. Transfers per branch** — `admin`, `wh.incharge`
Transfers & Pull-outs → **Branches** → tick Mayon (franchise) → Done: only Mayon's transfers remain; View → Incoming shows only what Mayon received. Every branch list marks franchises "(franchise)".

**53. Flavors and expiry** — `wh.incharge`, `head.auditor`, `sales.westave`
As `wh.incharge`: Supplier Deliveries → New → one item, 5 **Choco** (expiry next year) and **+ another flavor / expiry** 4 **Vanilla** (later expiry) → Submit; `head.auditor` approves the cost. Transfers: send 2 Vanilla to West Ave: the list asks which flavor / expiry. As `sales.westave`: New Sale → search: only items West Ave has are listed, with the quantity → choose Vanilla → **Review sale** → **Confirm and save sale**. Stock on Hand → Batches → **Set flavors** on old stock.

**54. Owner approves anything** — `admin`
My Approvals → tick **Show everything waiting** → approve an internal transfer waiting for the auditors: it is approved at once and the workflow shows "Owner (final)".

**55. Agent incentives** — `sales.manager`, `acct.assoc`, `acct.head`, `admin`, `hr.staff`, `agent.jerick`
As `sales.manager`: Agent Incentives → this month → Jerick Quinto → 5 (%) → Confirm. `acct.assoc`, `acct.head` and `admin` approve in My Approvals. As `hr.staff`: Agent Incentives → **Print form** → **Agent signed**. As `acct.head`: **Tag as released** → GCash, reference, date. As `agent.jerick`: Agent Incentives shows it released.

**56. Daily Sales Report review** — `sales.csr`
Daily Sales Report → **Review report (Excel)** → Submit today's report…: tick the four review items and the acknowledgement → I agree — submit.

**57. Change a closed day** — `sales.westave`, `hr.staff`, `head.auditor`
After submitting the Daily Sales Report: Daily Close & Deposit → **Change a closed day** → choose a sale → Correct details (DR / SI no.) → reason "Wrong DR / SI number" → Send. The card shows the approvers. Do it three times: `hr.staff` sees HR Notices → "Post-close edits by …" marked red with **Refer to the Owner**; `head.auditor` is told of each one.

**58. Credit-card and e-commerce prices** — `admin`, `sales.westave`, `ecomm.assoc`
As `admin`: E-com & Card Prices → the card fee is 4% (SRP ÷ 0.96); type a TikTok price for a product → Save prices (or **Import the masterlist**). As `sales.westave`: New Sale → pay by credit card: the line shows the credit-card price by itself. `ecomm.assoc` sees the platform prices; `sales.westave` cannot change them.

**59. Franchise AR** — `wh.incharge`, `fr.mayon.owner`, `head.auditor`, `acct.head`, `franchise.coord`, `admin`
`wh.incharge` sends goods to Mayon; `admin` approves; `fr.mayon.owner` receives all of it. Franchise AR shows invoice FAR-… at the franchise price, due in 30 days, and `franchise.coord`, `acct.head`, `head.auditor` and `admin` are notified. Receive less than was sent: the Head Auditor rules the receiver miscounted → the invoice goes up by itself and everyone (and the sales associate involved) is told. `acct.head`: **Record payment**. After the due date (set it back in the database or wait): penalty 2% and 0.1% a day appear. `fr.mayon.owner`: **Ask for extension** → `admin` decides in My Approvals; `admin` may **Waive charges** or **Put on cash-before-delivery**.

**60. Memorandums** — `admin`, `hr.staff`, `franchise.coord`, `fr.mayon.owner`, `fr.mayon.assoc`
As `admin`: Memorandums → Write a memo → franchise owners and associates, subject, text, a table → **Issue the memo**: it is numbered 2026-Q3-001 and signed by AL MARVIN VINLUAN (President) and MICAH VINLUAN (Manager). The owner and associate are notified; they open it and press **I have read this memo**. **Print / download PDF** gives the company layout.

**61. 6-Pack Card** — `sales.westave`
New Sale → add supplements → tick **6-Pack sticker given** → type the customer's name and mobile number. Do it until the number has six stickers, then 6-Pack Card → **Redeem a card** (type the number → Find → email and address → Redeem). Expenses now shows the ₱300 "6-Pack Card".

**62. Deposit slip** — `sales.westave`, `audit.assoc`, `acct.assoc`
Daily Close & Deposit → press a coloured day on the calendar → bank, **Attach deposit slip**, **Record deposit**. `audit.assoc` opens My Approvals and sees the slip beside the amount → **Slip checked** (or **Not accepted** with a reason: the branch fixes and sends it again). Then `acct.assoc` does the same.

**63. E-commerce margin and waybills** — `admin`, `ecomm.assoc`, `head.auditor`
Waybill Report → **Choose waybill PDF files** (TikTok or Shopee labels) → pick each order's product → the SRP, fees and order income appear; set the platform fee rates at the bottom. `admin`: E-com Margin Analysis shows fees, ads and the price that keeps the target margin; add ad expenses at the bottom.

64. **Sale to a franchise** (`sales.wh`): New Sale → channel FRANCHISE → pick Franchise Mayon (or any franchisee) → add a supplement and a Plastic XL. The franchise price fills in and the plastic is ₱5 (L 4, M 3, S 3, XL 5). Choose **Shipping: To follow** → Review → Save. Check: no "may not sell at tier FRANCHISE" error.
65. **Shipping to follow** (`franchise.coord`): Notifications show the tag. Franchise AR → Shipping charges billed to franchises → **Fill in the amount** (e.g. ₱350). A new invoice FAR-SHIP-… appears for the franchise (`fr.mayon.owner` sees it; Accounting, auditors and the Owner are told). Ask to change it to ₱400 with a reason → `admin` approves in My Approvals.
66. **Late shipping** : leave one "to follow" for 2 days: every day the Coordinator, Owner, auditors, Accounting and the franchise owner get a reminder.
67. **Franchise Coordinator sale**: `franchise.coord` → New Sale: only the FRANCHISE channel, AR/PDC or Online; pick the warehouse as the branch.
68. **Stores and plastics**: at a branch sell to a walk-in customer with a Plastic S: price ₱0 (free). Type a price of 2 and it becomes a sold item.

69. **Delete a draft** (`wh.incharge`): create three transfer drafts, delete the first with **Delete draft**: the other two move down one number (WH-PO / WA-TI) and the next new draft takes the last number.
70. **Marketing pull-out** (`sales.westave`): Transfers → To "Prothin Marketing" → tick Endorse to Accounting → Create draft → Submit. `head.auditor` approves in My Approvals: the stock leaves West Ave. `acct.assoc` accepts the expense. Check Marketing & BO Pull-outs.
71. **Movement forms** (`wh.incharge`): Inventory Reports → Daily Inventory Report → press a Transfer In or Pull Out figure → the forms and attachments appear.
72. **Customer replacement** (`sales.csr`): Replacement Tickets → Customer returned an item → find a DR (for example one made by `sales.westave`) → open the ticket. `sales.dasma` presses **We gave the replacement** with another product: the price difference appears; `head.auditor` approves; the branch confirms the difference was paid.
73. **Supplier replacement** (`wh.incharge`): Return items to a supplier → `head.auditor` approves → on Supplier Deliveries choose the ticket ("This delivery replaces a ticket") and receive part of the quantity (ticket stays open), then the rest (ticket closes).
74. **Users search**: as `admin` open Users & Roles and type part of a name in the search box.

75. **Outlets** (`agent.jerick`): Outlets → **+ Add an outlet** (contact person, number, email, a picture) and **Upload Excel / CSV** (press Template). They show "Waiting for approval". `sales.manager`: Outlets → Waiting for approval → Approve.
76. **Tag a sale** (`sales.westave`): New Sale → **Agent's outlet / gym**: pick Jerick Quinto, then the outlet → Review → Save. `agent.jerick` sees the order under My Sales and on the outlet; the sale shows the outlet in the Sales list.
77. **Change and remove** (`agent.jerick`): open an approved outlet → Ask for a change. `sales.manager` approves under Change requests; `admin` gets a notification showing what changed. `sales.manager` can Share an outlet with another agent, move it, or Remove it (refused with an order in the last 3 months; otherwise `admin` approves in My Approvals).
78. **Areas** (`sales.manager`): Outlets → Areas → add an area and assign an agent.
79. **Itinerary** (`agent.jerick`, best on a phone): My Itinerary → plan today's stores (or upload a Date / Outlet file) → at a store take a photo, choose the shelf check, press Visited (allow location); mark another Missed with the reason; Submit the report. `sales.manager`, `head.auditor` and `admin`: Field Monitoring shows the day with photos, times and location links.
80. **Claim** (`agent.jerick`): under the stores claim fuel ₱350 with a receipt photo. `sales.manager` approves in Field Monitoring → Fuel / transport claims; `acct.head` is told to pay.
81. **Consignment maximum** (`sales.manager`): Agent Consignments → link a consignee to Jerick's outlet → set a maximum (all outlets, and one outlet) → `admin` approves in My Approvals. A consignment out over the maximum is refused when submitted (`sales.westave` → Consignment). `agent.jerick`: Agent Consignments shows what is at the consignee and how much of the maximum is used.
82. **Warehouse expenses** (`wh.assoc` or `wh.incharge`): Expenses → choose a warehouse account → amount and payee → pay from cash on hand, a bank account or an owner advance (Cash fund is refused).
83. **Search notifications** (any user): Notifications → type a product name or DR number in the search bar.
84. **Search lists** (any user): open a list with 6+ rows (for example Chart of Accounts or Cash Fund) and type in **Search this list**. On 6-Pack Card, choose from / to and search a customer name, mobile or DR number: both lists filter.
85. **Days of stock** (`head.auditor` or `wh.incharge`): Expiry & Low Stock → the top card lists every item by days left, most critical first. Change the last 30 → 60 days; tick All locations together; type in a column's filter box (for example Level or Brand).
86. **Members at the counter** (`sales.westave`): New Sale → Wheysted member → **+ New member** (name, mobile) → sell something. Then type the number, name or phone in the same box for the next sale (a QR scanner types `WHY:…` into it).
87. **Members list** (`sales.manager`): Wheysted Members: sort by Spent, filter a column, choose a segment, open a member (QR card, favorites, purchases); **Who bought this item**; **Make members from my sales**.
88. **Member page** (a phone browser, `/member`): Become a member with a new mobile number; open **My card** (QR) and **My purchases** after the counter tags a sale; sign out and sign in again. A member made at the counter signs up with their member number to claim the account.
89. **Campaigns** (`sales.manager`): Email & SMS: choose a segment, **Count who will receive it**, type a message with {firstName}, **Prepare campaign**, **Send**. Without SMTP / Semaphore settings the result is "not configured" (nothing is sent).
90. **Profile and referral** (`sales.westave`, then a phone browser at `/member`): New Sale → + New member (add goal and gym in Wheysted Members → Edit later). On `/member` sign up a second person typing the first member's number under "Referred by". Tag a sale to the second member: both get a ₱100 voucher (Wheysted Members → open the member → Vouchers).
91. **Points and vouchers** (`sales.manager`, `sales.westave`): Wheysted Members → Program rules (set ₱ per point, tiers) → open a member → **Give voucher** ₱100. At New Sale pick the member: tap the voucher, add a supplement, Review: the total drops by ₱100. Try to use it again (refused). Void the sale (`admin`): the voucher is back.
92. **Member price** (`sales.manager`): Wheysted Members → Member prices → add an item at a lower price. At New Sale a tagged member gets that price by itself; a walk-in does not.
93. **Lost sale and back in stock** (`sales.westave`, phone): New Sale → "Customer asked for an item we didn't have". On `/member` → Shop press "tell me when available" on an out-of-stock item. Receive stock, then Program rules → **Run the automatic messages now** (message is "not configured" without SMTP / Semaphore).
94. **Reserve** (phone): `/member` → Shop → Reserve 1 for pick-up. `sales.westave` opens Member Reservations → Ready → Picked up.
95. **Rating** (phone): `/member` → Purchases → Rate this purchase → 2 stars with a comment. `sales.manager` sees a notification and a complaint note; Wheysted Members → Feedback.
96. **Insights** (`sales.manager`): Top spenders (Log a call), Insights (heat-map, capture rate), Lost sales; Expiry & Low Stock shows the "Customers asked" column.
97. **Chat campaign** (`sales.manager`): Campaigns → Win-back voucher quick start → WhatsApp → Prepare → open it → Send → "Open WhatsApp + copy message" on one row. Open the campaign later: Results show who bought and vouchers used.
98. **Promo to the branches** (`head.auditor`): Promos → Issue it to *All branches* → name, dates, description, add an item with a promo price → Issue promo and send memo. `sales.westave` sees the promo strip on the Dashboard and at New Sale, a highlighted PROMO notice and the memo; `fr.mayon.owner` sees nothing. Sell the item at New Sale without typing a price: it uses the promo price, no approval.
99. **Promo to the franchises** (`admin`): Promos → *Franchises only*. `fr.mayon.owner` sees it on the Dashboard; `sales.westave` does not. Cancel it (with a reason): everyone concerned is told.
100. **Birthday and the home store** (`sales.manager`, `sales.westave`): make a member with today's birthday and tag a sale at West Ave. Program rules → *Run the automatic messages now*: `sales.westave` gets a "Birthday today" notice; `sales.dasma` does not. On `sales.westave`'s Dashboard → Customer Service the member shows under Birthdays: press *Greeted* → record.
101. **Restock due and results** (`sales.westave`): give a product "days one unit lasts" (Products), sell it with a customer name and mobile number. Next day (or the same day for 1 day) the customer is under *Restock due*. *Record result*: Phone call → *Not buying again* → reason *Found it cheaper in another store* (a note: where and how much) → Save. Try *No answer, try again* with a date. A customer who buys it again drops off the list.
102. **Reasons** (`sales.manager`): Customer Service → *Why they do not buy again*: approached, came back, reasons, by branch, by item, by staff, what customers said. A reason such as *Not working out* also notifies the Sales Manager at once.
103. **Replacement paid online** (`sales.westave`): Replacement Tickets → open a ticket → We gave the replacement: choose the product (the price fills in), keep today as the day → `head.auditor` approves. Then *Record the payment of the difference* → Online → choose the GCash account → Save. Open Reports → Daily Sales Report: the *Replacement payments* box shows it, apart from sales.
104. **Replacement paid in cash on a past day** (`sales.westave`): give a replacement dated yesterday (a closed day) → `head.auditor` approves it; record the payment as Cash dated yesterday: it waits for the Head Auditor (My Approvals → Replacement payment on a closed day). After approval it appears in yesterday's report and cash deposit.
105. **Search boxes** (any user): in Replacement Tickets, Campaigns and Member prices pick an item: the name shows inside the box with ✕ change. At New Sale tag a member with a member price: the price box fills by itself.

## Where the files come out

All exports download through the browser: Daily Sales Report (xlsx/PDF), Daily Inventory Report (xlsx, one sheet per day plus Summary and Per-day sheets), every paper form (Pull-Out, Transfer-In, DR-Sales, Supplier's Form, Count sheet, Discrepancy Report, Charge Form, Credit Note, Journal Voucher), every list (Export xlsx / CSV buttons), Trial Balance and the financial statements.
