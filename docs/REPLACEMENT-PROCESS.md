# Items returned to us and items we return: the recommended process

*(Owner request 2026-10-02. What is built in GWS-ERP is marked ✔; the rest are recommendations for later.)*

## 1. Customer returns an item (✔ Replacement ticket, customer kind)

1. **Receive the item at any branch (never a franchise).** Find the DR / SI it was sold on (DR number, customer name or mobile). Choose the line, the quantity and the reason (damaged, defective, wrong item, expired, other). Photograph the item. ✔
2. **Rules the system enforces:** the quantity cannot be more than was sold less what is already on earlier tickets (a DR line cannot be returned twice); a return older than 30 days is flagged to the auditors. ✔
3. **Notifications:** the auditors, Accounting, the Owner, the sales associate of that DR, the person who opened it, and every branch (so any of them can replace it). ✔
4. **Replacement:** any branch except a franchise gives the replacement and ticks the ticket: the same product or another, the price from the price list (editable). The replacement leaves that branch's stock. The **price difference** against the DR is computed (customer pays / refund or credit). ✔
5. **Head Auditor approves** the replacement. If refused: the stock goes back and the ticket reopens. ✔
6. **Settle the difference:** the branch confirms it collected or refunded the difference; Accounting is told. ✔
7. **Reminders** every 3 days while no branch has replaced it. ✔

## 2. We return items to a supplier (✔ Replacement ticket, supplier kind)

1. Open the ticket (product, quantity, supplier that must replace it, reason). The ticket number tags it to the supplier. ✔
2. **Head Auditor approves the return;** the stock leaves only then. ✔
3. The ticket stays **open until replacement items arrive**: on Supplier Deliveries choose "This delivery replaces a ticket". Part arrivals keep it open (✔ partial); enough arrival closes it. Nothing else closes it. ✔
4. If the supplier sends a different product or at a different cost, the **value difference** is computed (we owe them / they owe us) and sent to Accounting. ✔
5. **Reminders** after 7 days; the page lists which suppliers still owe units, how old the oldest ticket is and how long each supplier usually takes. ✔

## 3. More processes recommended

| # | Recommendation | Why |
|---|---|---|
| 1 | **Disposition of the returned item** (restock if fine, send to the supplier, dispose as expense): the Head Auditor chooses when approving a customer replacement; "send to supplier" opens the supplier ticket by itself. | The item the customer returned has to go somewhere; today it is outside the stock. |
| 2 | **Credit note / refusal:** when a supplier refuses to replace, Accounting writes off the remaining receivable (or records the supplier's credit note) and the ticket closes with the reference. | The receivable from suppliers otherwise stays open. |
| 3 | **Credit note instead of replacement** when a supplier will not replace (Accounting records it; the ticket closes with the credit note number). | Some suppliers only give credit. |
| 4 | **Photo required** for every ticket and a **warranty window per product** (30 days for supplements, other for equipment), over the window needing the Head Auditor. | Evidence and fewer disputes. |
| 5 | **Supplier scorecard** each month: tickets, units returned, average days to replace, units still owed, cost of refusals. Review with the supplier. | Negotiating leverage. |
| 6 | **Customer follow-up:** the customer's mobile on the ticket receives "replacement ready" (like the re-order reminders). | Fewer waiting customers. |
| 7 | **Batch recall:** a ticket for a batch warns every branch holding that batch and offers to open a supplier ticket for all of it. | Safety and speed. |
| 8 | **Franchise returns** go through the Franchise Coordinator (transfer back to the warehouse, credited on the franchise invoice), not through tickets. | Franchises are billed, not sold to at retail. |
| 9 | **Monthly review** by the Head Auditor of tickets older than 14 days and of customers with repeated returns. | Detect abuse and quality problems. |

Marketing and bad-order (BO) give-outs are a separate process: see "Marketing and BO pull-outs" in the user guide.

## 4. Accounting entries (✔ built; they post when Admin has switched on automatic journal posting)

| Step | Debit | Credit |
|---|---|---|
| Customer replacement approved by the Head Auditor | Replacement Cost - Customer Returns (at the cost of the batches given) | Inventory of the branch that gave it |
| Price difference settled, customer pays | Cash on Hand of that branch (or the customer's AR on a credit sale: dealer, agent) | Sales of the DR's channel |
| Price difference settled, refund / credit | Sales - Returns | Cash on Hand (or the customer's AR) |
| Return to supplier approved | Receivable from Suppliers - Returned Items | Inventory of the sender, at cost |
| Replacement delivery posted (normal delivery entry) | Inventory | Accounts Payable - supplier |
| ...and the part that replaces what we sent | Accounts Payable - supplier | Receivable from Suppliers - Returned Items |

A replacement delivery worth more than what we sent leaves the extra payable to the supplier; one worth less leaves a receivable balance the supplier still owes. The item a customer returned is not put back into inventory (conservative); the original sale stays as it was.
