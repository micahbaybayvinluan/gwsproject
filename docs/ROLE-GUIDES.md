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

**Recording a sale** (menu: New Sale)
1. Type the **DR / SI number** from the paper receipt.
2. Choose the **channel** (walk-in, delivery, franchise, dealer, agent, shipping) and the **payment mode**.
3. Add the items: type the name or SKU, or scan the barcode. Only items your branch has on hand are listed, with the quantity. Freebies are added at ₱0.
   - If the item has more than one **flavor or expiry date**, choose the one you are giving the customer (the oldest is listed first). The line shows the flavor, expiry and how many are left of it.
4. Payment details:
   - **Online (bank / GCash):** choose the account that received the money (for example **Gcash (GWS)**) and upload the screenshot.
   - **Credit card:** choose the account, then type MID, slip no., approval code and batch no., and upload the slip.
   - **AR / PDC (credit):** choose the customer and the due date; add the cheque details if any.
   - **Delivery:** choose the rider and type the delivery fee.
5. **Incentive paid from the sale:** press **+ Add incentive expense**, choose the type (sales or rider/driver), who receives it and the amount. It is taken from the cash to deposit and recorded as your branch's expense.
6. A price lower than the list price is a **special price**: it is saved, and the Owner approves it.
7. Press **Review sale**. Check every detail on the review screen (items, flavor / expiry, quantities, prices, payment, customer, total), then press **Confirm and save sale**, or **Go back and edit**. Stock is deducted at once.

**Mistakes on a sale**
- Before today's report is submitted: open the sale in **Sales List** and **Void** it with a reason, then record it again.
- After the report is submitted (or on an earlier day): on **Daily Close & Deposit** or **Daily Sales Report**, use **Change a closed day**: choose the date, the sale or expense, then *Correct details* or *Void it*, and the **reason** (required). The card shows who approves it (the Head Auditor and the Asst Auditor; at a franchise, the owner).
- HR and the Head Auditor are told of every post-close edit. **Three in one month, or three days in a row, is flagged** and may be referred to the Owner as negligence of duty, so review the report well before submitting. Every approved correction is logged against the person who made the document.

**Expenses** (menu: Expenses)
1. Choose the account (for example Meralco, Water), the payee and the amount.
2. Choose where the money came from: **Cash on hand** (the sales cash not yet deposited; it lowers the cash to deposit) or **Cash fund**.
   - The screen shows how much cash on hand the branch has. If the expense is more than that, a notice pops up and nothing is saved: pay it from the cash fund, or ask Accounting to pay it from the bank.
3. Attach the receipt.

**Cash fund** (menu: Petty Cash Fund)
- Expenses paid from the fund lower its balance.
- Press **Replenish from today's cash sales** to top it back up; this lowers today's cash to deposit.

**Customer credit and collections** (menu: Customer Credit)
- Tick the invoice, type the amount received and send it. It waits for Accounting's approval before the balance goes down.
- **Selling on credit (New Sale → payment "AR / PDC"):** choose whether the customer is a **Dealer**, **Franchisee**, **Agent** or **Other customer**; only that kind is listed. Type the due date. Tick **There is a PDC** only when the customer gave a post-dated cheque, then type the bank, cheque no. and cheque date.
- Every morning you are reminded of your branch's receivables that are overdue or due within 7 days, nearest due first. The dashboard lists them the same way.
- If Accounting rejects a payment you entered, the notification gives the reason (for example "Wrong amount"). Fix it and send the payment again.
- **Credit from before GWS-ERP:** Accounting enters it and the Owner approves it. It then appears in your AR & Collections (you are notified) and is collected like any credit sale.

**Stock**
1. **Asking for stock:** in Transfers & Pull-outs, press **Request stock from the warehouse**, add the items and send.
2. **Receiving a delivery:**
   1. Open the incoming transfer.
   2. Tick each line that arrived complete. For a line that did not, type the quantity you actually got and what is wrong (for example **1** of 2, "only 1 in the box").
   3. An item that arrived but is **not on the form**: press **+ An item arrived that is not on the form**, pick it and type the quantity.
   4. Press **Confirm receipt**. Only what you received goes into your stock.
   5. If there is a difference, the steps start by themselves (see **When the received quantity is different** below). You are told of each step.
   - **Finding a transfer:** use **View** (Outgoing pull-outs or Incoming transfer-ins) and **Branches** (tick the branches to see; none ticked = all). Franchises are marked "(franchise)" in every list.
3. **Returning stock:** prepare a pull-out to the warehouse. The "From" is always your branch. Choose the flavor / expiry of each item.
   - **Stock without a flavor** (from before flavors were recorded): Stock on Hand → Batches → **Set flavors**, split the quantity by flavor and save. The item's total does not change.
4. **Expired or damaged items:** keep them apart and tell the auditors (or return them to the warehouse on a pull-out). Write-offs are decided by the auditors, not the branch.

**When the received quantity is different**
1. The **Head Auditor** checks the difference first.
   - Confirmed: the sending branch is asked to agree.
   - "Receiver miscounted": you get the items as on the form. Count again.
