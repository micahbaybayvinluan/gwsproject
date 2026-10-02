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
- **Sales Associate:** New Sale, Sales List, AR & Collections, Expenses, Daily Close & Deposit, Cash on Hand, Petty Cash Fund, Transfers & Pull-outs (request stock and receive), Stock Counts (weekly sheet), Count Discrepancies, Stock on Hand, Daily Sales Report, My Pay & Charges.
- **Warehouse Associate / In-Charge:** Receiving, Transfers (send stock), Stock on Hand, Inventory Count, Write-offs, Expiry & Alerts.
- **Head Auditor / Asst Auditor:** Approvals, Receiving costs, Discrepancies, Inventory Count, Revision Log, Cash Fund, Store Inspections, all reports with cost.
- **Audit Associate:** branch reports with cost, correction requests (approved by the Head Auditor), Revision Log.
- **Field Auditor:** Inventory Count (audit sheets), Cash Fund (confirm the cash found), Store Inspections, Stock on Hand and expiries of every branch and franchise. No cost, no sales.
- **HR Staff:** Staff Charges, Payroll, Weekly Count Check, HR Notices (NTE), Agent Incentives (release forms), Store Inspections, Revision Log.
- **Accounting Head / Associate:** AR approvals, opening AR entry, Agent Incentives (release tagging), Accounting menus, Inventory Cost, cash funds, payroll (the Associate sees totals only).
- **Sales Manager:** Sales Targets, Agent Incentives, Sales Report and Graphs, AR of dealers, franchises and agents. No cost.
- **Agent:** My Sales and Agent Incentives: own sales at every branch, target and incentive. No cost.
- **E-comm Associate:** E-commerce (TikTok, Shopee, Lazada).
- **Executive Assistant:** Bank & Office.
- **Franchise Owner / Associate:** Franchise Portal, sales and stock of their franchise.
- **Admin (Owner):** everything, including Users & Roles, Settings and final approvals.

## Help & Guide and the Ask box
<!-- for: all -->
- Open **Help & Guide** in the menu. You see only the sections for your role. Use the search box to filter them.
- Type a question in **Ask** (for example "how do I record a delivery sale?"). If the AI assistant is switched on, it answers from this guide in plain words. If not, the matching guide sections are shown instead.
- The assistant only explains how to use the system. It cannot see or change your data, and it does not know your sales or stock figures.

- **Picture guide (screenshots)** (button at the top of Help & Guide): each process with screenshots, numbered red boxes on where to click and the matching steps; it has a printable PDF.

## Recording a sale
<!-- for: sale.create -->
1. Open **New Sale**.
2. Type the **DR / SI number** from the paper receipt.
3. Choose the **channel**: Walk in, Delivery, Shipping, Online marketplace, Prothin Dealer, Agent, Franchise.
4. Choose the **payment**: Cash, Online (GCash / bank), Credit card, or AR/PDC (on credit).
5. Search the product by name or SKU and click it. Only items your branch has on hand are listed, with the quantity. If the item comes in more than one **flavor or expiry date**, a list opens: choose the one you are selling. Then set the quantity. The price for the channel fills in by itself.
6. Optional: customer name, **contact number** and **email** (these build the Customer Contacts list).
7. Press **Review sale**, check every detail on the review screen, then **Confirm and save sale** (or **Go back and edit**). The stock is deducted at once, from the flavor / expiry you chose.
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
- A sale with payment **AR/PDC** needs a customer and a due date. Choose **Dealer**, **Franchisee**, **Agent** or **Other customer** first: only that kind is listed (a Dealer or Franchise sale lists only dealers or franchisees).
- Tick **There is a PDC** only when a post-dated cheque was given; then type the bank, cheque number and cheque date. Not ticked = no PDC.
- **Reminders:** every morning the branch (and the sales associate who made the sale), the auditors and the Owner get the list of receivables overdue or due within 7 days, nearest due first. The dashboard shows the same list.
- **AR / Credit** lists open invoices with the balance and how many days overdue. Tick **Overdue only** to filter.
- **AR per branch:** the table at the top totals each branch's open and overdue balance. Choose a branch (or press **Show this branch**) to list only its invoices; **All branches** shows everything.
- **Recording a payment:** tick the invoice(s) of one customer, type the amount (and a discount if any), choose Cash / Online / Card, then press the button.
  - **Branch staff:** the payment is sent to the Accounting Associate or Accounting Head for approval. It shows "Waiting for Accounting" until approved; the invoice balance drops after approval.
  - **Accounting:** the payment applies at once, a Credit Note number is issued and the branch is notified.
  - **Approving a branch's payment (Accounting):** My Approvals shows the customer, amount, how it was paid, the account it was deposited to, the invoices and the proof picture. **Reject** asks for the reason (wrong amount, wrong proof, money not received, …), which the branch sees.
- Each payment shows who entered it. Download the Credit Note as PDF from the register.

## Branch expenses
<!-- for: expense.create.branch, expense.create.main -->
1. Open **Expenses**.
2. Choose the account. Only your branch's expense accounts are listed (for example "Meralco - West Ave").
3. Type the amount and payee, and choose where the money came from: **Cash on hand** (sales cash not yet deposited; it cannot be more than the branch has, a notice pops up) or **Cash fund**.
4. Save. Your expense gets a number like WA-EX-000001.
- **Warehouse Associate and In-Charge** also record the warehouse's expenses here. The warehouse has no cash fund, so choose cash on hand, a bank account or an owner advance.
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
- The day closes when the branch **submits its Daily Sales Report**, or by itself at midnight Manila time. After that, changes need approval (post-close edit).
- Record every deposit for the **sales day it covers**. Cash not yet deposited shows under **Cash on Hand**.
- **Cash shortages:** HR or the Head Auditor can charge a shortage to the staff on duty from the **Cash shortages** list on the same page.

## Daily Sales Report
<!-- for: report.sales.own, report.sales.all -->
- **Reports → Daily Sales Report**, or the buttons on Daily Close: choose the branch and date, then **Review report (Excel)** (the same layout as the paper Sales Report) or **Review report (PDF)**.
- Branch staff get the report without cost. Admin, the auditors and Accounting can switch on the audit view with cost of sales.
- Every sale is counted once. Cash subtotal plus online, card and shipping equals all sales of the day except AR / PDC.
- **Credit Card** shows the number of card transactions and the products sold on card; card sales are counted in "Number of products".
- **Online & card payments by account** shows where the non-cash money went (each bank, **Gcash (GWS)**, card and platform account). The Excel file has it on the **PAYMENT ACCOUNTS** sheet.

