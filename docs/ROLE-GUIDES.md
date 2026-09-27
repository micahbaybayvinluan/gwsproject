# GWS-ERP guides per role

Each section below is the step-by-step guide for one role and lists only the work that role does. The Help page shows each person the guide for their own role under **My guide**. The processes everyone uses (signing in, notifications, form numbers, troubleshooting) are in **Guide for everyone**. The Admin (Owner) can read every role's guide to train staff.

## Sales Associate (branch)
<!-- role: SALES_ASSOCIATE -->
You run one branch: sales, expenses, stock received and sent, the weekly count, the end-of-day report and the bank deposit. You never see supplier cost.

**Start of the day**
1. Sign in with your own account (never share it). Open the **Dashboard**.
2. Read the red and amber cards first:
   - **Weekly count sheet** not yet done this week.
   - **Discrepancy** with days left to explain (in bold red).
   - **Cash on hand** not yet deposited, and its deadline.
   - **My charges** to acknowledge.
3. Check **Price updates** for new selling prices that apply to your branch.

**Recording a sale** (menu: New Sale (Record a Sale))
1. Type the **DR / SI number** from the paper receipt.
2. Choose the **channel** (walk-in, delivery, franchise, dealer, agent, shipping) and the **payment mode**.
3. Add the items: type the name or SKU, or scan the barcode. Freebies are added at ₱0.
4. Payment details:
   - **Online (bank / GCash):** choose the account that received the money (for example **Gcash (GWS)**) and upload the screenshot.
   - **Credit card:** choose the account, then type MID, slip no., approval code and batch no., and upload the slip.
   - **AR / PDC (credit):** choose the customer and the due date; add the cheque details if any.
   - **Delivery:** choose the rider and type the delivery fee.
5. **Incentive paid from the sale:** press **+ Add incentive expense**, choose the type (sales or rider/driver), who receives it and the amount. It is taken from the cash to deposit and recorded as your branch's expense.
6. A price lower than the list price is a **special price**: it is saved, and the Owner approves it.
7. Press **Save sale**. Stock is deducted at once.

**Mistakes on a sale**
- Before today's report is submitted: open the sale in **Sales List & Search** and **Void** it with a reason, then record it again.
- After the report is submitted (or on an earlier day): open the sale and request a **post-close edit** (the auditors approve). Every approved correction is logged against the person who made the document.

**Expenses** (menu: Branch Expenses)
1. Choose the account (for example Meralco, Water), the payee and the amount.
2. Choose where the money came from: **cash drawer** (lowers the cash to deposit) or **cash fund**.
3. Attach the receipt.

**Cash fund** (menu: Branch Cash Fund)
- Expenses paid from the fund lower its balance.
- Press **Replenish from today's cash sales** to top it back up; this lowers today's cash to deposit.

**Customer credit and collections** (menu: Customer Credit)
- Tick the invoice, type the amount received and send it. It waits for Accounting's approval before the balance goes down.

**Stock**
1. **Asking for stock:** in Stock Transfers & Pull-outs, press **Request stock from the warehouse**, add the items and send.
2. **Receiving a delivery:**
   1. Open the incoming transfer.
   2. Tick what really arrived and correct the quantities (never negative).
   3. Press **Confirm**. Shortfalls go to the auditors.
3. **Returning stock:** prepare a pull-out to the warehouse. The "From" is always your branch.
4. **Expired or damaged items:** in Write-offs, list them with the reason. The Head Auditor approves.

**Weekly count sheet** (menu: Inventory Count Sheets)
1. Press **Start my weekly count sheet**. Every item is listed:
   - first the items the system has at your branch, with their beginning count;
   - then the items not in the system.
2. Type the **actual count** for every item in the first group. In the second group, type a number only if you find the item; blank means none.
3. You may **Download sheet (xlsx)**, fill the "Actual count" column on paper or in Excel, and **Upload filled sheet**.
4. Press **Submit count**. The sheet is locked; a correction needs the Head Auditor's approval.
5. If there are differences, a **discrepancy case** opens. You, the auditors, the Owner and HR are notified.
6. You have **7 days** to press **Explain** on the case. If your explanation is accepted, nobody is charged. If there is no explanation, or it is rejected, the shortage is charged at franchise price and HR splits it among the staff.

