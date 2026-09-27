# E-commerce arm (TikTok Shop first, then Shopee / Lazada): recommended process, entries, reports and guide

**Status:** proposal for the Owner's approval. Nothing below is built yet. Once you approve it (and answer the questions in section 9), it can be added to GWS-ERP in the order shown in section 8.

## 1. The idea in one paragraph

E-commerce has **no stock of its own**. Every item still belongs to the **Warehouse** until the order ships.

1. The **E-comm Associate** uploads the platform's order / waybill file.
2. GWS-ERP turns it into a **draft E-commerce Pull-out** with every SKU and quantity to pick, and the orders and tracking numbers behind it.
3. The **Warehouse In-Charge** approves it (the only approval needed). The goods move to a "with the courier" holding place, not to a separate store.
4. When TikTok pays, the associate uploads TikTok's **settlement (finance statement) file**. GWS-ERP records:
   - the sale;
   - each TikTok fee (commission, transaction fee, shipping, affiliate commission, vouchers, withholding tax);
   - the money received.
5. **Ads** are uploaded monthly as an expense.
6. **Returns** come back into the Warehouse after the In-Charge checks their condition.

This is how the leading e-commerce accounting tools (A2X, Link My Books) handle marketplaces:
- they read the payout report and book one summary per settlement, split into gross sales, each fee type, refunds and tax;
- the books then tie to the bank without typing every order.

## 2. Why this design

- **No second inventory to count.** You have too many SKUs to keep an e-commerce stock. The Warehouse stays the only place stock is kept and counted.
- **One upload drives everything.** The associate never types SKUs by hand; the waybill / order export already has the Order ID, SKU, quantity and tracking number.
- **Fees are never guessed.** TikTok's payout is a *net* amount after fees, refunds, taxes and adjustments, so GWS-ERP books what TikTok's own settlement file says, line by line.
- **Every order is accounted for.** Each order is either settled (paid), returned, or flagged as missing. Nothing silently disappears between the warehouse and the customer.

## 3. The process, step by step

### 3.1 Daily: orders to ship → warehouse pull-out
1. **E-comm Associate:** in TikTok Seller Center, export the orders "To ship" (or print the waybills and export the list). The file has Order ID, SKU ID / Seller SKU, product name, quantity, shipping provider and tracking ID.
2. **GWS-ERP → E-commerce → Upload orders:** choose the platform (TikTok, Shopee, Lazada) and upload the file.
   - Each platform SKU is matched to the GWS SKU. The first time a SKU appears, the associate picks the matching product once, and the system remembers it.
   - Orders already uploaded are skipped (no double pull-out).
   - Waybill PDFs can be attached to the batch for reference.
3. GWS-ERP creates a **draft E-commerce Pull-out**:
   - totals by SKU, with the oldest expiry picked first;
   - a **picking list** to print;
   - the list of orders and tracking numbers it covers.
4. The associate checks the draft (removes a cancelled order if needed), prints it, and **submits** it.
5. **Warehouse In-Charge:** checks the picked items against the pull-out and **approves**.
   - Stock leaves the Warehouse and goes to **"E-commerce – with courier"**. This is a holding place, not a store.
   - No other approval is needed.

### 3.2 When TikTok pays: settlement upload → sale, fees, payout
1. **E-comm Associate** (weekly, or each payout): in Seller Center → **Finance → Statements**, export the statement.
   - TikTok's export has order-level lines: gross sales, fees, refunds, adjustments and the settlement amount.
   - It also has the payout record that ties the orders to the money received.
2. **GWS-ERP → E-commerce → Upload settlement.** For every order in the file, GWS-ERP:
   - records the **sale** (channel "Shipping – TikTok"), and the items leave "with courier" as sold (cost of sales at the batch cost);
   - books each fee to its own expense account: **commission, transaction fee, shipping fee / shipping-fee programs, affiliate (creator) commission, seller-funded vouchers, return shipping fees**;
   - books the **1% withholding tax** TikTok deducts on half of gross remittances (BIR RR 16-2023, once you pass ₱500,000 a year) as a tax credit you can claim, not as an expense;
   - books the **payout** to "Cash – Tiktok – Getwheysted (Platform)", then to the bank when you withdraw.
3. **Accounting Head:** checks the batch summary (gross sales − fees − refunds − tax = payout) against the bank / TikTok wallet and **approves** it. Only then are the entries posted.

### 3.3 Returns
- **Failed delivery / return to seller (RTS):**
  1. The associate records the returned order (scan or type the Order ID / tracking ID).
  2. The Warehouse In-Charge receives it and marks each item:
     - **Good** → back to Warehouse stock;
     - **Damaged / expired** → write-off, approved by the Head Auditor.