2. The **sending branch** agrees or disagrees within **2 days**. If they do not answer, or they disagree, the **Owner** decides.
3. When the difference is confirmed, an adjustment form is made automatically with the same number plus **-002** (for example WH-PO-000012-002). It returns the missing items to the sending branch's stock; items received that were not on the form get a **-003** form. The original form stays as it was.
4. HR is told of every case.

**Items your branch sent that were not received as on the form** (menu: My Approvals)
- The receiving branch reported a difference and the Head Auditor confirmed it. Check your shelves and packing, then **Agree** (the -002 form is made) or **Disagree** with a note (the Owner decides). Answer within 2 days; a reminder comes after 1 day.

**Weekly count sheet** (menu: Stock Counts)
1. Press **Start my weekly count sheet**. Every item is listed:
   - first the items the system has at your branch, with their beginning count;
   - then the items not in the system.
2. Type the **actual count** for every item in the first group. In the second group, type a number only if you find the item; blank means none.
3. You may **Download sheet (xlsx)**, fill the "Actual count" column on paper or in Excel, and **Upload filled sheet**.
4. Press **Submit count**. The sheet is locked; a correction needs the Head Auditor's approval.
5. If there are differences, a **discrepancy case** opens. You, the auditors, the Owner and HR are notified.
6. You have **7 days** to press **Explain** on the case. If your explanation is accepted, nobody is charged. If there is no explanation, or it is rejected, the shortage is charged at franchise price and HR splits it among the staff.

**End of the day** (before 8 PM)
1. **Daily Close & Deposit:** count the money by denomination and save the count. A shortage may be charged to the staff on duty.
2. **Daily Sales Report:** review every number on the screen, or open **Review report (Excel)** / **Review report (PDF)**, and compare it with your DR/SI slips, card slips, receipts and the cash you counted.
3. Press **Submit today's report…**. Tick each item of the review list (sales, card and online payments, expenses, money breakdown), tick **"I acknowledge that this Daily Sales Report is true and correct"** and press **I agree — submit**. Today is then closed for your branch; later changes need a revision request.
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
- **Sales Graphs:** a graph of your branch's sales this month so far and month by month this year.

**Customers who may have finished their supplements** (menu: Customers & Follow-ups → Re-order follow-ups)
1. When a customer with a contact number or email buys a product that has "days to consume", a reminder is set for the day it is probably finished. That morning you are notified.
2. Open **Re-order follow-ups**: call the number (tap it on a phone), or press **SMS** / **Email**. The Owner's message is filled in; you may edit it before sending.
3. Press **Contacted** after you reach the customer, or **Dismiss** if it no longer applies.
4. The customer list also shows the **items each customer ordered**.

**Consignment** (menu: Consignment)
1. **Send goods to a consignee:**
   1. Choose the consignee (the Owner creates them) and add the items.
   2. **Save draft**, **Print draft** if needed, then **Submit for approval**.
   3. The Head or Asst Auditor checks it first, then the Owner approves. Stock leaves your branch only after the Owner's approval.
2. **Record consignee sales:**
   1. Choose the consignee and the period, then add the items sold.
   2. Prices are filled in from the agreement and you may edit them.
   3. **Print draft**, then **Submit for approval**: auditor first, the Owner last. The consignee then owes the amount.
3. **Goods returned by a consignee:** choose the consignee, the items and your branch → save, print, submit. After approval, confirm the goods when they arrive.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

**6-Pack Card stickers (customers who buy six supplements):**
1. On **New Sale**, tick **“6-Pack sticker given”** and type the customer's **full name and mobile number**. One sticker is recorded for each supplement on the DR; the DR shows ☑ and the customer is tagged. A voided sale takes its stickers back.
2. When the customer has six stickers (from any branch), open **6-Pack Card → Redeem a card**: type the mobile number and press **Find** (it shows the sticker balance), complete the **name, email and address**, and press **Redeem**. The ₱300 becomes your branch's **6-Pack Card** expense, paid from the cash on hand, so the cash to remit goes down by the discount.
3. A customer with an old paper card: tick “old paper card”, type its number and attach a photo. The auditors and the Owner are told.
4. The dashboard shows today's stickers and cards.

**Prices:** a sale paid by **credit card** uses the credit-card price (SRP ÷ 0.96, see the price memo) by itself; a TikTok, Shopee or Lazada sale uses that platform's price list.

**Selling to a franchise** (also from the Warehouse store): New Sale → channel **FRANCHISE** → choose the franchisee. The franchise price fills in by itself and may be changed. Plastic bags are charged to franchises (L ₱4, M ₱3, S ₱3, XL ₱5); for stores and other customers they are free unless you type a price because they were sold. Choose **Shipping charged to the franchise: To follow** so the Franchise Coordinator fills the amount within 2 days (it becomes a separate franchise invoice), or type the amount now.