**End of the day** (before 8 PM)
1. **Daily Close, Cash Count & Bank Deposit:** count the money by denomination and save the count. A shortage may be charged to the staff on duty.
2. **Daily Branch Sales Report:** check every number.
3. Press **Submit today's report…**, tick **"I acknowledge that this Daily Sales Report is true and correct"** and press **I agree — submit**. Today is then closed for your branch; later changes need a revision request.
4. You are reminded at **7:30 PM**. If the report is not submitted by **9 PM**, it is submitted as it stands, and the Head Auditor, Asst Auditor, Audit Associate and HR are notified.

**Bank deposit of the cash** (menu: Cash on Hand)
1. Deposit each day's cash within the days allowed for your branch (shown on the page and the dashboard).
2. Record the deposit in **Daily Close → Bank deposit**: amount, bank account (a bank or **Gcash (GWS)**) and deposit date, for the sales day it covers.
3. If you cannot deposit on time, press **Request extension** on that day, choose the new date and give the reason. The Head Auditor **and** the Owner must both approve.
4. When a day is due, the auditors are reminded. Past the deadline without an approved extension, HR is told to issue a **Notice to Explain**.

**Your pay** (menu: My Pay & Charges)
- See only your own payslips and charges. Press **Acknowledge** on every new charge.

**How your branch is doing**
- **Sales Report:** your branch's sales for any period (today, this month, last month or your own dates), with payment modes, top products and a per-day table. Export it to Excel.
- **Monthly Sales Performance:** a graph of your branch's sales this month so far and month by month this year.

**Customers who may have finished their supplements** (menu: Customer Contact List & Follow-ups → Re-order follow-ups)
1. When a customer with a contact number or email buys a product that has "days to consume", a reminder is set for the day it is probably finished. That morning you are notified.
2. Open **Re-order follow-ups**: call the number (tap it on a phone), or press **SMS** / **Email**. The Owner's message is filled in; you may edit it before sending.
3. Press **Contacted** after you reach the customer, or **Dismiss** if it no longer applies.
4. The customer list also shows the **items each customer ordered**.

**Consignment** (menu: Consignment (In & Out))
1. **Send goods to a consignee:**
   1. Choose the consignee (the Owner creates them) and add the items.
   2. **Save draft**, **Print draft** if needed, then **Submit for approval**.
   3. The Head or Asst Auditor checks it first, then the Owner approves. Stock leaves your branch only after the Owner's approval.
2. **Record consignee sales:**
   1. Choose the consignee and the period, then add the items sold.
   2. Prices are filled in from the agreement and you may edit them.
   3. **Print draft**, then **Submit for approval**: auditor first, the Owner last. The consignee then owes the amount.
3. **Goods returned by a consignee:** choose the consignee, the items and your branch → save, print, submit. After approval, confirm the goods when they arrive.

## Warehouse Associate
<!-- role: WAREHOUSE_ASSOCIATE -->
You enter what comes into and goes out of the warehouse. You never see supplier cost. Your entries are checked by the Warehouse In-Charge before stock changes.

**Supplier deliveries** (menu: Supplier Deliveries (Receiving))
1. Press **New**, then choose the supplier (by code) and type the supplier's invoice / DR number.
2. For each item, type:
   - **Qty** (bought);
   - **Free (freebie)**: items the supplier gave free, which are recorded as Other Income;
   - **Expiry** and **Batch #**.
3. Same item with two expiry dates: press **+ another expiry** and split the quantity.
4. Attach the supplier invoice and press **Submit**.
5. Approval steps:
   1. The Head Auditor approves the cost; the page then shows "Cost approved · waiting for the In-Charge".
   2. The In-Charge checks the goods and approves.
   3. Only then is the stock added.

**Sending stock out** (menu: Stock Transfers & Pull-outs)
1. Prepare a pull-out to a branch or franchise. The oldest expiry is picked first.
2. Print the draft if needed, then **Submit**.
3. Approval steps: the In-Charge approves first, then the auditors (between company locations) or the Owner (to a franchise). The receiver confirms what arrived.
4. **Branch requests:** when a branch asks for stock, the notification opens the transfer with that branch already chosen.

**Stock returned to the warehouse**
- Confirm what arrived. Your confirmation waits for the In-Charge before stock is added.

**Edits by the In-Charge**
- When the In-Charge changes one of your documents, it appears in **Approvals Waiting for Me**. Accept or reject the change.

**Weekly count**
- Same as every associate: **Inventory Count Sheets → Start my weekly count sheet**. Type the actual counts and submit.
- Differences open a case with 7 days to explain.