## Submitting today's Daily Sales Report (branch staff)
<!-- for: sale.create -->
1. Before 8 PM, open **Daily Sales Report** (the dashboard reminds you) and review every detail: on screen, or in **Review report (Excel / PDF)**. Compare it with your DR/SI slips, card slips, receipts and the cash you counted.
2. Press **Submit today's report…**, tick the four review items (sales, card and online payments, expenses, money breakdown), tick **"I acknowledge that this Daily Sales Report is true and correct"** and press **I agree — submit**.
3. Today is then closed for your branch. Any later change follows the revision protocol: a post-close edit approved by the auditors.
- You are reminded at 7:30 PM. A report not submitted by 9 PM is submitted automatically **as it stands**, and the Head Auditor, Asst Auditor, Audit Associate and HR are notified.

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
5. An item that arrived but is not on the form: **+ An item arrived that is not on the form**, pick it and type the quantity.
6. Press **Confirm receipt**. What you received is added to your branch.

## When the received quantity is different from the form
<!-- for: transfer.confirm, transfer.create, transfer.resolve_discrepancy, hr.notice -->
1. The receiving branch receives what arrived; the rest waits "in transit" and is in no branch's count.
2. **Head Auditor** reviews first: confirms the difference, or finds the receiver miscounted (the receiver then gets the items as on the form).
3. **Sending branch** agrees or disagrees within **2 days** (reminder after 1 day). No answer or disagreement → the **Owner** decides: difference stands, received after all, lost (company expense) or lost and charged to staff.
4. A confirmed difference creates an adjustment form with the same number plus **-002** (missing items back to the sender) and **-003** for items received that were not on the form. The original form never changes. The transfer page shows each step, who decided and the adjustment forms.
5. **HR** gets a notice for every case with the person answerable and their number of cases in 30 days; from the third, HR is advised to **Refer to the Owner**.

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
4. **Upload Supplier Delivery Receipt** (photo or PDF), **Create draft**, then **Submit**.
- A Warehouse Associate's delivery goes to the **Warehouse In-Charge** first (checks the goods), then to the **Head Auditor** (cost).
- Warehouse staff do not see or enter costs. The Head Auditor types or confirms the cost and approves. If every cost is unchanged from the last delivery, it is approved automatically after 24 hours.
- The stock is added to the warehouse when the Head Auditor approves (the last step).
- **Upload Supplier Delivery Receipt** (on the new delivery form): a photo or PDF of the supplier's DR / invoice, saved with the delivery.

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
- **Days of stock left** (top of the page): for each item, how many days it will last at its **average daily sales** (choose the last 14, 30, 60 or 90 days). The **most critical items are first**: **Out** (no stock but still selling), then **Critical** (7 days or less), **Low** (8–14), **Watch** (15–30) and **Enough** (over 30); items with stock and no sales are last. Each line also shows the date it runs out and how many to restock to cover 14–60 days, and what the warehouse has. Tick **All locations together** for the company-wide days. Sales less returns are counted (the warehouse also counts its e-commerce pull-outs); per location only sales recorded at that location count.
- **Search:** every list on this page has the search box above it and a small **filter** under each column title (SKU, Product, Brand, Location, Level…); type in one or more and the rows narrow down. Export xlsx / CSV exports what is shown.

## Weekly count sheet (sales associates)
<!-- for: count.create -->
- Every sales associate submits one count sheet each week (Monday to Sunday). Until you do, a red alarm shows on your dashboard.
1. Press **Start my weekly count** on the dashboard (or Inventory Count → Start my weekly count sheet).
2. Every item is listed:
   - first the items the system has at your branch, with today's beginning count;
   - then the items **not in the system** (for stock that was never transferred in the system).
   Type the **actual count** for the first group. In the second group, type only what you find; blank means none.
   - Each line also shows the day's movements after the beginning count: **+ Received**, **+ Transfer in**, **+ Returns**, **− Sales** (entered today), **− Transfer out**, **± Other** (write-offs, tasting, adjustments), then **Expected now**. Beginning + in − out ± other = Expected; compare it with what you count.
3. **Save actuals** as you go, then **Submit count**. HR can see who did and did not submit.
4. If anything differs, a **discrepancy case** opens. You, the Head Auditor, Asst Auditor, Audit Associate, the Owner and HR are notified, and you have 7 days to explain.
- **Excel:** **Download sheet (xlsx)**, type the counts in the "Actual count" column, and **Upload filled sheet**. The items come in the same order.
- After submitting, the sheet is locked. If you made a mistake, use **Correct this count…**: the Head Auditor approves the change.

## Audit count (auditors and Field Auditor)
<!-- for: discrepancy.resolve, cashfund.check, revision.request -->
1. **Inventory Count → Start an audit count**: choose the branch or franchise you are auditing and press **Create count sheet**.
2. Every item is listed: first those the system has at that location (with the start-of-day beginning count and the expected quantity now), then those not in the system. Type the **actual count**; in the second group, only what you find. The difference is computed for you, and the expiry dates on hand are shown.
3. **Submit count**. The sheet is locked. Any difference opens a discrepancy case. The branch staff, the auditors, the Owner and HR (company branches) are notified.
- **Revisions:** press **Correct this count…**, type the corrected numbers and the reason. Only the Head Auditor can approve, and Admin is notified. The revision is logged.
- You can also download the sheet as Excel, fill it offline and upload it.