**Returns and give-outs:** when a customer brings back an item, open a **Replacement Ticket** (find the DR) and photograph the item; any other branch can tick it once the replacement is given. To give stock to **Prothin Marketing, GWS Marketing or BO**, use Transfers & Pull-outs (To → Stock given out); the Head Auditor approves. An unfinished draft can be deleted with **Delete draft**; the numbers adjust by themselves.

## Warehouse Associate
<!-- role: WAREHOUSE_ASSOCIATE -->
You enter what comes into and goes out of the warehouse. You never see supplier cost. Your entries are checked by the Warehouse In-Charge before stock changes.

**Supplier deliveries** (menu: Supplier Deliveries)
1. Press **New**, then choose the supplier (by code) and type the supplier's invoice / DR number.
2. For each item, type:
   - **Qty** (bought);
   - **Free (freebie)**: items the supplier gave free, which are recorded as Other Income;
   - **Flavor** (choose from the list or type a new one), **Expiry** and **Batch #**.
3. Same item in two flavors or with two expiry dates: press **+ another flavor / expiry** and split the quantity. The item is still counted as one SKU; each flavor is chosen when it is sold or moved.
4. Under **Upload Supplier Delivery Receipt**, take a photo (or choose the PDF) of the supplier's DR / invoice, then press **Create draft** and **Submit**. The receipt is kept with the delivery; more files can be added on its page.
5. Approval steps:
   1. The **In-Charge** checks the goods against the supplier's delivery receipt and approves ("1. Waiting for the In-Charge to check the goods").
   2. The **Head Auditor** approves the cost ("2. Goods checked · waiting for the Head Auditor's cost approval").
   3. Only then is the stock added to the warehouse.

**Sending stock out** (menu: Transfers & Pull-outs)
1. Prepare a pull-out to a branch or franchise. Only items the warehouse has are listed. For an item with several flavors or expiry dates, choose which one to send (the oldest is listed first).
2. Print the draft if needed, then **Submit**.
3. Approval steps: the In-Charge approves first, then the auditors (between company locations) or the Owner (to a franchise). The receiver confirms what arrived.
4. **Branch requests:** when a branch asks for stock, the notification opens the transfer with that branch already chosen.

**Stock returned to the warehouse**
- Confirm what arrived. Your confirmation waits for the In-Charge before stock is added.

**Edits by the In-Charge**
- When the In-Charge changes one of your documents, it appears in **My Approvals**. Accept or reject the change.

**Weekly count**
- Same as every associate: **Stock Counts → Start my weekly count sheet**. Type the actual counts and submit.
- Differences open a case with 7 days to explain.

**Consignment** (menu: Consignment)
- **Send goods to a consignee**, **record consignee sales** (prices filled in from the agreement, editable) or **take goods back**.
- Always save and print the draft first, then submit. The Warehouse In-Charge checks it first; the Owner approves last.

**Your pay:** My Pay & Charges.

## Warehouse In-Charge
<!-- role: WAREHOUSE_IN_CHARGE -->
You are responsible for the warehouse stock. You check your associates' entries, and you enter receiving and transfers yourself.

**Approving your associates' goods in and out** (menu: My Approvals)
- **Goods into the warehouse:**
  - **Supplier deliveries** entered by an associate come to you **first**. Check the goods and quantities against the supplier's delivery receipt, then **Approve** (it goes to the Head Auditor for the cost; the stock is added after that) or **Reject**.
  - **Stock returned to the warehouse** (transfers in): check and **Approve**; the stock is added.
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

**Transfers received with a different quantity**
- When a branch receives less (or more) than your form, the Head Auditor checks it first, then it comes to you in **My Approvals**. Check the shelves and the packing, then **Agree** or **Disagree** with a note within **2 days**. Agreeing makes the **-002** adjustment form automatically; disagreeing sends it to the Owner.
- Goods you receive work the same way: tick what arrived, type the actual quantity of short lines, and add items that are not on the form.

**Counts and write-offs**
- Count the warehouse (Stock Counts).
- Write off expired or damaged stock; the Head Auditor approves.
- Explain discrepancies within 7 days.

**E-commerce (TikTok, Shopee, Lazada)**
- **E-commerce pull-outs** come to you in Approvals. They were drafted automatically from the platform's order file.
  1. Open the pull-out and print the picking list (oldest expiry first) with the orders and tracking numbers.
  2. Pick and pack, count the items against the list, then **Approve**. You are the only approver.
  3. The items leave the Warehouse and wait in "TikTok / Shopee / Lazada – with courier" until the platform pays.
- **Returned parcels** (menu: E-commerce → Returned parcels to receive):
  1. Open each parcel and type how many items are **good** and how many are **damaged or expired**.
  2. Press **Receive**. Good items go back to Warehouse stock. Damaged items come in and a write-off goes to the Head Auditor.

**Flavors:** set the flavor of old warehouse stock on Stock on Hand → Batches → **Set flavors**. Deliveries record the flavor per line.

**Finding transfers:** Transfers & Pull-outs → **View** (pull-outs or transfer-ins) and **Branches**: tick the branches to see, for example only the franchises you send to. Franchises show "(franchise)" beside the name.