**Consignment** (menu: Consignment (In & Out))
- **Send goods to a consignee**, **record consignee sales** (prices filled in from the agreement, editable) or **take goods back**.
- Always save and print the draft first, then submit. The Warehouse In-Charge checks it first; the Owner approves last.

**Your pay:** My Pay & Charges.

## Warehouse In-Charge
<!-- role: WAREHOUSE_IN_CHARGE -->
You are responsible for the warehouse stock. You check your associates' entries, and you enter receiving and transfers yourself.

**Approving your associates' goods in and out** (menu: Approvals Waiting for Me)
- **Goods into the warehouse:** supplier deliveries whose cost the Head Auditor already approved, and stock returned to the warehouse. Check the goods and the quantities, then **Approve** (stock is added) or **Reject**.
- **Goods out of the warehouse:** pull-outs prepared by an associate. Approve before they go to the auditors or the Owner.
- The document page shows the workflow bar: who approved and who is next.

**Your own entries**
- Receive supplier deliveries and prepare transfers the same way as an associate.
- Your own entries do not need In-Charge approval. The Head Auditor still approves the cost of every delivery.
- Warehouse sales need no In-Charge approval.

**Consignments from your associates**
- **Consignment check** requests from Warehouse Associates come to you first; after you approve, the Owner gives the final approval.
- Your own consignments go straight to the Owner.

**Correcting an associate's document**
- Edit it. The associate must accept your change before it applies.

**Counts and write-offs**
- Count the warehouse (Inventory Count Sheets).
- Write off expired or damaged stock; the Head Auditor approves.
- Explain discrepancies within 7 days.

**Reports:** Stock on Hand, Inventory Reports & Movement (quantities only).

## Head Auditor
<!-- role: HEAD_AUDITOR -->
You approve costs and most corrections, audit the branches, and watch the cash.

**Every day: Approvals Waiting for Me**
- **Receiving cost:**
  1. Open the delivery and check or type the unit cost of each line (freebies included).
  2. Approve. An unchanged cost approves by itself after 24 hours.
  3. Goods entered by a Warehouse Associate then go to the In-Charge.
- **Transfers between company locations:** you or the Asst Auditor (either one).
- **Post-close edits of company branches:** you **and** the Asst Auditor (both).
- **Write-offs, discrepancy resolutions, count revisions and discrepancy explanations:** you alone.
  - Explanation accepted → the stock is adjusted and nobody is charged.
  - Explanation rejected → the shortage is charged at franchise price at the deadline.
- **Audit Associate corrections:** you alone. The staff member is notified and the correction goes to the Revision Log.
- **More days to deposit cash:** you **and** the Owner (both).
- **Consignment checks from branch staff:** you or the Asst Auditor, before the Owner's final approval.
- **Cost changes typed by the Owner:** you approve them.

**Products and suppliers**
- You may edit products and suppliers.
- **Cost:** open a product → **Edit cost** → new cost, effective date and reason → **Send for approval**. The Owner approves it, then the cost-access roles are notified.
- **Days to consume one unit:** set it on the product. It drives the customer re-order reminders.
- New products and suppliers you create wait for the Owner's approval.
- Only the Owner deletes.

**Counts**
- Create audit counts for any branch or franchise. Every item is listed, items in the system first.
- Differences open a case: the branch, the auditors, the Owner and HR are notified, and the branch has 7 days to explain.

**Cash on hand** (menu: Cash on Hand)
1. See every branch's undeposited cash, the overdue days and the oldest day.
2. Set **Days allowed** per branch (how many days after the sales day the cash must be in the bank).
3. You are reminded every morning of cash that is due or overdue.

**Daily Sales Reports**
- The dashboard lists the branches that have not submitted today's report.
- You are notified when a report was submitted automatically at the cut-off.
- The report's **Audit summary** shows the margin.

**Other**
- You are notified of supplier cost changes.
- Charge a cash shortage to staff from Daily Close.
- Review store inspections and the Revision Log.

## Asst Auditor
<!-- role: ASST_AUDITOR -->
You support the Head Auditor.

**Approvals**
- Transfers between company locations (you or the Head Auditor).
- Post-close edits of company branches (you **and** the Head Auditor).
- Consignment checks from branch staff (you or the Head Auditor), before the Owner's final approval.

**Counts and store checks**
- Create audit counts for branches, franchises and the warehouse.
- Confirm the cash fund found in a store.
- Fill store inspection reports.

**Watching**
- You are reminded of cash on hand that is due or overdue (menu: Cash on Hand).
- You are notified of count discrepancies and of Daily Sales Reports not submitted by the cut-off.