## Discrepancy cases, countdown and explanations
<!-- for: discrepancy.view, discrepancy.resolve, discrepancy.explain, count.create -->
- A count with a shortage opens a **discrepancy case** (number like WA-DC-000001) with a 7-day deadline.
- **Branch staff** see on their dashboard, in bold red, how many days are left before the shortage is charged to them.
- **Explaining:** open the case (Discrepancies) and use **Explain this discrepancy**. HR is notified and the Head Auditor decides. If accepted, the difference is adjusted and nobody is charged.
- **Head Auditor:** mark it resolved after a new matching count, or accept the variance as an adjustment.
- At the deadline, a shortage with **no explanation** (or a rejected one) becomes a **Charge Form** at franchise price, sent to HR. An explanation still waiting for the Head Auditor holds the charge until it is decided.

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
  - Stock in or out of the warehouse entered by a Warehouse Associate: the Warehouse In-Charge. For supplier deliveries the In-Charge checks the goods first, then the Head Auditor approves the cost.
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
- Open an approved employee and press **Create user account…**: username (no spaces), role, branch and a temporary password (**Generate** makes one). Email is optional. The account waits for the Owner (or Admin). The person signs in once it is approved.
- HR cannot create Admin or External Auditor accounts, and has no access to franchise staff or franchise payroll.

## Warehouse: In-Charge approval of stock in and out
<!-- for: approval.act.WAREHOUSE_IN, approval.act.WAREHOUSE_OUT, receiving.create -->
- Stock that a **Warehouse Associate** receives (supplier deliveries, transfers in) or sends out (transfers, pull-outs) is not counted until the **Warehouse In-Charge** approves it.
- For supplier deliveries the **In-Charge checks the goods first** ("1. Waiting for the In-Charge to check the goods"), then the **Head Auditor approves the cost** ("2. Goods checked · waiting for the Head Auditor's cost approval"). The stock is added only after both.
- If an approval cannot go through (for example a new product without a cost), the approver sees the reason and the document stays in their list to try again.
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
- **Weekly Count Check** shows, for each sales associate, which weeks they submitted a count sheet and which they missed. The dashboard shows who missed last week.

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
<!-- for: consignment.manage, consignment.request -->
- **Consignee accounts** (Catalogue → Consignees, the Owner only): name, what they pay (retail price, consignee price or agreed cost), payment terms, contact and address. One step creates the consignee's stock location, customer, receivable account and agreement.
- **Consignment** has three simple steps:
  - **1. Send goods to a consignee:** choose the consignee and items → **Save draft** → **Print draft** → **Submit for approval**.
  - **2. Record consignee sales:** consignee, period, items sold. Prices are filled in from the agreement and can be edited. Print the draft, then submit.
  - **3. Goods returned by a consignee:** consignee, items and the branch taking them back → save, print, submit, then confirm when they arrive.
- **Approvals:** a Sales Associate's consignment goes to the Head or Asst Auditor first; a Warehouse Associate's to the Warehouse In-Charge. **The Owner always gives the final approval.** The Owner's own entries apply at once.
- **Stock at consignees** shows what each consignee holds, what they sold and what they still owe. Value at cost, and prices of cost-based agreements, are shown only to people allowed to see cost.

## Franchise portal
<!-- for: franchise.portal -->
- **Franchise Portal** shows the franchise's stock, incoming transfers, today's sales, the amount owed to GWS and the franchise's own profit and loss.
- The franchise associate confirms incoming transfers and records sales, but cannot change prices.

## Accounting
<!-- for: gl.view -->
- **Chart of Accounts**, **Journal Vouchers** (every posted entry, with a link to its source document), **Trial Balance**, and **Periods & Opening** (beginning balances and period locks).
- When automatic posting is switched on (Settings), sales, expenses, transfers, receivings, charges, cash fund movements, payroll and remittances post journal vouchers by themselves.
- **Inventory Cost:** inventory cost movements per day or per month (beginning, received, transfers in, pull-outs, direct cost of sales, ending) and direct cost generated from sales, per branch, with Excel export.
- Locking a period: the Accounting Head requests it and Admin approves.

## Financial statements
<!-- for: fs.income_statement, fs.balance_sheet -->
- **Financial Statements:** Income Statement, Balance Sheet, net income per branch and Cash Flow, for the chosen period. Only Admin and the External Auditor can open them.

## Users, audit log and settings (Admin)
<!-- for: user.manage, audit_log.view, settings.thresholds -->
- **Users & Roles → New user:** type the full name and company ID, a username (no spaces), the role and the branch (only asked for roles that work at a branch). Email is optional. Press **Generate** for a temporary password, then **Create account**. If the button is grey, the text beside it says what is still needed. The confirmation shows the username and temporary password to give the person, who sets their own password and accepts the statement at first sign-in.
- Click a user to change the role or branches, tick extra permissions for a custom role, switch the account off, or reset the password. **Activity** opens everything the person did.
- **Audit Log** records every action with the person, time and details.
- **Settings** holds thresholds (discrepancy days, alert levels, automatic posting and others).

## Inventory reports: item search and items with movement first
<!-- for: report.inventory.own, report.inventory.all -->
- **Inventory Reports:** type part of a name, SKU or brand in **Search item** and press **Search**. It works for the daily report, the monthly movement sheet and the stock ledger.
- **Stock ledger:** each movement shows its document (Sale DR, Pull-out, Transfer-in, Supplier delivery, Count sheet, Write-off…) with its number; click it to open the document.
- The **Daily Inventory Report** lists the items that moved in the period first (with a "moved" badge), then the items only carried in stock. The Excel file follows the same order and has a **Movement** column. Cost columns appear only for people allowed to see cost.

## Freebies received from suppliers
<!-- for: receiving.create, cost.edit -->
- Items a supplier gives for free go in the **Free (freebie)** column of the delivery, not in Qty.
- They are added to stock at the cost the Head Auditor approves on that delivery.
- With automatic posting on, they are booked as **Dr Inventory / Cr Other Income – Supplier Freebies**.

## Incentive paid from a sale
<!-- for: sale.incentive -->
1. On **New Sale**, press **+ Add incentive expense**.
2. Choose **Sales incentive** or **Rider / driver incentive**, who receives it, and the amount.
3. It is recorded as the branch's expense (Incentives / Rider-Driver Incentive account), paid from the cash on hand. It lowers the cash to deposit and shows on the Daily Sales Report.
- Voiding the sale voids the incentive too.