**Reports:** Stock on Hand, Inventory Reports (quantities only).

## Head Auditor
<!-- role: HEAD_AUDITOR -->
New approvals for you: **stock given out to Prothin Marketing / GWS Marketing / BO** (you may also endorse an approved one to Accounting as an expense), **a replacement given to a customer** (price difference shown), and **items returned to a supplier**. Replacement Tickets lists every ticket; Marketing & BO Pull-outs summarises what was given out. In the Daily Inventory Report press a figure to see the forms behind it.

You approve costs and most corrections, audit the branches, and watch the cash.

**Every day: My Approvals**
- **Receiving cost:**
  1. Deliveries entered by a Warehouse Associate reach you after the In-Charge has checked the goods (your approval is the last step).
  2. Open the delivery and check or type the unit cost of each line (freebies included). **New products need a cost before you approve**; if one is missing, the system tells you and the delivery stays in your list.
  3. Approve: the stock is added. An unchanged cost approves by itself after 24 hours.
- **Transfers between company locations:** you or the Asst Auditor (either one).
- **Post-close edits of company branches:** you **and** the Asst Auditor (both). You are also told of every request with the person's count this month; three in a month (or three days in a row) is flagged for HR to refer to the Owner.
- **Transfer received with a different quantity:** open it (the transfer page shows the form quantity, what was received and the note). **Confirm the difference** sends it to the sending branch; **Receiver miscounted** gives the receiving branch the items as on the form.
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
- **Flavors:** list the flavors of a SKU on the product (for example Choco, Vanilla). New flavors typed at receiving are added by themselves.
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

**Franchise AR and memos:** **Franchise AR** shows every franchise's invoices; you are told of every payment, change, extension request and two-month flag. You may write memorandums (**Memorandums**).

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

1. Read the Daily Sales Reports, inventory reports and documents of any branch.
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
   1. Stock Counts → choose the branch, franchise or warehouse → **Create count sheet**.
   2. Every item is listed, the ones in the system first. Type the actual counts and **Submit count**.
   3. Differences open a case. The branch staff, the auditors, the Owner and HR are notified, and the branch has 7 days to explain.
2. **Cash fund check:** Petty Cash Fund → choose the branch → type the cash found → **Confirm count**.
3. **Store inspection report:**
   1. Store Inspections → **New** → choose the branch and the staff on duty.
   2. Fill the 19 checklist items and add comments.
   3. Press **Submit to HR**. The staff member acknowledges it and HR reviews it.

## Franchise Sales Associate
<!-- role: FRANCHISE_SALES_ASSOCIATE -->
You sell at a franchise. You never see franchise cost.

1. **Sales:** record each sale in **New Sale** the same way as a branch associate. You cannot change prices.
2. **Deliveries from GWS:**
   - If your franchise owner allows it, open the incoming transfer, tick what arrived and **Confirm**. The owner is notified.
   - If not, only the owner confirms.
3. **Weekly count:** Stock Counts → **Start my weekly count sheet** → count → submit. Differences open a case with 7 days to explain.
4. **Your pay:** My Pay & Charges shows only your own salary and charges, set by your franchise owner.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## Franchise Owner
<!-- role: FRANCHISE_OWNER -->
You run your franchise. Everything you see is limited to your own branch (every sale, transfer, expense and invoice of your franchise, and no other), and you create your own sales and expenses. Your books are separate from the other GWS branches. Shipping that GWS charges you for a sale appears on **Franchise AR** as its own invoice.

1. **Franchise Portal → Overview:** stock, incoming deliveries, today's sales and what you owe GWS.
   - Switch **"associate may receive stock"** on or off. With it on, your associate confirms deliveries and you are notified.
2. **Staff pay & charges:**
   - Record each associate's salary; it becomes your franchise expense, and only you see it.
   - Create charges for your own staff and branch. GWS HR has no access.
3. **Income statement & balance sheet:** choose the dates. Only your branch is included.
4. **Expenses:** add franchise expenses (rent, utilities…); they appear in your statements.
5. **Corrections:** post-close edits at your franchise come to you for approval.
6. **Prices:** Price updates on your dashboard show only your franchise price.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

**Franchise AR (what you owe GWS):** open **Franchise AR**. Every delivery is billed at the franchise price when you receive it and is due 30 days later. After the due date a **2% penalty (once) and 0.1% a day** on the unpaid balance are added (memo of July 31, 2026). You can see each invoice, how the amount is worked out, your payments and any changes.
- **Changes:** if the quantities change after receiving (a difference is resolved by the auditors / Owner), your invoice changes by itself and you, the Owner, auditors, Accounting, the Franchise Coordinators and the sales associates involved are notified.
- **Need more time?** Press **Ask for extension**, choose the new date and give the reason. The Owner decides; the auditors, Accounting and the Franchise Coordinators are flagged. No new penalty or interest is added until the new date.
- Unpaid two months after the due date, the account is flagged and the company may issue a demand, suspend credit, or ask for cash before delivery.
- Sales paid by credit card are priced at the credit-card price automatically.