- **Buyer return and refund after delivery:** the settlement file shows the refund. GWS-ERP reverses that sale and waits for the goods to come back through the same In-Charge check.
- **Return shipping fee** (when the return is the seller's fault) is booked as an expense from the settlement file.

### 3.4 Monthly: ads
- Upload the **TikTok Ads Manager** billing / invoice file.
  - Ads paid by card or bank: the ads expense is booked against that account.
  - Ads paid from shop revenue ("GMV Pay"): TikTok deducts them from the payout, and the settlement upload books them.
- The report shows **ad spend vs. sales** (return on ad spend) per month.

### 3.5 Weekly control: orders not yet paid
The **E-commerce Order Tracker** lists every order pulled out, with how many days since it shipped:

| Status | Meaning |
|---|---|
| Shipped | Left the warehouse, not yet paid |
| Settled | TikTok paid it |
| Returned | Back in the warehouse |
| **Overdue** | Shipped over X days ago (for example 30) and neither paid nor returned |

Overdue orders go to the associate and the Owner to follow up with TikTok or claim for a lost parcel.

## 4. Accounting entries (example: one TikTok order, ₱1,000)

Assumptions: category commission 8%, transaction fee 2.24%, a ₱50 seller voucher, ₱40 seller shipping share, 1% withholding tax on half of gross.

| When | Debit | Credit | Amount |
|---|---|---|---|
| Pull-out approved | Inventory – E-commerce with courier | Inventory – Warehouse | cost, e.g. ₱600 |
| Settlement uploaded | Cash – Tiktok (Platform) | | ₱807.72 (payout) |
| | Commission expense – TikTok | | ₱76.00 |
| | Transaction fee – TikTok | | ₱21.28 |
| | Vouchers / discounts – TikTok (seller-funded) | | ₱50.00 |
| | Shipping expense – e-commerce | | ₱40.00 |
| | Creditable withholding tax (1% × ½) | | ₱5.00 |
| | | Sales – E-commerce TikTok | ₱1,000.00 |
| | Cost of sales – E-commerce | Inventory – E-commerce with courier | ₱600 |
| Withdrawal to bank | Cash in bank | Cash – Tiktok (Platform) | payout |
| Monthly ads | Advertising – TikTok Ads | Bank / credit card (or from payout) | ad spend |
| Return in good condition | Inventory – Warehouse | Inventory – E-commerce with courier | cost |

Rates change by category and program, so GWS-ERP never computes them itself: it uses the amounts in TikTok's own file. The rates in the example are only illustrations (Philippine commission is usually 5–10% by category; the transaction fee is 2.24% VAT-inclusive).

## 5. Reports (simple, one page each)

1. **E-commerce Profit & Loss** (per platform, per month, with the year to date):

   | Line | Amount |
   |---|---|
   | Gross sales (item price) | |
   | Less: seller vouchers and discounts | |
   | **Net sales** | |
   | Less: commission | |
   | Less: transaction fee | |
   | Less: affiliate / creator commission | |
   | Less: shipping and return shipping | |
   | Less: ads | |
   | Less: cost of goods sold | |
   | **Contribution (profit before overhead)** | |
   | Fees as % of net sales | |
   | Return on ad spend | |

   Cost lines show only for people allowed to see cost.
2. **Payout reconciliation:** each TikTok payout, the orders in it, the computed payout vs. the money received, and any difference.
3. **Order tracker:** shipped / settled / returned / overdue, with days since shipping.
4. **Returns report:** returns by reason and SKU, return rate %, damaged vs. restocked, return shipping cost.
5. **SKU performance:** units, net sales, fees per unit, contribution per SKU. This shows which products are worth selling online after fees.
6. It also appears in the new **Monthly Sales Performance** graphs as its own colour ("E-commerce"), next to the branches.

## 6. Who does what

| Role | Does |
|---|---|
| **E-comm Associate** (new role) | Uploads orders / waybills; checks and submits the auto-drafted pull-outs; records returns; uploads settlement and ads files. Sees selling prices and fees, **never cost**. |
| **Warehouse In-Charge** | Approves e-commerce pull-outs (the only approval), receives returns and marks their condition. |
| **Head Auditor** | Approves write-offs of damaged returns; audits the order tracker. |
| **Accounting Head** | Approves each settlement batch before it posts; handles withdrawals to the bank and withholding tax certificates. |
| **Owner** | Sees the e-commerce P&L, the graphs and overdue orders. |

## 7. Guide for the E-comm Associate (daily routine)

1. **Morning — orders to ship**
   1. TikTok Seller Center → Orders → "To ship" → **Export** (or print the waybills and export the list).
   2. GWS-ERP → **E-commerce → Upload orders** → choose **TikTok** → upload the file.
   3. If a product is new, pick the matching GWS product once.
   4. Open the draft **E-commerce Pull-out**, remove cancelled orders, **Print picking list**, then **Submit**.
2. **Warehouse** picks and packs, and the In-Charge approves. You hand the parcels to the courier with their waybills.
3. **Returns:** when a parcel comes back, open **E-commerce → Returns**, scan or type the tracking ID, and give it to the In-Charge, who marks each item good or damaged.
4. **Each payout (weekly):** TikTok Seller Center → Finance → Statements → **Export** → GWS-ERP → **E-commerce → Upload settlement**. Check that the payout shown matches TikTok, then **Send to Accounting**.
5. **Monthly:** TikTok Ads Manager → Billing → download the invoice / billing report → **E-commerce → Upload ads**.
6. **Every Friday:** open the **Order tracker** and follow up every **Overdue** order with TikTok support.

**Guide for the Warehouse In-Charge**
- Approvals → **E-commerce pull-out**: count the picked items against the list, then Approve.
- E-commerce → **Returns received**: for each item choose Good (back to stock) or Damaged/Expired (write-off request).

**Guide for the Accounting Head**
- Approvals → **E-commerce settlement**: check that gross sales − fees − refunds − withholding tax = payout received, then Approve.
- Bank & Office → record the transfer from the TikTok wallet to the bank.

## 8. Suggested build order

1. **E-comm Associate role**, "E-commerce – with courier" holding place, platform SKU mapping, **order upload → auto pull-out draft → In-Charge approval**. This is the part that stops manual pull-out typing.
2. **Settlement upload** (TikTok first) with the fee accounts, withholding tax and payout; Accounting approval; the **E-commerce P&L** and the payout reconciliation.
3. **Returns** (RTS and buyer returns) and the **order tracker** with overdue alerts.
4. **Ads upload** and return-on-ad-spend; Shopee and Lazada file formats; e-commerce in the performance graphs.

## 9. Questions for the Owner before building

1. Which platforms now: TikTok only, or also Shopee and Lazada?
2. Please send **one real export of each file**, with customer names removed if you like:
   - TikTok "To ship" order export (or the waybill list);
   - one Finance → Statement export;
   - one Ads Manager billing report.
3. How are TikTok ads paid today: card, bank, monthly invoice, or deducted from shop revenue (GMV Pay)?
4. How many days after shipping should an unpaid, unreturned order count as **overdue**? (suggested 30)
5. Should e-commerce have its own set of accounts in the chart of accounts, as proposed in section 4? Accounting can confirm the account names.
6. Who will be the E-comm Associate(s), so their accounts can be created?

## Sources consulted

- TikTok Shop Philippines, [Introduction to Seller Fees](https://seller-ph.tiktok.com/university/essay?knowledge_id=2675772847064834&lang=en), [Platform Commission Fee](https://seller-ph.tiktok.com/university/essay?knowledge_id=3157977859229442&lang=en), [Seller Settlement Policy](https://seller-ph.tiktok.com/university/essay?knowledge_id=1721378948548354&lang=en), [Returns and Refunds](https://seller-ph.tiktok.com/university/essay?knowledge_id=3599251858818817&lang=en), [Customer Order Cancellation, Return and Refund Policy](https://seller-ph.tiktok.com/university/essay?knowledge_id=7654203686340353&lang=en)
- TikTok Shop, [Exporting Orders](https://seller-sg.tiktok.com/university/essay?knowledge_id=1955916023072514&lang=en), [How to Access Your Settlement Report](https://seller-us.tiktok.com/university/essay?knowledge_id=2336057241700098&lang=en), [Finance Report Guide](https://seller-uk.tiktok.com/university/essay?knowledge_id=7753826522744578)
- TikTok Ads, [About GMV Pay](https://ads.tiktok.com/help/article/about-gmv-pay?lang=en), [Receipt and Invoice](https://ads.tiktok.com/help/article/receipt-and-invoice?lang=en)
- Fee summaries: [Duoke – TikTok Shop commission 2026](https://www.duoke.com/en/blog/article/394-How-is-TikTok-Shop-Commission-Fee-Calculated-2026), [Cloud Ecommerce – TikTok Shop fees Philippines 2026](https://www.cloudecommerce.com/blog/tiktok-shop-fees-philippines-2026-complete-commission-and-cost-breakdown/)
- Settlement accounting practice: [Link My Books – marketplace payout reconciliation](https://linkmybooks.com/blog/how-accountants-should-reconcile-marketplace-payouts-for-ecommerce-clients), [Link My Books – TikTok Shop transaction reports](https://linkmybooks.com/blog/tiktok-shop-transactions-reports), [A2X vs Link My Books](https://www.a2xaccounting.com/link-my-books-vs-a2x)
- Tax: [BIR RR 16-2023](https://bir-cdn.bir.gov.ph/BIR/pdf/RR%2016-2023.pdf), [Philippine News Agency – 1% withholding on online merchants](https://www.pna.gov.ph/articles/1216099)