## Cash on hand (sales cash not yet deposited)
<!-- for: sale.create, cashdeposit.view.all, cashdeposit.settings -->
- **Cash on Hand** lists each sales day's cash still to deposit, the deadline and how many days are left. The branch dashboard shows the same, in red when overdue.
- **Days allowed:** the Head Auditor or the Owner sets, per branch, how many days after the sales day the cash must be in the bank (default 1).
- **Extension:** press **Request extension** on a day, choose the new date and give the reason. The Head Auditor **and** the Owner must both approve.
- **Reminders:** every morning the branch, Head Auditor, Asst Auditor and Audit Associate are told about cash due or overdue. A day past its deadline without an approved extension becomes an **HR notice** for a Notice to Explain.

## HR notices (Notice to Explain)
<!-- for: hr.notice -->
- **HR Notices (NTE)** lists situations HR must act on, such as cash not deposited on time. Each notice shows the amount, the sales day, the deadline and the staff on duty.
- Issue the NTE, press **Mark NTE issued** and write a note; **Close** it when settled.

## Product cost and days to consume
<!-- for: cost.edit, product.edit -->
- **Edit cost** on a product: type the new cost, the effective date and the reason, then **Send for approval**.
  - The Head Auditor's change is approved by the Owner, and the Owner's by the Head Auditor.
  - On approval, the Owner, Head Auditor, External Auditor and Accounting Head are notified. Nobody else ever sees cost.
- **Days to consume one unit** (for example 30 for a 30-serving tub): drives the customer re-order reminder.

## Customer contacts and re-order follow-ups
<!-- for: report.sales.own, report.sales.all -->
- **Customers & Follow-ups → Customers & items ordered:** every customer with contact number, email, the **items they ordered**, number of purchases and totals. Export to Excel.
- **Re-order follow-ups:**
  - When a customer with a number or email buys a product that has days to consume, a follow-up is due after quantity × days.
  - On that morning the store where they bought it is notified to call.
  - Tap the number to call, or press **SMS** / **Email**: the Owner's message is filled in and can be edited before sending. Then press **Contacted** or **Dismiss**.
- **The Owner** writes the SMS and email in **Settings → Customer re-order messages** and can make them go out automatically. SMS needs an SMS account (Semaphore) and email needs a mail server in the settings file; until then, messages are logged as "not set up".

## E-commerce: TikTok, Shopee and Lazada
<!-- for: ecom.manage, ecom.view, ecom.receive -->
Each platform has its own tab, reports and accounts; nothing is mixed. E-commerce keeps no stock of its own: items come from the Warehouse.

1. **Orders → pull-out:** the E-comm Associate uploads the platform's order / waybill export. The new orders go on one draft Warehouse pull-out (oldest expiry first). Unknown SKUs are matched once and remembered; duplicates and cancelled orders are skipped.
2. **Warehouse In-Charge:** approves the pull-out (the only approval). The items move to "TikTok / Shopee / Lazada – with courier" until the platform pays or the parcel comes back.
3. **Payouts:** the associate uploads the platform's payout file and sends it to Accounting. The Accounting Head checks that gross sales − discounts − fees − refunds − withholding tax = payout, then approves. The posting books:
   - the sale;
   - each fee to its own account per platform;
   - the 1% creditable withholding tax;
   - the payout to the platform's cash account;
   - the cost of goods sold.
4. **Returns:** the associate records the parcel by order ID or tracking number. The In-Charge marks each item:
   - **Good:** back to Warehouse stock.
   - **Damaged:** a write-off goes to the Head Auditor.
   - For an order already paid, the cost goes back to inventory.
5. **Ads:** entered or uploaded per platform and month as an expense, paid from the platform balance or a bank / card account.
6. **Order tracker:** shipped, paid, returned and **overdue** orders (shipped over 30 days ago, not paid nor returned; the days are in Settings as `ecom.overdue_days`). Reminder every Friday.
7. **Profit report:** TikTok | Shopee | Lazada | All. Cost of goods and profit after cost only for people allowed to see cost. Each platform also appears as its own line in Sales Graphs.

## Dashboard: today's sales and cash on hand (branch staff)
<!-- for: sale.create -->
- **Today's sales by payment:** cash, online (bank / GCash), credit card and on credit (AR / PDC), and the total.
- **Cash on hand:** the sales cash not yet deposited, always shown (₱0 = all deposited), with the deposit deadline.

## Sales targets, Sales Manager and Agents
<!-- for: target.manage, target.view, agent.self -->
- **Sales Targets:** the Sales Manager sets a monthly target per branch and per agent; the Owner approves it. The page shows target, sales so far and % achieved against how much of the month has gone (green on track, amber slightly behind, red behind).
- An agent listed at several branches is one person: all their sales add up. The Sales Manager links each agent to their **Agent** account.
- **My Sales (Agents):** own sales at every branch, own target and achievement, and customers who have not paid yet, nearest due first.
- The Sales Manager and Agents never see cost, margin or supplier data.

## Agent field work: outlets, itineraries, photos and consignments
<!-- for: outlet.view.all, outlet.manage, agent.self -->
**Outlets (menu: Outlets).** The gyms and stores an agent works with.
1. **Agent:** press **+ Add an outlet** (name, type, address, city, **contact person, number, email**, a **picture**), or **Upload Excel / CSV** (press **Template** to get the columns: Name, Type, Address, City, Contact person, Phone, Email, Notes). A name already in the database is skipped.
2. **Sales Manager:** **Waiting for approval** lists what the agents added; tick, then **Approve** or **Reject** (with the reason). Only approved outlets can be tagged on a sale or put in an itinerary.
3. **Changes and removal:** after approval an agent cannot change an outlet alone: **Ask for a change** goes to the Sales Manager (**Change requests**), and the **Owner is notified of every change** that is approved or that the Sales Manager makes. Only the Sales Manager can ask to **Remove outlet**; the Owner approves, and only if the outlet has **no order in the last 3 months**.
4. **Areas** (tab Areas): the Sales Manager creates areas and assigns each to an agent. An outlet can be moved to another area or agent, or **shared** with another agent (the first agent stays its owner).
5. **Pipeline:** an outlet moves from Prospect to Visited (a reported visit), First order (a sale is tagged to it) and Regular (3 orders in 90 days); Sample given is set by the agent. The **Map** tab shows outlets that have a location.
6. The Sales Manager, Head Auditor and Owner see every agent's outlets; an agent sees only their own and the ones shared with them.