## Accounting Head
<!-- role: ACCOUNTING_HEAD -->
You accept **pull-outs endorsed as an expense** (booked at cost) and are told of every replacement ticket, price difference and supplier replacement (Replacement Tickets, Marketing & BO Pull-outs).

You keep the books.

1. **Journal Entries:** every entry links to its source document. Automatic posting is switched on in Settings.
2. **Correcting an entry:**
   1. Open the voucher and press **Edit entry**.
   2. Change the lines: they must balance, no negatives, and the period must be open.
   3. Give the reason. The maker, the source document's maker and the Owner are notified, and the change is logged.
3. **Trial Balance**, **Periods & Opening** (request a period lock; the Owner approves) and **Inventory Cost**.
4. **AR payments** entered by branches wait for you or the Accounting Associate in **My Approvals**. Each one shows the customer, the amount, how it was paid, the **account it was deposited to**, the invoices and the **proof of payment** (click the picture to enlarge it).
   - **Approve** when the money is in the account.
   - **Reject** asks for the reason: wrong amount, wrong proof, proof unclear, money not received, wrong account, wrong customer or invoice, duplicate, wrong date, cheque bounced or not cleared, or another reason you type. The branch sees it.
5. **Agent incentives** (menu: Agent Incentives): approve the monthly incentive the Sales Manager confirmed (in My Approvals, with the Accounting Associate; the Owner approves last). When HR has the agent's signature, press **Tag as released**: how it was paid (bank transfer, GCash, cheque or cash), the account, the reference and the date.
6. **Opening AR (credit from before GWS-ERP)** (menu: AR & Collections → Opening AR):
   1. Press **+ Enter opening AR**. Choose the branch, the customer type (Dealer, Franchisee, Agent or Other) and the customer.
   2. Type the DR / SI no., the invoice date, the due date and the balance still owed. Tick **There is a PDC** only if there is a cheque, then type the bank, cheque no. and date.
   3. Press **Send for the Owner's approval**. Enter the next one; the branch, type and date stay filled in.
   4. After the Owner approves, it appears in that branch's AR & Collections and the branch is notified. Rejected entries show the Owner's reason.
   - Many invoices at once: Imports → **Open AR** (same approval).
   - It is not posted to the books again: the AR beginning balance is already in Periods & Opening.
