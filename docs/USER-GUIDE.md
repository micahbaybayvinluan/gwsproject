# GWS-ERP User Guide

This guide explains how to use GWS-ERP, the Get Wheysted Supplements system for sales, inventory, audit, HR and accounting. Inside the app, open **Help & Guide** in the menu: it shows only the parts that apply to your role, and you can type a question in the **Ask** box.

Each section below starts with a hidden line that says which roles it is for. The Help page uses it to show each person only what they can do.

## Signing in and your account
<!-- for: all -->
- Open the system in your browser (on the office Mac it is http://localhost:5173) and sign in with your username or email and your password.
- **Your first sign-in:** you set your own password (at least 10 characters), then read the accountability statement with your name and company ID, tick the box and press **I accept**. Nothing else works until you do.
- **One person per account.** Never share your password. Everything you do is recorded with your name and ID.
- **One device at a time.** If you sign in on another phone or computer, the first one is signed out and you get a notification. If you are signed out unexpectedly, someone else may be using your account: tell Admin.
- **Authenticator code.** Admin, the External Auditor, the Head Auditor and the Accounting Head may be asked for a 6-digit code from an authenticator app (Google Authenticator or Microsoft Authenticator). During testing the code is switched off.
- **Signed out after a while?** Sessions end after a period of no activity (longer for sales and franchise staff). Just sign in again.
- **Forgot your password?** Ask Admin to set a temporary one under Users & Roles. You will be asked to change it when you sign in.

## Dashboard and notifications
<!-- for: all -->
- **Dashboard** is your home page. It shows what needs your attention for your role: today's sales, open AR, approvals waiting for you, critical stock, expiring stock, cash fund balances, your charges, and alarms.
- **Red boxes need action now.** For example the weekly count sheet alarm, or the number of days left before a discrepancy is charged to you (in bold red).
- **The bell** (top right) lists your notifications: approvals you need to give, stock requests, charges, revisions of your documents, and so on. Click one to open the document.
- **Approvals** in the menu shows a badge with how many requests are waiting for you.

## Menus by role (quick start)
<!-- for: all -->
- **Sales Associate:** New Sale, Sales, AR / Credit, Expenses, Daily Close, Cash Fund, Transfers (request stock and receive), Inventory Count (weekly sheet), Discrepancies, Write-offs, Stock on Hand, My Pay & Charges.
- **Warehouse Associate / In-Charge:** Receiving, Transfers (send stock), Stock on Hand, Inventory Count, Write-offs, Expiry & Alerts.
- **Head Auditor / Asst Auditor:** Approvals, Receiving costs, Discrepancies, Inventory Count, Revision Log, Cash Fund, Store Inspections, all reports with cost.
- **Audit Associate:** branch reports with cost, correction requests (approved by the Head Auditor), Revision Log.
- **Field Auditor:** Inventory Count (audit sheets), Cash Fund (confirm the cash found), Store Inspections, Stock on Hand and expiries of every branch and franchise. No cost, no sales.
- **HR Staff:** Charge Forms, Payroll & Contributions, Weekly Count Compliance, Store Inspections, Revision Log.
- **Accounting Head / Associate:** AR approvals, Accounting menus, Inventory & Direct Cost, cash funds, payroll (the Associate sees totals only).
- **Franchise Owner / Associate:** Franchise Portal, sales and stock of their franchise.
- **Admin (Owner):** everything, including Users & Roles, Settings and final approvals.

## Help & Guide and the Ask box
<!-- for: all -->
- Open **Help & Guide** in the menu. You see only the sections for your role. Use the search box to filter them.
- Type a question in **Ask** (for example "how do I record a delivery sale?"). If the AI assistant is switched on, it answers from this guide in plain words. If not, the matching guide sections are shown instead.
- The assistant only explains how to use the system. It cannot see or change your data, and it does not know your sales or stock figures.

## Recording a sale
<!-- for: sale.create -->
1. Open **New Sale**.
2. Type the **DR / SI number** from the paper receipt.
3. Choose the **channel**: Walk in, Delivery, Shipping, Online marketplace, Prothin Dealer, Agent, Franchise.
4. Choose the **payment**: Cash, Online (GCash / bank), Credit card, or AR/PDC (on credit).
5. Search the product by name or SKU, click it, and set the quantity. The price for the channel fills in by itself.
6. Optional: customer name, **contact number** and **email** (these build the Customer Contacts list).
7. Press **Save**. The stock is deducted at once, from the batch with the earliest expiry first.
- A red "near expiry" tag means the batch expires soon; sell it first.
- Freebies and plastic bags go in at zero price.

## Online, card, delivery and shipping sales
<!-- for: sale.create -->
- **Online payment** (GCash, bank transfer): pick the receiving account and upload a photo or screenshot of the proof of payment. The sale will not save without them.
- **Credit card:** fill in the MID, slip number, approval code and batch number from the card terminal slip.
- **Delivery:** pick the rider and type the delivery fee and rider incentive.
- **Shipping / marketplace:** type the shipping fee charged, the shipping expense and marketplace charges.

## Special prices (below the list price)
<!-- for: sale.create, approval.act.SPECIAL_PRICE -->
- You can sell below the price for the channel. The sale saves, and Admin gets a **Special price** approval.
- Admin sees the list price, the price sold, the discount and the margin, then approves or rejects. A rejected special price is reported to the auditors.

## Voiding or correcting a sale
<!-- for: sale.create, sale.edit.sameday, sale.void -->
- **Same day:** open the sale, type the reason, press **Void sale**. The stock goes back.
- **After the day is closed** (every day closes at midnight Manila time): the void is refused. Press **Request post-close void**. Both the Head Auditor and the Asst Auditor must approve before anything changes.
- Every void and correction is recorded with your name.

## Customer contacts
<!-- for: report.sales.own, report.sales.all -->
- **Reports → Customer Contacts** lists customers with their contact number and email from the sales, with the number of purchases and the last purchase date.
- Filter by dates or branch and press **Export** for an Excel file.

## AR / credit sales and collecting payments
<!-- for: ar.view, ar.collect, ar.approve -->
- A sale with payment **AR/PDC** needs a customer (dealer, agent or franchise) and a due date. For a post-dated cheque, type the bank, cheque number and cheque date.
- **AR / Credit** lists open invoices with the balance and how many days overdue. Tick **Overdue only** to filter.
- **Recording a payment:** tick the invoice(s) of one customer, type the amount (and a discount if any), choose Cash / Online / Card, then press the button.
  - **Branch staff:** the payment is sent to the Accounting Associate or Accounting Head for approval. It shows "Waiting for Accounting" until approved; the invoice balance drops after approval.
  - **Accounting:** the payment applies at once, a Credit Note number is issued and the branch is notified.
- Each payment shows who entered it. Download the Credit Note as PDF from the register.

## Branch expenses
<!-- for: expense.create.branch, expense.create.main -->
1. Open **Expenses**.
2. Choose the account. Only your branch's expense accounts are listed (for example "Meralco - West Ave").
3. Type the amount and payee, and choose where the money came from: **Cash drawer** or **Cash fund**.
4. Save. Your expense gets a number like WA-EX-000001.
- Direct cost accounts are not available to branch staff. Only the Accounting Associate and Accounting Head can use them; direct cost is generated from sales automatically.
- Cash-drawer expenses reduce the cash for deposit in the Daily Close.

## Cash fund
<!-- for: cashfund.use, cashfund.view.all, cashfund.manage, cashfund.check -->
- Each branch keeps a fixed cash fund (for example ₱5,000) for small expenses.
- **Paying from the fund:** in Expenses choose **Cash fund**. The fund balance goes down.
- **Replenishing:** open **Cash Fund** and press **Replenish from today's cash sales**. The amount spent is taken from today's cash for deposit (the Daily Close and the Daily Sales Report show it) and the fund is full again. A Cash Fund Replenishment voucher is created.
- **Field Auditor:** open Cash Fund, pick the branch, type the cash actually found and press **Confirm count**. If it differs, type the reason. The difference is shown to Admin and the auditors.
- **Admin / Accounting Head:** set up or change a branch's fund amount at the bottom of the page.
- Balances of every branch fund appear on the dashboards of Admin, the auditors and Accounting.

## Daily close, cash count and bank deposit
<!-- for: sale.create, report.sales.own, report.sales.all -->
- **Daily Close** shows today's cash sales, cash collections, cash expenses, cash fund replenishment and the **expected cash**.
- Count the cash in the drawer and type how many of each bill and coin under **Money Breakdown**, then **Save cash count**. The variance shows at once (red if short).
- Record the **bank deposit** with the amount, bank account and date.
- The day closes by itself at midnight Manila time. After that, changes need approval.
- **Cash shortages:** HR or the Head Auditor can charge a shortage to the staff on duty from the **Cash shortages** list on the same page.

## Daily Sales Report
<!-- for: report.sales.own, report.sales.all -->
- **Reports → Daily Sales Report**, or the buttons on Daily Close: choose the branch and date, then **xlsx** (the same layout as the paper Sales Report) or **PDF**.
- Branch staff get the report without cost. Admin, the auditors and Accounting can switch on the audit view with cost of sales.

## Requesting stock from the warehouse (branch)
<!-- for: transfer.confirm -->
1. Open **Transfers**.
2. In **Request stock from the warehouse**, add the products and quantities, and a note if needed.
3. Press **Send request to the warehouse**. The warehouse is notified and prepares the transfer.
- You do not make the transfer form. When the warehouse submits it, it appears under Transfers as incoming, and you receive it.

## Receiving a transfer at your branch
<!-- for: transfer.confirm -->
1. Open **Transfers** and click the incoming transfer (View: Incoming).
2. Print your copy with **Transfer-In copy** if you need paper.
3. Check the items. Tick each line that arrived complete, or **Tick all** if everything is right.
4. For a line that is short, leave it unticked, type the quantity actually received and a note.
5. Press **Confirm receipt**. The stock is added to your branch. A shortfall goes to the Head Auditor to resolve.

## Pull-outs and returns from a branch
<!-- for: transfer.create -->
- **Transfers → Pull-out from [your branch]**: "From" is always your own branch. Choose where it goes (**To**), the type (Return, Replacement, Internal…), the return reason if it is a return, and the items.
- **Create draft**, check it (you can print the draft), then **Submit for approval**. Internal transfers are approved by the Head Auditor or the Asst Auditor; transfers to a franchise by Admin.
- Every transfer is numbered like WA-PO-000003 (pull-out) and the receiver's copy like WA-TI-000003.

## Warehouse: receiving supplier deliveries
<!-- for: receiving.create -->
1. **Receiving → New receiving**: choose the supplier and type the supplier's invoice or DR reference.
2. Add each product with the quantity, free quantity, **expiry date** and batch number.
3. **Same item, different expiry dates:** press **+ another expiry** on the line and enter the quantity for each date. Each date becomes its own batch and is shown everywhere the item appears.
4. **Create draft**, upload a photo of the supplier invoice, then **Submit for cost approval**.
- Warehouse staff do not see or enter costs. The Head Auditor types or confirms the cost and approves. If every cost is unchanged from the last delivery, it is approved automatically after 24 hours.
- The stock is added to the warehouse when approved.

## Warehouse: sending stock
<!-- for: receiving.create -->
1. **Transfers → Send stock from the warehouse.** "From" is the warehouse. Choose **To**: any branch, franchise or consignee. A branch's stock request fills this in when you open it from the notification.
2. Add the items and quantities. The system picks the batches with the earliest expiry first.
3. **Create draft**. You can **Print Pull-Out (draft)** and **Edit draft** until it is right.
4. **Submit for approval.** Company branches: the Head Auditor or Asst Auditor approves. Franchises: Admin approves.
- The receiving branch sees the transfer only after you submit it.

## Warehouse In-Charge: correcting an associate's entry
<!-- for: receiving.create -->
- The In-Charge enters receivings and transfers the same way as the associate.
- To change a document someone else prepared (draft or waiting for approval), open it and press **Propose edit**. The change is sent to the preparer, who must **Accept** it before it applies. A submitted document then goes back through approval.
- Every accepted correction is recorded in the Revision Log against the preparer.

## Stock on hand and expiry dates
<!-- for: report.inventory.own, report.inventory.all -->
- **Stock on Hand** shows the quantity per product and location, the nearest expiry, and the **quantity per expiry date**. An item with more than one date is marked, so you can see the difference.
- The **Batches** table lists every batch with its expiry, in the order it will be sold (earliest first).
- **Inventory Reports → Daily Inventory Report** gives beginning, received, transfers in and out, sales, adjustments and ending per day. Staff see quantities only; Admin, the auditors and Accounting also see cost.

## Expiry and alerts
<!-- for: report.inventory.own, report.inventory.all -->
- **Expiry & Alerts** groups stock into expired, less than 1 month, 1–3 months and 3–6 months, lists critical stock (below the minimum) and slow-moving items.
- Notifications about expiring and critical stock arrive in the bell every night.

## Weekly count sheet (sales associates)
<!-- for: count.create -->
- Every sales associate submits one count sheet each week (Monday to Sunday). Until you do, a red alarm shows on your dashboard.
1. Press **Start my weekly count** on the dashboard (or Inventory Count → Start my weekly count sheet).
2. Every item is already listed with today's beginning count. Type only the **actual count** you see.
3. **Save actuals** as you go, then **Submit count**. The Head Auditor, Asst Auditor and Audit Associate are notified. HR can see who did and did not submit.
- After submitting, the sheet is locked. If you made a mistake, use **Correct this count…**: the Head Auditor approves the change.

## Audit count (auditors and Field Auditor)
<!-- for: discrepancy.resolve, cashfund.check, revision.request -->
1. **Inventory Count → Start an audit count**: choose the branch or franchise you are auditing and press **Create count sheet**.
2. Every item is filled in with the start-of-day beginning count and the expected quantity now. Type only the **actual count**. The difference is computed for you, and the expiry dates on hand are shown.
3. **Submit count**. The sheet is locked. Any difference opens a discrepancy case and the people concerned are notified.
- **Revisions:** press **Correct this count…**, type the corrected numbers and the reason. Only the Head Auditor can approve, and Admin is notified. The revision is logged.
- You can also download the sheet as Excel, fill it offline and upload it.

## Discrepancy cases, countdown and explanations
<!-- for: discrepancy.view, discrepancy.resolve, discrepancy.explain, count.create -->
- A count with a shortage opens a **discrepancy case** (number like WA-DC-000001) with a 7-day deadline.
- **Branch staff** see on their dashboard, in bold red, how many days are left before the shortage is charged to them.
- **Explaining:** open the case (Discrepancies) and use **Explain this discrepancy**. HR is notified and the Head Auditor decides. If accepted, the difference is adjusted and nobody is charged.
- **Head Auditor:** mark it resolved after a new matching count, or accept the variance as an adjustment.
- At the deadline, an unresolved shortage becomes a **Charge Form** at franchise price, sent to HR.

## Write-offs: expired and damaged items
<!-- for: writeoff.create, writeoff.approve -->
1. **Write-offs**: add the expired or damaged items and the reason.
2. Choose **Expensed by the company** or **Charged to staff** (tick who). A staff charge is split equally.
3. Submit. The Head Auditor approves. The items leave the inventory either way.
- A staff charge creates a Charge Form automatically. It appears in HR's Charge Forms and in the staff member's **My Pay & Charges**.

## Store inspection report
<!-- for: inspection.create, inspection.view, inspection.review -->
- **Field Auditor:** **Store Inspections → New**, choose the branch and the staff on duty, then fill the 19 checklist items from the paper form: store cleanliness, stock display, permits (Business Permit, FDA, BIR COR, Barangay Clearance, BIR 0605, IPO), columnar, alterations, sales deposit, cash fund, actual stocks vs system, products not carried by GWS or not from the main branch, near expiry, clumped stocks, cleanliness of stocks, daily manual inventory (GSheet and hard copy), uniform, ID / name plate, product knowledge and monthly monitoring. Add comments and press **Submit to HR**.
- HR, Admin and the Head Auditor are notified. The staff on duty acknowledges the report. HR reviews it.
- Download the report as PDF from the report page.

## Approvals
<!-- for: approval.act.COST_ON_RECEIVING, approval.act.TRANSFER_INTERNAL, approval.act.TRANSFER_TO_FRANCHISE, approval.act.SPECIAL_PRICE, approval.act.POST_CLOSE_EDIT, approval.act.WRITEOFF, approval.act.PRICE_CHANGE, approval.act.DISCREPANCY_RESOLUTION, approval.act.PERIOD_LOCK, approval.act.COUNT_REVISION, approval.act.AR_PAYMENT, approval.act.DISCREPANCY_EXPLANATION, approval.act.AUDIT_REVISION, approval.act.WAREHOUSE_EDIT, approval.act.MASTER_DATA_NEW, approval.act.WAREHOUSE_IN, approval.act.WAREHOUSE_OUT -->
- **Approvals** lists everything waiting for you, grouped by kind. Click a row to see the details, then **Approve** or **Reject** (add a note if needed). Tick several and use **Approve selected** to do many at once.
- Who approves what:
  - Receiving cost: Head Auditor (auto after 24 hours if the cost is unchanged).
  - Transfer between company locations: Head Auditor **or** Asst Auditor.
  - Transfer to a franchise, special price, price change, period lock: Admin.
  - Post-close edit of a company branch: Head Auditor **and** Asst Auditor (both).
  - Write-off, discrepancy resolution, count revision, discrepancy explanation, Audit Associate correction: Head Auditor.
  - AR payment entered by a branch: Accounting Associate **or** Accounting Head.
  - Warehouse edit: the person who prepared the document.
  - New product, supplier, category, customer, agent, rider, branch, account, employee, user account or import file: Admin (Owner).
  - Stock in or out of the warehouse entered by a Warehouse Associate: the Warehouse In-Charge (after the Head Auditor approves the cost for items received).
- Each document that needs approval shows a **workflow bar**: every step, who must approve it, and who already did. With two or more approvers you can see that one has approved and the other has not yet.

## Approval workflow and your requests
<!-- for: all -->
- Every document that needs approval (sale with special price, transfer, receiving, count, discrepancy case and others) shows a coloured **workflow bar** at the top: green steps are approved, amber steps are waiting, red is rejected, grey was cancelled.
- Each step names who must approve it (for example "Head Auditor" or "Head Auditor and Asst Auditor") and, once approved, who did it and when.
- The dashboard card **My requests** lists what you sent and where each one stands. You are notified each time one of your approvers acts, not only at the end.

## New products, suppliers and other main records (Owner approval)
<!-- for: product.create, employee.manage, user.manage, supplier.view.name -->
- A new product, supplier, category, customer, agent, rider, branch, account, employee or user account entered by anyone except Admin is **waiting for the Owner**. The list shows it under "Waiting for Owner approval" and it cannot be used yet.
- Admin sees it under **Approvals → New master data (Owner approves)**, checks the details and approves or rejects. On approval it is created and the person who entered it is notified.
- Imports of product, employee and similar files work the same way: the file waits for Admin, then loads on approval.
- Admin's own entries are created at once.

## Editing and deleting products and back-office data
<!-- for: product.create, master.delete -->
- Only Admin (Owner) can delete products, suppliers, customers, agents, riders, categories and branches, and only Admin can edit branches and other back-office records.
- The Head Auditor and Admin can edit products and suppliers.
- A record that is already used in sales, transfers or other documents cannot be removed; it is **archived** instead (hidden from new forms, history kept).

## Price update notices
<!-- for: all -->
- When a selling price changes (price change, new product), the dashboard card **Price updates** shows it, but only for the prices that apply to you. A franchise sees only its franchise price.
- Changes in supplier **cost** are shown only to the Owner, the Head Auditor, the External Auditor and the Accounting Head.

## HR: new employees and their user accounts
<!-- for: employee.manage -->
- **Payroll & Contributions → Employees → Add employee:** the employee waits for Owner approval before payroll can use it.
- Open an approved employee and press **Create user account…**: username, role, temporary password and branch. The account waits for the Owner (or Admin). The person signs in once it is approved.
- HR cannot create Admin or External Auditor accounts, and has no access to franchise staff or franchise payroll.

## Warehouse: In-Charge approval of stock in and out
<!-- for: approval.act.WAREHOUSE_IN, approval.act.WAREHOUSE_OUT, receiving.create -->
- Stock that a **Warehouse Associate** receives (supplier deliveries, transfers in) or sends out (transfers, pull-outs) is not counted until the **Warehouse In-Charge** approves it.
- For supplier deliveries the Head Auditor approves the cost first, then the In-Charge approves the receipt. The page shows "Cost approved · waiting for the In-Charge".
- When the In-Charge enters the document personally, only the Head Auditor's cost approval is needed.
- Sales from the warehouse do not need In-Charge approval.
- Quantities on transfers and receivings can never be negative. Negative figures appear only in discrepancy results and pay computations.

## Franchise owner: staff pay, charges and books
<!-- for: franchise.portal -->
- **Franchise Portal → Overview:** choose whether your franchise associate may receive stock from GWS. If yes, the associate confirms deliveries and you are notified. If no, only you can confirm. The associate never sees franchise cost.
- **Staff pay & charges:** record your associates' salaries. Each salary is a franchise expense, visible only to you; each associate sees only their own pay under **My Pay & Charges**. Create charges for your own staff and branch here. GWS HR has no access to them.
- **Income statement & balance sheet:** generate them for your branch only, separate from the other GWS branches.

## Bank & Office (Executive Assistant)
<!-- for: bank.entry -->
- **Bank & Office → Bank entries:** choose the bank account, the book (advances to, advances from, supplier payables, office expense, receivables, fixed asset, equity or bank transfer), the account, the amount and the description, then save. A journal voucher is posted.
- **Supplier payables** lists unpaid supplier bills (amounts only, no product cost). **Office expenses** lists main-office expenses.
- **Balance sheet accounts** shows the balance of each balance sheet account. Branch reports, cost, income and other reports are not available to this role.

## Accounting: editing journal entries
<!-- for: gl.voucher.edit -->
- The Accounting Head and the Accounting Associate can open a journal voucher and press **Edit entry** to change the lines. Debits and credits must balance, amounts cannot be negative, and the period must be open.
- The person who made the voucher, the person who made its source document, and Admin (Owner) are notified. Every change is kept in the Revision Log.

## Company letterhead and logo (Admin)
<!-- for: user.manage -->
- **Settings → Company letterhead:** type the company name, address, contact and TIN, then upload the logo (PNG, JPG, WEBP or SVG, up to 2 MB).
- Use the **Remove the background** slider to cut away a plain background around the logo; the checkered preview shows the result; press **Use this logo** to save it.
- The logo and details appear at the top of every printed form and PDF, on the sign-in page and in the menu.

## Corrections by the Audit Associate and the Revision Log
<!-- for: revision.request, revision.view -->
- **Audit Associate:** open the sale or transfer with the error and use **Request a correction**: choose what to correct, type the new value (or choose to void) and the error found, then **Send to the Head Auditor**. The staff member who made the document is notified at once.
- Only the Head Auditor can approve. Nothing changes until then.
- **Revision Log** (HR, auditors, Admin): every approved correction, with who made the document, who asked, who approved, the reason and the change. The **Errors per staff** table counts corrections per person for the chosen dates; three or more are shown in red. Click a name to see that person's corrections. Export to Excel.

## Your charges and pay (My Pay & Charges)
<!-- for: all -->
- **My Pay & Charges** shows only your own charges, loans or advances and payslips.
- When you are charged (cash shortage, damaged or expired items, inventory discrepancy), you are notified. Open it and press **Acknowledge** to confirm you have seen it.
- The amount is deducted from your pay over the number of pay periods HR set. Nobody else except HR, the External Auditor, the Accounting Head and Admin can see who was charged.

## HR: charge forms
<!-- for: charge_form.finalize -->
- **Charge Forms** lists every charge: discrepancy, expired, damaged, cash shortage and other. Most are created automatically (from discrepancies, write-offs charged to staff, and cash shortages).
- **New charge form:** choose the kind, the branch and the reason, add what is charged (description, quantity, amount), tick the staff, then **Create charge form**. The amount is split equally.
- Open a form to change the split between staff, set the number of pay periods, and **Finalize**. Payroll then deducts it.
- Print the **Charge Form** and the **Salary Deduction Authorization** from the form. No uploads are needed.
- The Acknowledged column shows which staff have confirmed their charge.

## HR: payroll and government contributions
<!-- for: payroll.view.summary, payroll.view.detail, payroll.edit, contribution.remit -->
- **Payroll & Contributions → Employees:** add each employee with their rate and branch, and link them to their user account so charges reach them.
- **Create run** for a period. It fills in basic pay, SSS, PhilHealth and Pag-IBIG (employee and employer shares from the tables), loans and charge-form deductions. Edit overtime and incentives, then **Finalize**. The Accounting Head picks the paying bank account and closes the run.
- **Contributions register:** SSS, PhilHealth and Pag-IBIG per employee per month, with **Register xlsx**. Record each payment to the agency with **Record payment**.
- Print payslips and each employee's ledger from the run.
- Names and amounts per person are visible only to HR, the External Auditor, the Accounting Head and Admin. The Accounting Associate sees totals only.

## HR: weekly count compliance
<!-- for: employee.manage, discrepancy.resolve -->
- **Weekly Count Compliance** shows, for each sales associate, which weeks they submitted a count sheet and which they missed. The dashboard shows who missed last week.

## Products, prices and price changes
<!-- for: product.view, price.edit -->
- **Products** lists every product with its SKU, category and prices per channel. Staff see selling prices only.
- **Price Changes:** Admin prepares a new price list with an effective date; it takes effect after approval.
- Minimum stock levels per branch (for critical-stock alerts) are loaded by Admin under **Imports** (minimum stock file).

## Suppliers and imports
<!-- for: supplier.view.code, product.create, settings.thresholds -->
- **Suppliers** are shown by code to warehouse staff; Admin and the auditors see names.
- **Imports** loads products, the chart of accounts, opening balances and minimum stock levels from the company Excel files.

## Consignment
<!-- for: consignment.manage -->
- **Consignment** records stock placed with consignees (goods out) and consigned stock received (goods in), their sale reports and settlements.

## Franchise portal
<!-- for: franchise.portal -->
- **Franchise Portal** shows the franchise's stock, incoming transfers, today's sales, the amount owed to GWS and the franchise's own profit and loss.
- The franchise associate confirms incoming transfers and records sales, but cannot change prices.

## Accounting
<!-- for: gl.view -->
- **Chart of Accounts**, **Journal Vouchers** (every posted entry, with a link to its source document), **Trial Balance**, and **Periods & Opening** (beginning balances and period locks).
- When automatic posting is switched on (Settings), sales, expenses, transfers, receivings, charges, cash fund movements, payroll and remittances post journal vouchers by themselves.
- **Inventory & Direct Cost:** inventory cost movements per day or per month (beginning, received, transfers in, pull-outs, direct cost of sales, ending) and direct cost generated from sales, per branch, with Excel export.
- Locking a period: the Accounting Head requests it and Admin approves.

## Financial statements
<!-- for: fs.income_statement, fs.balance_sheet -->
- **Financial Statements:** Income Statement, Balance Sheet, net income per branch and Cash Flow, for the chosen period. Only Admin and the External Auditor can open them.

## Users, audit log and settings (Admin)
<!-- for: user.manage, audit_log.view, settings.thresholds -->
- **Users & Roles → New user:** full name, company ID (required), role, temporary password and branch. The person sets their own password and accepts the statement at first sign-in.
- Click a user to change the role or branches, tick extra permissions for a custom role, switch the account off, or reset the password. **Activity** opens everything the person did.
- **Audit Log** records every action with the person, time and details.
- **Settings** holds thresholds (discrepancy days, alert levels, automatic posting and others).

## Form numbers
<!-- for: all -->
- Every form number starts with the branch code, then the form code, then the number. Example: **WA-DR-000123** is a West Ave sale.
- Form codes: DR sale, CN credit note, EX expense, PO pull-out, TI transfer-in, RC receiving, IC inventory count, DC discrepancy case, CF charge form, WO write-off, FR cash fund replenishment, SI store inspection, PC price change.
- Branch codes include WH Warehouse, WA West Ave, CS CSR, IM Imus, LG Laguna, DS Dasmariñas, VC Vito Cruz, MY Mayon, ML Malolos. Company-wide forms use HO.

## Who can see supplier cost
<!-- for: all -->
- Only Admin (Owner), the Head Auditor, the Asst Auditor, the Audit Associate, the External Auditor, the Accounting Head and the Accounting Associate see what GWS pays suppliers.
- Everyone else, including sales and warehouse staff, HR, the Field Auditor and franchises, never sees supplier cost. Those fields are removed before the page is sent.

## Troubleshooting
<!-- for: all -->
- **"Invalid credentials":** check the username and password (capital letters count). Ask Admin to reset your password.
- **Asked for a 6-digit code you do not have:** ask Admin. During testing the code can be switched off.
- **A page says you do not have access (403):** your role does not include that screen. Ask Admin if you need it.
- **"The day is closed":** use the post-close request instead of editing directly.
- **A sale will not save:** online and card sales need the payment account and proof; AR sales need a customer and due date; each product needs stock.
- **The whole app does not open (office Mac):** make sure Docker Desktop is running and the `pnpm dev` window is open. In a second Terminal window, in the gws-erp folder, run `pnpm login-check` and follow the fixes it shows.