**My Itinerary (agents, best on the phone).**
1. Choose the day, then **Plan the stores for this day** (tick your approved outlets) or **Upload itinerary file** (columns Date and Outlet).
2. At each store press **Report this visit**: **take a photo** of the store (required; the time is kept with it), choose the shelf check (GWS on the shelf, low, out of stock, not carried), type competitor brands if any, then **Visited**. The phone sends your **location** with it, so allow location for the site. A store not visited is marked **Missed** with the reason.
3. Press **Submit the report for this day** when every store is reported. A day that is submitted is locked.
4. **Claims:** under the stores, claim fuel, transport or meals (receipt photo optional). The Sales Manager approves, then Accounting is told to pay.

**Field Monitoring (Sales Manager, Head Auditor, Owner).**
- **Daily itineraries & photos:** plan vs actual per agent, then each day's stores with the photo, time, location link, shelf check and notes.
- **Agent scorecards:** visits, new outlets, sales against the target, unpaid invoices, consignment out against the maximum.
- **Areas & top outlets**, **Outlets not ordering** (no order for 30 days or more) and **Fuel / transport claims** (the Sales Manager approves).
- Every morning the Sales Manager is told of agents with no itinerary yesterday, visits not reported, consignments with no sales report for 15 / 30 / 60 days and maximums almost used; an agent with no plan for the day gets a reminder.

**Agent Consignments.**
1. **Sales Manager:** link each consignee account to the outlet (and so the agent) responsible for it.
2. **Maximum:** the Sales Manager sets a **maximum for the agent (all outlets together)** and, if wanted, **for one outlet**; the **Owner approves** it in My Approvals. Consignment is valued at the retail price (SRP) of the stock still with the consignee.
3. A consignment out that would take the agent (or the outlet) over the maximum is **stopped when it is submitted**, with the amounts shown. An agent with consignees but no approved maximum cannot be sent more until one is set.
4. **Agent:** **My Consignments** shows what is at each consignee, what they still owe, the last sales report and how much of your maximum is used.

## Tagging a sale to an agent's outlet
<!-- for: sale.create, sale.create.warehouse -->
In **New Sale**, under **Agent's outlet / gym (optional)**, pick the **agent** first and then one of that agent's **approved outlets**. The sale shows the outlet in the Sales list and the agent sees the order under My Sales and on the outlet. Tagging does not change the price or the agent's incentive. If the outlet is not listed, the agent uploads it under Outlets and the Sales Manager approves it first.

## Wheysted members: customers with a QR card
<!-- for: member.view, member.manage, member.blast, sale.create, sale.create.warehouse -->
**What it is.** A customer who joins becomes a **Wheysted member** with a member number (WHY-000001) and a **QR card**. Every purchase tagged to the member builds their profile, and the member can see their own purchases online.

**At the counter (every sale).** In **New Sale**, under **Wheysted member**: scan the customer's QR card (a USB / Bluetooth QR scanner types the code into the box; on a phone or tablet press **📷 Scan**), or type the member number, name or phone and pick them. Their name, number and email fill in, and the sale goes on their account. New customer? Press **+ New member** (name and mobile number; the number and QR card are made at once). Past sales that carry the same mobile number join the new member automatically.

**Wheysted Members** (Sales Manager, Owner; the Head Auditor can view).
- The list shows every member with orders, amount spent, average order, orders per month, last purchase and days since, **favorite item, brand and category**, main branch, segments, joined date and whether they have an online account. **Click a title to sort** (for example by amount spent or by days since the last purchase) and use the **filter under each title**. **Export xlsx / CSV** exports what is shown.
- **Segments:** VIP (top 10% spenders with 2+ orders), Frequent buyers (3+ orders and at least one a month), New (joined in the last 30 days), At risk (no purchase for 46–90 days), Lapsed (over 90 days), Never bought, Birthday this month. Choose one under **Show**.
- Click a member to see their **QR card (Print card)**, contact details, what they buy most, spending by month and every purchase with its items. The Sales Manager can edit the details, set whether they agreed to emails / SMS, put past sales with their number on the account, reset their online password, or block them.
- **Who bought this item:** type an item (or part of its name), pick it, optionally choose dates: the customers who bought it are listed with times, quantity, amount and last purchase (members and also customers who only left a number or name at the counter).
- **Make members from my sales** turns the customers already in your sales (name with a mobile number or email) into members, and puts their past purchases on their accounts. Do this once, after checking.

**The member page for customers.** Customers open **your web address followed by /member** (for example `https://your-site/member`) on their phone: **Become a member** (name, mobile, email, password; they tick that they agree to the terms and, if they want, to emails / SMS), then **My card** (the QR code and number to show at the counter), **My purchases** (every purchase with its items) and **My details**. If the store already made them a member, they type the **member number** when signing up to open that account (the mobile number must match). A customer's own sign-up never shows other people's past purchases. A forgotten password is reset by the store (Reset online password).

## Email and SMS campaigns
<!-- for: member.blast -->
1. Open **Email & SMS**. The two boxes at the top say whether email and SMS are ready. Setup (once, in `api/.env`, then restart): **email** = `SMTP_URL` (your mail server) and `MAIL_FROM` (the one company email all blasts come from), **SMS** = `SEMAPHORE_API_KEY` (and `SEMAPHORE_SENDER`), and `PUBLIC_URL` (the web address customers use, so the unsubscribe link works).
2. Choose **Email blast** or **SMS blast**. **Send to** the Wheysted members, or everyone in your customer database (members plus customers who left a number or email at the counter). Narrow it to a **segment** (for example At risk or Lapsed) and / or to those **who bought a given item**. Press **Count who will receive it**: people who unsubscribed, did not agree, or have no valid email / mobile number are left out and counted.
3. Type the message. You can use **{name}**, **{firstName}** and **{memberNo}**. An SMS can be up to 480 characters (3 SMS). Every email gets an **unsubscribe link** (the person is taken off the list at once). Press **Send me a test** first.
4. **Prepare campaign**, open it in the list, check the count and press **Send**. It goes out one by one; the page shows sent / failed / left out and each person's result. A campaign that could not go out because email / SMS was not set up can be sent again after the setup.
5. Send sparingly: customers can unsubscribe, and SMS has no unsubscribe reply.