7. **Payroll:** close HR's finalized runs by choosing the paying bank account.
8. **Bank & Office:** record main bank transactions, with the bank or **Gcash (GWS)** account and the book they belong to.
9. You are notified of supplier cost changes.
10. **E-commerce payouts** (TikTok, Shopee, Lazada) come to you in Approvals.
   1. Check that gross sales − seller discounts − fees − refunds − withholding tax = the payout. **Open full document** shows the order list and any orders left out.
   2. Compare the payout with the platform wallet or the bank, then **Approve**.
   3. The sale, each fee, the creditable withholding tax and the payout (to the platform's cash account) are posted, together with the cost of goods sold.
   - When the money is withdrawn to the bank, record the transfer in Bank & Office.
   - E-commerce → **All platforms: profit report** compares TikTok, Shopee and Lazada.

**Franchise AR:** open **Franchise AR** to see each franchise's invoices, penalty and interest. Press **Record payment** when a franchise pays: choose how it was paid, the account it went to and the reference. The payment settles the penalty first, then the interest, then the goods. Everyone concerned is notified. Old franchise balances are entered through **AR / Credit → Opening AR** (kind Franchisee); they become franchise invoices.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## Accounting Associate
<!-- role: ACCOUNTING_ASSOCIATE -->
You accept **pull-outs endorsed as an expense** in My Approvals (booked at cost) and are told of every replacement ticket, its price difference and when it is settled (Replacement Tickets, Marketing & BO Pull-outs).

1. **AR payments** entered by branches: approve or reject them in My Approvals.
2. **Agent incentives:** approve them in My Approvals, and **Tag as released** on Agent Incentives once paid (mode, account, reference, date).
3. **Opening AR (credit from before GWS-ERP):** AR & Collections → Opening AR → **+ Enter opening AR** for any branch (branch, customer, DR / SI, invoice date, due date, balance, PDC if any) → **Send for the Owner's approval**. Once approved it shows in the branch's AR.
4. **Journal Vouchers:** view entries and correct them with **Edit entry** (balanced, no negatives, open period). The people involved and the Owner are notified.
5. **Bank & Office:** record bank transactions and see balance-sheet account balances.
6. **Payroll:** you see totals only. Record government contribution payments.

**Franchise AR:** open **Franchise AR** to see each franchise's invoices, penalty and interest. Press **Record payment** when a franchise pays: choose how it was paid, the account it went to and the reference. The payment settles the penalty first, then the interest, then the goods. Everyone concerned is notified. Old franchise balances are entered through **AR / Credit → Opening AR** (kind Franchisee); they become franchise invoices.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## HR Staff
<!-- role: HR_STAFF -->
You handle people: employees, accounts, pay, charges and notices. You have no access to inventory, sales or franchise payroll.

1. **New employee** (Payroll → Employees → Add employee):
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
5. **Staff Charges:**
   - Charges from discrepancies, write-offs and cash shortages arrive here automatically.
   - Split each one between the staff, set the pay periods and **Finalize**.
   - Print the Charge Form and the Salary Deduction Authorization.
6. **HR Notices (NTE):** when a branch did not deposit its cash on time, a notice lists the amount, the dates and the staff on duty.
   - Issue the NTE, then **Mark NTE issued**; **Close** it when settled.
7. **Post-close edits:** each one a branch person asks for comes to HR Notices (one notice per person per month, with the list and the reasons). From the **third in a month, or three days in a row**, it is marked red: press **Refer to the Owner**.
8. **Transfer differences:** every confirmed difference between a transfer form and what arrived comes to HR Notices with the person answerable (who prepared the form, or the receiver who miscounted) and how many cases they had in 30 days. The Owner decides any action.
   - From the **third** case of the same person in 30 days, the notice is marked in red: press **Refer to the Owner** for a more serious consideration.
9. **Agent incentives** (menu: Agent Incentives): when the Owner approves an incentive, its release form (AI-000001…) comes to you. **Print form**, have the agent sign it, then press **Agent signed**. Accounting then releases the payment and tags it.
10. **Watching:**
   - Weekly Count Check shows who did not submit a count sheet.
   - You are notified of count discrepancies, explanations and Daily Sales Reports not submitted by the cut-off.
   - The Error Log shows errors per staff member.
   - Review store inspection reports.

**Memorandums:** open **Memorandums → Write a memo**: choose who it is for (everyone, franchise owners, franchise associates, a role, a branch or named people), type the subject and the memo, add a table if needed and add the people who sign. The memo gets its number by itself (2026-Q3-046) and everyone addressed is notified and confirms reading. Print it on the company letterhead with **Print / download PDF**.
**New users and employees:** you are notified whenever the Owner or anyone opens a user account or an employee record, so HR always knows who is in the system.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## Executive Assistant
<!-- role: EXECUTIVE_ASSISTANT -->
You record main office bank transactions. You do not see cost, branch reports or income.

1. **Bank & Office → Bank entries:**
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
New this month: **Users & Roles has a search box** (name, username, role, branch, ID). You are told of every replacement ticket and of marketing / BO pull-outs, and may decide anything the Head Auditor decides. Unfinished drafts can be deleted by you.

You see and can do everything. You are the final approver.

1. **My Approvals:**
   - **New master data:** products, suppliers, customers, branches, accounts, employees, user accounts and imports that others entered.
   - Transfers to franchises, special prices, price changes and period locks.
   - More days to deposit cash (with the Head Auditor).
   - **Consignments** (final approval after the manager's check) and **cost changes** typed by the Head Auditor.
   - **Transfer differences** the sending branch disagrees with or did not answer in 2 days: open the transfer and choose: the difference stands (-002 form back to the sender), received after all, lost as a company expense, or lost and charged to staff.
   - **Sales targets** set by the Sales Manager.
   - **Opening AR** (credit from before GWS-ERP) entered by Accounting: check branch, customer, DR / SI, dates and amount, then approve. It then appears in that branch's AR and the branch is notified.
   - **Anything waiting with someone else:** tick **Show everything waiting**. As the Owner you may approve any request; your decision is final (the workflow shows "Owner (final)").
   - **Agent incentives** after the Accounting Associate and the Accounting Head.
   - **Faster approvals:** every group has **Tick all** and **Approve all**; **Select all** at the top ticks everything, then **Approve selected**. Each item still shows its own result (for example a delivery whose new product needs a cost stays in the list).
2. **Users & Roles:** create accounts (one per person), change roles and branches, tick extra permissions, reset passwords. Your own new records are created at once.
3. **Deleting:** only you delete products and back-office data. A record already used is archived instead.
4. **Consignees** (Catalogue → Consignees):
   - **New consignee:** name, who pays at (retail price, consignee price or agreed cost), payment terms, contact and address. The stock location, customer, receivable account and agreement are created in one step.
   - Add suppliers who consign goods to GWS on the same page.
5. **Cost and days to consume:** edit a product's cost directly (the Head Auditor approves) and its days to consume.
6. **Customer messages** (Settings): write the SMS and email sent to customers who may have finished their supplements, and switch automatic sending on or off.
7. **Settings:** thresholds, automatic posting, and the letterhead and logo on every form.
8. **Watching:**
   - The dashboard shows cash on hand per branch, branches without today's report, discrepancies and price updates (cost included).
   - HR Notices are visible to you too.
9. **Reports:**
   - **Sales Graphs:** every branch's month-to-date running total in its own colour, the company total, and each month of the year.
   - **Sales Report:** any branch or all, any period, with gross profit.
   - Financial Statements, all branch reports with margin, and the Audit Log.
10. **E-commerce** (menu: E-commerce):
    - **All platforms: profit report** shows TikTok, Shopee and Lazada side by side: net sales, each fee, ads, cost of goods and the profit before overhead.
    - Overdue orders (shipped but neither paid nor returned) reach you every Friday.
    - The E-comm Associate's account is created in Users & Roles with the role **E-comm Associate** (no branch).

**Pricing (new):** **E-com & Card Prices** holds the credit-card price rule (fee % and whether it is SRP ÷ (1 − %) as in the price memo, or SRP + %) and the TikTok / Shopee / Lazada price lists from the masterlist; change any price or import the masterlist again. Lazada follows Shopee until it has its own prices. Amounts keep their centavos.
**E-com Margin Analysis (new):** each platform's fees and charges, ads, cost of goods and the margin left against your target; for every product the margin at the platform price and the price that keeps the target. Add ad expenses at the bottom of the page.
**Franchise AR:** record waivers of penalty / interest, decide extension requests (in **Approvals**) and put a franchise on cash-before-delivery. **Memorandums:** yours always carry AL MARVIN VINLUAN (President) and MICAH VINLUAN (Manager). Adding an employee or a user notifies HR.

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## E-comm Associate
<!-- role: ECOMM_ASSOCIATE -->
When you search for a product on the E-commerce pages, the products that have a **TikTok, Shopee or Lazada price come first**; those with no platform price are listed at the bottom.

You run the online shops: **TikTok Shop, Shopee and Lazada**, each on its own tab. E-commerce has no stock of its own: every item comes from the Warehouse, and the Warehouse In-Charge approves each pull-out. You see selling prices and platform fees, never cost.

**Every morning: orders to ship → pull-out** (menu: E-commerce → choose the platform → 1. Orders → pull-out)
1. In the platform's seller centre, open the orders **to ship** and **Export** them (Excel or CSV). A waybill list export works too.
2. Press **Choose file and upload**.
   - Every new order goes on one **draft pull-out** from the Warehouse. Items are totalled by SKU and the oldest expiry is picked first.
   - Orders already uploaded and cancelled orders are skipped, so an order is never pulled out twice.
3. **New SKUs:** when the platform's Seller SKU is not the GWS SKU, pick the matching GWS product once. The match is remembered (tab **SKU matches**). Then press **Upload the same file again**.
4. **Not enough stock** in the Warehouse: those orders are listed and not added. Upload the file again when stock arrives.
5. Open the draft:
   - Remove an order that was cancelled (the items are re-totalled).
   - **Print picking list**: items, batches, expiry, and the orders with their tracking numbers.
   - Press **Submit to the Warehouse In-Charge**.
6. When the In-Charge approves, you are notified. Hand the parcels to the courier with their waybills. The orders are now **Shipped, not yet paid**.

**Each payout (usually weekly):** (tab: 2. Payouts)
1. In the seller centre, open **Finance** (TikTok: Statements; Shopee: Income; Lazada: Transaction overview) and export the payout.
2. Upload it. GWS-ERP reads the sale, each fee (commission, transaction or payment fee, shipping, affiliate commission, other fees), refunds, the withholding tax and the payout of every order.
3. Check the summary:
   - The payout must equal the money the platform released (**✓ Net sales − fees − refunds − tax = payout**).
   - Orders not in GWS-ERP (for example shipped before you started using it), not shipped yet, or already paid are listed apart and left out. Tick **Also book orders not in GWS-ERP** before uploading if you want their money booked (no stock moves).
4. Press **Send to Accounting**. The Accounting Head approves, and then the sale and the fees are posted.
- If your file does not read well, download the **GWS payout template**, copy the amounts into it and upload that.

**When a parcel comes back** (tab: 3. Returns)
1. Scan or type the **order ID or tracking number** and choose the reason (failed delivery or buyer return), then **Record the return**.
2. Give the parcel to the Warehouse In-Charge. The In-Charge marks each item good (back to stock) or damaged (write-off).

**Every month: ads** (tab: 4. Ads)
- Download the ads billing / invoice from the platform's ads centre and upload it. Amounts are added up per month.
- Or type the month and amount.
- Choose how the ads were paid: from the platform balance (deducted from sales) or by a bank or card account.

**Every Friday: Order tracker**
- Filter **Overdue**: orders shipped more than 30 days ago and neither paid nor returned. Follow each one up with the platform, or file a lost-parcel claim. You are reminded every Friday.

**Report** (tab: All platforms: profit report)
- Choose the dates. It shows TikTok, Shopee and Lazada side by side: net sales, each fee, ads, what is left after fees and ads, fees as % of sales, return on ad spend, returns and payouts.

The platform price lists (TikTok, Shopee, Lazada) are set by the Owner in **E-com & Card Prices**; you see the platform prices for your own work. Change your password with the key icon at the top right.

## Sales Manager
<!-- role: SALES_MANAGER -->
You follow the sales of every branch, agent and e-commerce platform, and you set the monthly targets. You never see cost, margin, supplier data, cash counts, payroll or the books, and you do not record sales or money.

**Every morning** (menu: Dashboard)
- **Sales vs target this month**: how much of the company target is done, compared with how much of the month has gone.
- **Receivables by due date**: dealers, franchises and agents who have not paid, the nearest due first.

**Setting targets** (menu: Sales Targets)
1. Choose the month.
2. Under **Set a target**, choose a branch or an agent, type the target sales in pesos and an optional note.
3. Press **Send for the Owner's approval**. The target applies once the Owner approves; until then it shows "waiting for the Owner".
4. To change a target, send a new one; the approved one is replaced when the Owner approves the new one.

**Following achievement** (menu: Sales Targets)
- Each branch and agent shows its target, the sales so far and the % achieved.
- The dark line on each bar is how much of the month has gone. **Green** = on track, **amber** = slightly behind, **red** = behind.
- An agent listed at several branches counts as one person: all their sales add up.

**Agent incentives** (menu: Agent Incentives)
1. Choose the month. Each agent's total sales (every branch), what is collected and what is unpaid are listed.
2. Type the incentive as a % of sales or as an amount and press **Confirm**.
3. It goes to the Accounting Associate, the Accounting Head and the Owner. After the Owner approves, the release form goes to HR, and Accounting tags the payment. You are told at each step.

**Agent accounts** (menu: Sales Targets → Agent accounts)
- Link each agent to their **Agent** user account (the Owner creates it in Users & Roles). The agent then sees their own sales and target.

**Other screens (view only)**
- **Sales Report** and **Sales Graphs**: any branch and period; no profit or cost.
- **Sales List**, **Daily Sales Report**, **AR & Collections** (who owes what, due dates), **Customers & Follow-ups**, **Products & Prices** (selling prices only).

**Your password:** press the key icon at the top right (**Change my password**) any time. Your account is personal and you answer for everything done under it, so never tell your password to anyone, not even HR, your supervisor or the Owner. Nobody can see it.

## Agent
<!-- role: AGENT -->
You see only your own sales, wherever the items came from, and your own target. You never see cost or other people's sales.

1. **Dashboard:** your sales this month, % of your target, and how much your customers still owe.
2. **My Sales:**
   - Choose the month. Your sales at every branch are listed (date, branch, DR/SI, customer, how they paid, amount).
   - **My target** and **Achieved**: green when you are on track for the days gone, red when behind.
   - **Customers who have not paid yet**: nearest due date first; red = overdue. Follow them up and remind them of their PDC dates.
   - **This year, month by month**: your sales per month.
3. **Agent Incentives:** your incentive per month, its status (waiting for approval, with HR to sign, released) and how it was paid.
4. If My Sales says your account is not linked, ask the Sales Manager to link it.
5. **Products & Prices:** retail and agent prices.

## Franchise Coordinator
<!-- role: FRANCHISE_COORDINATOR -->
You look after the franchise partners. You never see cost.

1. **Franchise AR:** see each franchise's invoices, penalty (2% once) and interest (0.1% a day) after the due date, payments, changes and extension requests. You are notified of every event: new invoice, payment, change in quantities, extension request, overdue reminders and the two-month flag.
2. **Recommended process** (shown on the page): day 1 automatic notices; from day 7 call the owner and issue a notice memo; from day 30 the Owner reviews and may put the franchise on cash-before-delivery; at two months a demand memo and the actions the memo allows.
3. **Memorandums:** write memos to franchise partners and their associates. Choose the addressees, type the memo (a table is optional), add the signers. The memo is numbered by itself and everyone addressed is notified; print it on the letterhead. **Write the demand memo** on the Franchise AR page fills in the notice for you.
4. **Transfers and stock:** you can see what was sent to and received by each franchise, and the discrepancies.
5. **New Sale (franchises only):** record a sale to a franchise on credit or paid online, choosing the GWS branch or warehouse the goods come from. The franchise price and the plastic prices (L ₱4, M ₱3, S ₱3, XL ₱5) fill in by themselves and can be changed.
6. **Shipping charges to franchises:** on Franchise AR, **Fill in the amount** within **2 days** of the sale (a late one is flagged to you, the Owner, the auditors and Accounting every day). Filling it creates a separate franchise invoice. To change the amount afterwards, or to ask for more time, press **Ask to change / Ask for more time**: the Owner decides.
7. **Your password:** press the key icon at the top right. It is personal; never tell it to anyone.

## Asst. Franchise Coordinator
<!-- role: ASST_FRANCHISE_COORDINATOR -->
You help the Franchise Coordinator with the same screens: **New Sale** (franchise sales only), **Shipping charges to franchises** (fill in the amount within 2 days; ask the Owner to change it), **Franchise AR** (invoices, penalty, interest, extension requests, notifications), **Memorandums** (write, sign, track who has read them) and the franchise stock transfers. You never see cost. Change your password with the key icon at the top right.

## Other users (custom permissions)
<!-- role: CUSTOM -->
Your screens depend on the permissions the Owner ticked for you. Under **More topics for my role** you will find the step-by-step sections for each screen you can open. Ask the Owner if you need another screen.