**Entering on behalf of a branch**
- You may record sales, expenses, receiving and transfers when needed. They follow the same approvals as the branch's own entries.

## Audit Associate
<!-- role: AUDIT_ASSOCIATE -->
You review branch reports (with supplier cost) and ask for corrections.

1. Read the Daily Branch Sales Reports, inventory reports and documents of any branch.
2. **Correcting an error:**
   1. Open the sale or transfer and use **Request a correction**.
   2. Choose what to correct, type the new value and the error found, then send.
   3. The staff member who made it is notified. Only the Head Auditor approves.
3. The **Revision Log** counts errors per staff member.
4. You are notified of count discrepancies, cash on hand that is due, and reports not submitted by the cut-off.

## Field Auditor
<!-- role: FIELD_AUDITOR -->
You visit stores. You see the inventory of every location without cost, and you never see sales.

1. **Audit count:**
   1. Inventory Count Sheets → choose the branch, franchise or warehouse → **Create count sheet**.
   2. Every item is listed, the ones in the system first. Type the actual counts and **Submit count**.
   3. Differences open a case. The branch staff, the auditors, the Owner and HR are notified, and the branch has 7 days to explain.
2. **Cash fund check:** Branch Cash Fund → choose the branch → type the cash found → **Confirm count**.
3. **Store inspection report:**
   1. Store Inspection Reports → **New** → choose the branch and the staff on duty.
   2. Fill the 19 checklist items and add comments.
   3. Press **Submit to HR**. The staff member acknowledges it and HR reviews it.

## Franchise Sales Associate
<!-- role: FRANCHISE_SALES_ASSOCIATE -->
You sell at a franchise. You never see franchise cost.

1. **Sales:** record each sale in **New Sale** the same way as a branch associate. You cannot change prices.
2. **Deliveries from GWS:**
   - If your franchise owner allows it, open the incoming transfer, tick what arrived and **Confirm**. The owner is notified.
   - If not, only the owner confirms.
3. **Weekly count:** Inventory Count Sheets → **Start my weekly count sheet** → count → submit. Differences open a case with 7 days to explain.
4. **Your pay:** My Pay & Charges shows only your own salary and charges, set by your franchise owner.

## Franchise Owner
<!-- role: FRANCHISE_OWNER -->
You run your franchise. Everything you see is limited to your own branch, and your books are separate from the other GWS branches.

1. **Franchise Portal → Overview:** stock, incoming deliveries, today's sales and what you owe GWS.
   - Switch **"associate may receive stock"** on or off. With it on, your associate confirms deliveries and you are notified.
2. **Staff pay & charges:**
   - Record each associate's salary; it becomes your franchise expense, and only you see it.
   - Create charges for your own staff and branch. GWS HR has no access.
3. **Income statement & balance sheet:** choose the dates. Only your branch is included.
4. **Expenses:** add franchise expenses (rent, utilities…); they appear in your statements.
5. **Corrections:** post-close edits at your franchise come to you for approval.
6. **Prices:** Price updates on your dashboard show only your franchise price.

## Accounting Head
<!-- role: ACCOUNTING_HEAD -->
You keep the books.

1. **Journal Vouchers (Accounting Entries):** every entry links to its source document. Automatic posting is switched on in Settings.
2. **Correcting an entry:**
   1. Open the voucher and press **Edit entry**.
   2. Change the lines: they must balance, no negatives, and the period must be open.
   3. Give the reason. The maker, the source document's maker and the Owner are notified, and the change is logged.
3. **Trial Balance**, **Periods & Opening Balances** (request a period lock; the Owner approves) and **Inventory & Direct Cost**.
4. **AR payments** entered by branches wait for you or the Accounting Associate in Approvals.
5. **Payroll:** close HR's finalized runs by choosing the paying bank account.
6. **Main Bank & Office Entries:** record main bank transactions, with the bank or **Gcash (GWS)** account and the book they belong to.
7. You are notified of supplier cost changes.

## Accounting Associate
<!-- role: ACCOUNTING_ASSOCIATE -->
1. **AR payments** entered by branches: approve or reject them in Approvals Waiting for Me.
2. **Journal Vouchers:** view entries and correct them with **Edit entry** (balanced, no negatives, open period). The people involved and the Owner are notified.
3. **Main Bank & Office Entries:** record bank transactions and see balance-sheet account balances.
4. **Payroll:** you see totals only. Record government contribution payments.