## Searching any list
<!-- for: all -->
Every list with six or more rows has a **Search this list** box above it. Type part of a name, a number, a product, a branch or a date: every word you type must appear in the row (in any order), and the other rows are hidden. Clear the box to see everything again. In long lists the **column titles stay frozen** at the top while you scroll the rows (and the totals row stays at the bottom), so you always see which column is which. A search on the list only looks at what is loaded; on **6-Pack Card** the search looks through the whole period you chose (change **from / to** to look further back), and on **Notifications** it looks through all your notifications.

## Searching your notifications
<!-- for: notification.view -->
On **Notifications**, type in the search bar to find the notifications about one item: a product, a DR / form number, a branch or a person. Every word you type must appear in the notification (in any order); the search looks through all your notifications, not only the latest ones.

## Opening AR: customer credit from before GWS-ERP
<!-- for: ar.opening, approval.act.OPENING_AR, ar.view -->
Invoices that customers had not paid before GWS-ERP started are entered once, per branch, so every branch can follow them up and collect them in the system.

1. **Accounting Head or Accounting Associate:** AR & Collections → **Opening AR** → **+ Enter opening AR**. Choose the branch, the customer type (Dealer, Franchisee, Agent or Other) and the customer; type the DR / SI no., invoice date, due date and the balance still owed. Tick **There is a PDC** only when there is a cheque. Press **Send for the Owner's approval**. For many invoices use Imports → **Open AR**.
2. **Owner:** My Approvals → **Opening AR** → check them, then **Tick all** and **Approve all** (or reject with a reason).
3. **The branch:** once approved, the invoice appears in its AR & Collections with the due date, reminders start, and the branch is notified. Collect it like any credit sale.

An invoice date in the future, a DR / SI already recorded at that branch, or a PDC without cheque no. and date is refused. Opening AR is not posted to the books again: the AR beginning balance is in Periods & Opening.

## Faster approvals: tick all
<!-- for: all -->
In **My Approvals**, every group (for example "Opening AR" or "Special price") has **Tick all** and **Approve all**. **Select all** at the top ticks every item on the page; then press **Approve selected** or **Reject selected** (a reason is asked where one is required). After a bulk approval, the page lists any item that could not be approved and why.

## Finding transfers, and franchises in every list
<!-- for: transfer.create, transfer.confirm, report.inventory.all, report.inventory.own -->
On **Transfers & Pull-outs**, **View** shows all, only pull-outs (sent) or only transfer-ins (received). **Branches** lets you tick the branches to see (none ticked = all). For the Owner and auditors, pull-out and transfer-in apply to the ticked branches; for branch and warehouse staff they apply to their own location, and the ticks choose the other side.

In every list of branches, a franchise shows **(franchise)** beside its name (and a consignee **(consignee)**).

## Flavors and expiry dates: choosing the right item
<!-- for: sale.create, transfer.create, receiving.create, stock.flavor.set, product.edit -->
A SKU is **one item** in the inventory, counted once. Its **flavors** and **expiry dates** are told apart per batch:

- **Receiving:** each line has a **Flavor** (choose from the product's list or type a new one) and an **Expiry**. Same item in two flavors or dates: **+ another flavor / expiry**.
- **New Sale and Transfers:** only items the branch has on hand are listed, with the quantity. When an item has more than one flavor or expiry, a list opens: choose the one you are selling or sending (the oldest is first). The line shows the flavor, expiry and how many are left of it; asking for more than that is refused.
- **Stock on Hand:** the Flavors column shows how many of each flavor. Old stock without a flavor: Batches → **Set flavors** (Head Auditor, Asst Auditor, Warehouse In-Charge, the branch). The total does not change.
- **Products:** the Owner or the Head Auditor keeps the list of flavors on the product.

## Checking a sale before it is saved
<!-- for: sale.create -->
**Review sale** opens a check of everything: branch, DR / SI, channel, customer, payment and account, every item with its flavor and expiry, quantities, prices, special prices, fees, incentive and total. Press **Confirm and save sale** when it is right, or **Go back and edit**.

## Agent incentives
<!-- for: incentive.view, incentive.prepare, agent.self -->
1. **Sales Manager** (menu: Agent Incentives): choose the month; each agent's total sales at every branch is listed. Type the incentive (% of sales or an amount) and press **Confirm**.
2. **Accounting Associate, Accounting Head, then the Owner** approve it in My Approvals.
3. The **release form** (AI-000001…) is made and goes to **HR**: print it, have the agent sign, press **Agent signed**.
4. **Accounting** presses **Tag as released**: bank transfer, GCash, cheque or cash, the account, the reference and the date.
The agent sees their own incentive and its status on the same page.

## The Owner may approve anything
<!-- for: approval.act.SALES_TARGET -->
The Owner is the highest authority. In My Approvals, **Show everything waiting** lists every request waiting with anyone; the Owner may approve or reject any of them, and the decision is final. The dashboard's "Pending your approval" shows how many more are waiting with others.

## Changing a closed day (post-close edit)
<!-- for: sale.create, hr.notice, approval.act.POST_CLOSE_EDIT -->
After the Daily Sales Report is submitted, or for an earlier day, a sale or an expense can only be changed by request:

1. **Daily Close & Deposit** or **Daily Sales Report** → **Change a closed day** → choose the date and the sale or expense.
2. Choose **Correct details** (DR / SI no., payment mode, customer, delivery fee; for an expense: amount, payee, notes) or **Void it**.
3. Choose the **reason** (required) and add details → **Send post-close edit request**. The card shows who approves it: the Head Auditor and the Asst Auditor (both), or the franchise owner. Nothing changes until it is approved.

HR and the Head Auditor are told of every request. **Three in one month, or three days in a row, is flagged**; HR is advised to refer it to the Owner as negligence of duty. Review the report carefully before submitting so that edits are rarely needed.

## Your password
<!-- for: all -->
Your account is personal and you answer for everything done under it. Press the **key icon** at the top right (**Change my password**) any time: type the current password and a new one of 10 or more characters. Never tell your password to anyone, including co-workers, supervisors, HR or the Owner; nobody can see it. If you forget it, the Owner can only give you a new temporary one. HR is notified whenever the Owner or anyone opens a new user account or employee record.

## Credit-card and e-commerce prices
<!-- for: sale.create, ecom.price.edit, ecom.manage -->
A sale paid by **credit card** uses the credit-card price: SRP ÷ 0.96, for example ₱1,250.00 becomes ₱1,302.08 (the price memo of September 21, 2026 shows whole pesos; the system keeps the centavos). A TikTok, Shopee or Lazada sale uses that platform's price list. The Owner sets both in **E-com & Card Prices**: the card fee %, how it is applied, and each platform price (or imports the masterlist again). Lazada follows Shopee until it has its own prices.

## 6-Pack Card
<!-- for: sixpack.issue, sixpack.view.all -->
**Search:** on **6-Pack Card**, choose the period (from / to) and type in **Search the stickers given and cards redeemed**: customer, mobile, email, DR / SI, card number, branch or associate. Both lists (Stickers given and Cards redeemed) are filtered; the totals above stay for the whole period.

1. On **New Sale** tick **6-Pack sticker given** and type the customer's full name and mobile number. One sticker is recorded for each supplement on the DR.
2. At six stickers (from any branch) the customer earns a ₱300 card. Open **6-Pack Card → Redeem a card**: type the number → **Find** (shows the balance) → complete name, email and address → **Redeem**.
3. The ₱300 is booked as your branch's **6-Pack Card** expense, paid from the cash on hand, tagged to the customer.
4. An old paper card: tick the box, type its number and attach a photo; the auditors and the Owner are told.
5. **Customer cannot be tagged** (data missing): the **Head Auditor** sends the request on the 6-Pack Card page (branch, what is known, the reason) and the **Owner approves** in My Approvals. The card is then booked as usual and marked as an override.

## Franchise AR (what franchises owe GWS)
<!-- for: franchise.ar.view, franchise.ar.own, franchise.ar.pay, franchise.ar.manage -->
Goods sent to a franchise are billed at the franchise price when it receives them and are due 30 days later. After the due date a **2% penalty (once) and 0.1% a day** on the unpaid goods are added (memo of July 31, 2026; for ₱100,000: 1 day ₱2,100, 5 days ₱2,500, 10 days ₱3,000, 30 days ₱5,000). Payments settle the penalty first, then the interest, then the goods. If the received quantities change (a transfer difference is resolved), the invoice changes by itself and the Owner, auditors, Accounting, Franchise Coordinators, the sales associates involved and the franchise owner are told. The franchise owner asks for an extension on the page; the Owner decides and the others are flagged. Unpaid two months after the due date, the account is flagged and the page shows the recommended actions; the Owner may put the franchise on cash-before-delivery or waive charges.

## Memorandums
<!-- for: all -->
**Memorandums** lists the memos addressed to you: open one and press **I have read this memo**. HR, the Owner, the Franchise Coordinators and the Head Auditor can **Write a memo**: choose who it is for (everyone, franchise owners, franchise associates, a role, a branch or named people), the subject, the text, an optional table and the people who sign. It is numbered by itself (2026-Q3-046), everyone addressed and every signer is notified, and **Print / download PDF** gives the company layout. The Owner's memos always carry AL MARVIN VINLUAN (President) and MICAH VINLUAN (Manager).

## Bank deposit slip and verification
<!-- for: sale.create, approval.act.CASH_DEPOSIT_AUDIT, approval.act.CASH_DEPOSIT_ACCOUNTING -->
On **Daily Close & Deposit** the coloured days on the calendar (and the boxes beside it) are the days whose cash is not deposited yet: press one, choose the bank, **attach the deposit slip** (required) and **Record deposit**. The Audit Associate checks the slip against the amount, bank and date in My Approvals, then the Accounting Associate does the same. If either does not accept it (a reason is required) the branch, the Head Auditor, the Accounting Head and the Owner are told; fix it under **Deposits recorded by this branch** and send it again.

## E-commerce margin analysis and waybill report
<!-- for: ecom.analysis, ecom.waybill -->
**Waybill Report** (E-comm Associate, Head Auditor, Owner): upload the TikTok, Shopee or Lazada shipping labels (PDF). Each label gives the order, tracking number, quantity and weight; choose the product once (the same platform and weight are filled in next time, to confirm). The report shows the SRP from the platform price list, the platform fees at the rates you set (or copy from posted payouts) and the total order income. **E-com Margin Analysis** (Owner): each platform's fees, ads and cost of goods, the margin against the target and the price that keeps it; add ad expenses at the bottom.

## Selling to a franchise: price, plastic and shipping
<!-- for: sale.create, sale.create.warehouse, franchise.ar.view, franchise.ar.own, franchise.shipping.fill -->
1. On **New Sale** choose the channel **FRANCHISE** and pick the franchisee. The **franchise price** fills in by itself for every item; you may change a price (a price below the list needs the Owner's approval as any special price). Sales Associates of any branch, including the Warehouse store, and the Franchise Coordinators can do this. The **Franchise Coordinators** have **New Sale** too: they record sales **from the warehouse only** (the warehouse is chosen for them), to franchises and for every other channel (walk-in, dealer, agent, delivery, online…) and payment mode.
2. **Plastic bags** are charged to franchises: Large ₱4, Medium ₱3, Small ₱3, XL ₱5 each (the Owner can change these under Products & Prices). For stores and other customers a plastic stays free (₱0); if the bag was sold, type its price on the line.
3. **Shipping charged to the franchise:** when you pick a franchisee, choose **To follow** (the usual), **Type the amount now**, or **No shipping charge**. With *To follow* the Franchise Coordinator is told, and must fill in the amount within **2 days** on **Franchise AR → Shipping charges billed to franchises → Fill in the amount**. It becomes its **own franchise invoice** (FAR-SHIP-…), separate from the order, due after the usual terms, with the same penalty and interest. The franchise owner, the Owner, the auditors, Accounting and the Coordinators are told when it is tagged, when it is billed, and every day it is late.
4. A change after it is billed, or more time for the 2 days, is asked for by the Franchise Coordinator (**Ask to change / Ask for more time**) and decided by the **Owner** in My Approvals.
5. A **franchise owner** sees every transaction of their own franchise only (sales, transfers, expenses, AR) and creates their own sales and expenses.

## E-commerce: the "To ship" export becomes the pick list
<!-- for: ecom.manage -->
1. In TikTok Seller Center open the orders **To ship** and **Export** them (CSV or Excel). The file does **not** need a seller SKU: the product title, the variation (flavor, size) and the SKU ID in it are read.
2. **E-commerce → Orders → Choose file and upload.** All new orders go on **one pick list**: a draft pull-out from the Warehouse with the items totalled and the oldest expiry first. Orders already uploaded, cancelled orders, and orders the Warehouse cannot cover are skipped and listed.
3. **A product seen for the first time:** the page shows what the listing looks like in GWS (for example *Prothin Whey Ripped 10s (Vanilla)*). Press **Use this** (or **Accept the best match for each**, or search another product). It is remembered; upload the same file again.
4. Check the draft, **print the picking list**, and press **Submit**, or tick **Send to the Warehouse In-Charge right away** before uploading. The In-Charge approves and packs.
5. When the shipping labels (waybills) are ready, upload the PDFs on **Waybill Report**: it gives the SRP, the platform fees and the total order income.

## Deleting an unfinished draft
<!-- for: transfer.create, receiving.create, count.create, inspection.create -->
A draft that was not submitted (a transfer / pull-out, a supplier delivery, a count sheet or a store inspection report) can be deleted: open it and press **Delete draft**. Only the person who prepared it, the Warehouse In-Charge (warehouse forms), the Head Auditor (count sheets and inspections) or the Owner can. The **form numbers adjust by themselves**: the drafts after the deleted one move down one number (their owners are told; print them again if you already printed them), so there is no gap. A form that is already submitted or approved keeps its number; the number that cannot be closed up is used by the next new form. A sent or approved form is never deleted: it is cancelled (void) with a reason.

## The forms behind a stock movement
<!-- for: report.inventory.all, report.inventory.own -->
In **Inventory Reports → Daily Inventory Report**, the figures under **Receive, Transfer In, Returns, Pull Out, Other Out and Adj** are links. Press one to see the forms that made that movement: the Pull-Out and Transfer-In forms (each side sees its own copy), the Supplier's Form with the supplier's delivery receipt, the count sheet, the write-off or the replacement ticket, each with its attachments. Sales has no such view; open the sale in Sales List.

## Printed forms: the checker's column
<!-- for: all -->
The printed Pull-Out, Transfer-In, DR (sales), Supplier's Form and Count sheet have a blank **Checker's qty (write by hand)** column at the far right. The person who double-checks the goods writes the quantity counted there, then signs "Checked by".

## Marketing and BO pull-outs
<!-- for: transfer.create, marketing.summary, approval.act.MARKETING_PULLOUT, approval.act.PULLOUT_EXPENSE -->
Any branch (or the warehouse) with stock can give stock out to **Prothin Marketing**, **GWS Marketing** or **BO** (bad orders): in Transfers & Pull-outs choose it under **To → Stock given out**. Tick **Endorse to Accounting as an expense** if Accounting should book it. The **Head Auditor approves**; the stock then leaves your branch at once (nothing is confirmed at the other end). If it was endorsed, Accounting accepts it in My Approvals and books it at cost (BO as spoilage, marketing as marketing expense). Not endorsed at the start? On the approved form press **Endorse to Accounting as expense** later. **Marketing & BO Pull-outs** (auditors, Accounting, Owner; a branch sees its own) lists everything given out per destination, item by item, with the units already expensed and those waiting for Accounting.

## Replacement tickets
<!-- for: replacement.create, replacement.view, approval.act.REPLACEMENT_TICKET, approval.act.SUPPLIER_RETURN -->
**A customer returned an item.** Open **Replacement Tickets → Customer returned an item** (or press the link on the sale's page): find the **DR / SI** it was sold on (DR number, customer name or mobile), choose the item, the quantity (not more than was sold and not already returned) and the reason, and attach a photo. The ticket (RT number) names the DR, the customer and the sales associate. The auditors, Accounting, the Owner, the sales associate of that DR and every branch are told.
**Any branch except a franchise** gives the customer the replacement and presses **We gave the replacement** on the ticket: the same product or another one, the quantity and the price (the price list by default). The **price difference** against the DR is worked out by itself: the customer pays it, or is refunded / credited. The replacement leaves that branch's stock, the **Head Auditor approves** (if not approved, the stock goes back and the ticket opens again), and the ticket closes. The branch confirms **The customer paid the difference / The refund was given**, and Accounting is told. A return older than 30 days is flagged.
**Items we return to a supplier.** Open **Return items to a supplier**: the product, quantity, supplier and reason. The **Head Auditor approves**; the stock leaves then. The ticket is tagged to the supplier and **stays open until replacement items arrive**: on Supplier Deliveries choose the ticket ("This delivery replaces a ticket") when you receive them. Part of the quantity keeps it open; enough arrival closes it, and the value difference (a different product, another cost) is worked out. Nothing else closes it. Open tickets are reminded to the auditors, Accounting, the Owner and whoever opened them (customers after 3 days, suppliers after 7), and the page shows which suppliers still owe us units.
**Accounting entries** (when automatic posting is on): a replacement given is expensed at cost against the branch's inventory; the price difference is booked when the branch confirms it (cash, or the customer's account on a credit sale; a refund reduces sales); items returned to a supplier become a receivable from that supplier until the replacement arrives, and the arrival clears it against what we owe the supplier.

## Page names and what each page is for
<!-- for: all -->
- Every menu item has a descriptive name (for example **Supplier Deliveries** or **Transfers & Pull-outs**).
- The top of each page says in one line what the page is for.

## Sales Report and Sales Graphs
<!-- for: report.sales.own, report.sales.all -->
- **Sales Report:**
  - Choose the branch (or **All branches**) and the period, or press **Today**, **This month**, **Last month** or **This year**.
  - It shows total sales, number of sales and average per sale, products sold, how customers paid, sales by channel, per branch (with each branch's share), per day and the top products.
  - Gross profit shows only for people allowed to see cost. **Excel** exports the same report.
- **Sales Graphs:**
  - Choose the month. The first graph shows each branch's running total for the month so far, each branch in its own colour; the second shows the whole company.
  - The third graph shows every month of the year: the column height is the company total, and the coloured parts are the branches.
  - Hover for exact amounts, or press **Show as tables**. Branch staff see only their own branch.

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