## HR Staff
<!-- role: HR_STAFF -->
You handle people: employees, accounts, pay, charges and notices. You have no access to inventory, sales or franchise payroll.

1. **New employee** (Payroll & Government Contributions → Employees → Add employee):
   - Choose a company branch (not a franchise). It waits for the Owner's approval.
2. **User account:**
   1. Open the approved employee → **Create user account…**.
   2. Type the username and choose the role and branch. Email is optional.
   3. Press **Generate** for a temporary password, then send. The Owner approves.
   4. Give the person the username and temporary password.
3. **Payroll run:**
   1. Create the run for the period.
   2. Check overtime, incentives, loans and charge deductions, then **Finalize**.
   3. Accounting closes it. Print payslips.
4. **Contributions:** SSS, PhilHealth and Pag-IBIG register per employee; record each remittance.
5. **Charge Forms (Staff Charges):**
   - Charges from discrepancies, write-offs and cash shortages arrive here automatically.
   - Split each one between the staff, set the pay periods and **Finalize**.
   - Print the Charge Form and the Salary Deduction Authorization.
6. **HR Notices (Notice to Explain):** when a branch did not deposit its cash on time, a notice lists the amount, the dates and the staff on duty.
   - Issue the NTE, then **Mark NTE issued**; **Close** it when settled.
7. **Watching:**
   - Weekly Count Compliance shows who did not submit a count sheet.
   - You are notified of count discrepancies, explanations and Daily Sales Reports not submitted by the cut-off.
   - The Revision Log shows errors per staff member.
   - Review store inspection reports.

## Executive Assistant
<!-- role: EXECUTIVE_ASSISTANT -->
You record main office bank transactions. You do not see cost, branch reports or income.

1. **Main Bank & Office Entries → Bank entries:**
   1. Choose the bank account (including **Gcash (GWS)**) and whether money came in or went out.
   2. Choose the book (advances to, advances from, supplier payables, office expense, receivables, fixed asset, equity or bank transfer) and the account.
   3. Type the amount, the payee or source, and the reference, then save. A journal voucher is created.
2. **Supplier payables** and **Office expenses:** view only.
3. **Balance sheet accounts:** the balance of each account.

## External Auditor
<!-- role: EXTERNAL_AUDITOR -->
You can read everything, including cost, payroll and the financial statements, but you cannot change or approve anything.

1. Financial Statements, Trial Balance, Journal Vouchers, inventory and sales reports, payroll, and the Audit Log (who did what).
2. You are notified of supplier cost changes.

## Admin (Owner)
<!-- role: ADMIN -->
You see and can do everything. You are the final approver.

1. **Approvals Waiting for Me:**
   - **New master data:** products, suppliers, customers, branches, accounts, employees, user accounts and imports that others entered.
   - Transfers to franchises, special prices, price changes and period locks.
   - More days to deposit cash (with the Head Auditor).
   - **Consignments** (final approval after the manager's check) and **cost changes** typed by the Head Auditor.
   - Use **Approve selected** for many at once.
2. **Users & Roles:** create accounts (one per person), change roles and branches, tick extra permissions, reset passwords. Your own new records are created at once.
3. **Deleting:** only you delete products and back-office data. A record already used is archived instead.
4. **Consignees** (Catalogue → Consignees):
   - **New consignee:** name, who pays at (retail price, consignee price or agreed cost), payment terms, contact and address. The stock location, customer, receivable account and agreement are created in one step.
   - Add suppliers who consign goods to GWS on the same page.
5. **Cost and days to consume:** edit a product's cost directly (the Head Auditor approves) and its days to consume.
6. **Customer messages** (Settings): write the SMS and email sent to customers who may have finished their supplements, and switch automatic sending on or off.
7. **Settings & Company Letterhead:** thresholds, automatic posting, and the letterhead and logo on every form.
8. **Watching:**
   - The dashboard shows cash on hand per branch, branches without today's report, discrepancies and price updates (cost included).
   - HR Notices are visible to you too.
9. **Reports:**
   - **Monthly Sales Performance:** every branch's month-to-date running total in its own colour, the company total, and each month of the year.
   - **Sales Report:** any branch or all, any period, with gross profit.
   - Financial Statements, all branch reports with margin, and the Audit Log.

## Other users (custom permissions)
<!-- role: CUSTOM -->
Your screens depend on the permissions the Owner ticked for you. Under **More topics for my role** you will find the step-by-step sections for each screen you can open. Ask the Owner if you need another screen.
