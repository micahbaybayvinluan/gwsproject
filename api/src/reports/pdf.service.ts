import { Injectable, Logger } from '@nestjs/common';
import { DailySalesReport, asNum } from './daily-sales-report';

/** HTML → PDF via puppeteer-core (PUPPETEER_EXECUTABLE_PATH). Falls back to returning HTML when no browser is available. */
@Injectable()
export class PdfService {
  private log = new Logger('Pdf');
  async render(html: string): Promise<{ buffer: Buffer; contentType: string; ext: 'pdf' | 'html' }> {
    const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!exe) return { buffer: Buffer.from(html), contentType: 'text/html', ext: 'html' };
    try {
      const puppeteer = await import('puppeteer-core');
      const browser = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      try { const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'load' }); const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } }); return { buffer: Buffer.from(pdf), contentType: 'application/pdf', ext: 'pdf' }; }
      finally { await browser.close(); }
    } catch (e) { this.log.warn(`PDF render failed (${(e as Error).message}); returning HTML`); return { buffer: Buffer.from(html), contentType: 'text/html', ext: 'html' }; }
  }
  private css = `<style>body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111}h1{font-size:16px;margin:0 0 4px}h2{font-size:12px;margin:14px 0 4px;border-bottom:1px solid #999}table{border-collapse:collapse;width:100%;margin-bottom:6px}th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}td.n,th.n{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.muted{color:#666}.sig{margin-top:28px;display:flex;gap:40px}.sig div{border-top:1px solid #333;padding-top:3px;min-width:180px}</style>`;
  private esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  private m = (v: unknown) => asNum(v as never).toLocaleString('en-PH', { minimumFractionDigits: 2 });

  dailySalesReportHtml(rep: DailySalesReport): string {
    const kv = (rows: [string, unknown][]) => `<table>${rows.map(([k, v]) => `<tr><td>${this.esc(k)}</td><td class="n">${typeof v === 'number' ? v : this.m(v)}</td></tr>`).join('')}</table>`;
    const lineTable = (rows: { drSiNo: string; items: string; qty: number; amount: unknown; fee: unknown; total: unknown; remarks: string }[]) => `<table><tr><th>DR#/SI#</th><th>Items</th><th class="n">Qty</th><th class="n">Amount</th><th class="n">Fee</th><th class="n">Total</th><th>Remarks</th></tr>${rows.map((x) => `<tr><td>${this.esc(x.drSiNo)}</td><td>${this.esc(x.items)}</td><td class="n">${x.qty}</td><td class="n">${this.m(x.amount)}</td><td class="n">${this.m(x.fee)}</td><td class="n">${this.m(x.total)}</td><td>${this.esc(x.remarks)}</td></tr>`).join('')}</table>`;
    return `<!doctype html><html><head><meta charset="utf-8">${this.css}</head><body>
<h1>Daily Branch Sales Report</h1><div class="muted">Branch: <b>${this.esc(rep.header.branch)}</b> &nbsp; Date: <b>${rep.header.date}</b> &nbsp; System date: ${rep.header.systemDate.slice(0, 19).replace('T', ' ')}</div>
<div class="grid"><div>
<h2>Sales Breakdown (Cash)</h2>${kv([['Walk-in', rep.cash.walkIn], ['Delivery', rep.cash.delivery], ['Franchise', rep.cash.franchise], ['Prothin Dealer', rep.cash.dealer], ['Agent (Cash)', rep.cash.agent], ['Delivery Fee', rep.cash.deliveryFee], ['Subtotal', rep.cash.subtotal]])}
<h2>Credit Card</h2>${kv([['Walk-in', rep.creditCard.walkIn], ['Delivery', rep.creditCard.delivery], ['Agent', rep.creditCard.agent], ['Total', rep.creditCard.total]])}
<h2>Online</h2>${kv([['Walk-in (Online)', rep.onlineWalkIn.walkIn], ['Franchise', rep.onlineWalkIn.franchise], ['Prothin Dealer', rep.onlineWalkIn.dealer], ['Agent', rep.onlineWalkIn.agent], ['Delivery (Online)', rep.onlineDelivery.delivery], ['Delivery Fee (Online)', rep.onlineDelivery.deliveryFee]])}
<h2>Shipping</h2>${kv([['Shipping (LBC/Lalamove)', rep.shipping.courier], ['Shipping – Franchise', rep.shipping.franchise], ['Shipping – Dealer', rep.shipping.dealer], ['Shipping – Agent', rep.shipping.agent], ['Shipping (Shopee/Lazada)', rep.shipping.marketplace], ['Shipping Fee', rep.shipping.shippingFee], ['Total Online/CC/Shipping', rep.onlineCcShippingTotal]])}
<h2>Totals by channel</h2><table><tr><th>Channel</th><th class="n">Amount</th><th class="n"># Products</th></tr>${rep.channelTotals.map((c) => `<tr><td>${c.channel.replace(/_/g, ' ')}</td><td class="n">${this.m(c.amount)}</td><td class="n">${c.products}</td></tr>`).join('')}<tr><td>Apparels</td><td></td><td class="n">${rep.productCounts.apparel}</td></tr><tr><td>Equipment</td><td></td><td class="n">${rep.productCounts.equipment}</td></tr></table>
</div><div>
<h2>Rider Delivery Summary</h2><table><tr><th>Rider</th><th class="n">Product Amt</th><th class="n">Del Fee</th><th class="n">Subtotal</th><th class="n">Incentives</th><th class="n">Total</th></tr>${rep.riders.map((x) => `<tr><td>${this.esc(x.rider)}</td><td class="n">${this.m(x.productAmount)}</td><td class="n">${this.m(x.deliveryFee)}</td><td class="n">${this.m(x.subtotal)}</td><td class="n">${this.m(x.incentives)}</td><td class="n">${this.m(x.total)}</td></tr>`).join('')}</table>
<h2>Money Breakdown</h2><table>${[1000, 500, 200, 100, 50, 20, 10, 5, 1].map((d) => `<tr><td>${d}</td><td class="n">${rep.moneyBreakdown?.[String(d)] ?? 0}</td><td class="n">${this.m((rep.moneyBreakdown?.[String(d)] ?? 0) * d)}</td></tr>`).join('')}${rep.cashCount ? `<tr><td>Counted</td><td></td><td class="n">${this.m(rep.cashCount.counted)}</td></tr><tr><td>Expected</td><td></td><td class="n">${this.m(rep.cashCount.expected)}</td></tr><tr><td><b>Variance</b></td><td></td><td class="n"><b>${this.m(rep.cashCount.variance)}</b></td></tr>` : ''}</table>
<h2>Expenses</h2><table><tr><th>Account</th><th class="n">Major</th><th class="n">Other</th></tr>${rep.expenses.map((e) => `<tr><td>${this.esc(e.accountTitle)}${e.payee ? ` – ${this.esc(e.payee)}` : ''}</td><td class="n">${e.group === 'MAJOR' ? this.m(e.amount) : ''}</td><td class="n">${e.group === 'OTHER' ? this.m(e.amount) : ''}</td></tr>`).join('')}<tr><td><b>Total</b></td><td class="n"><b>${this.m(rep.expenseTotals.major)}</b></td><td class="n"><b>${this.m(rep.expenseTotals.other)}</b></td></tr></table>
${kv([['Rider/Driver expense', rep.expenseTotals.riderExpense], ['Shipping expense – Orders', rep.expenseTotals.shippingExpense.orders], ['Shipping expense – Marketing', rep.expenseTotals.shippingExpense.marketing]])}
<h2>Freebies</h2><table>${rep.freebies.map((f) => `<tr><td>${this.esc(f.item)}</td><td class="n">${f.qty}</td></tr>`).join('') || '<tr><td class="muted">none</td></tr>'}</table>
<h2>Summary for bank deposit</h2>${kv([['Cash', rep.bankDeposit.cash], ['Less: cash expenses', rep.bankDeposit.expenses], ['Total cash deposit', rep.totalCashDeposit], ['Overall sales', rep.overallSales], ['Total products', rep.totalProducts]])}
</div></div>
<h2>Walk-in</h2>${lineTable(rep.sheets.walkIn)}<h2>Delivery</h2>${lineTable(rep.sheets.delivery)}<h2>Shipping</h2>${lineTable(rep.sheets.shipping)}
<h2>Credit Card</h2><table><tr><th>DR#/SI#</th><th>Customer</th><th>Items</th><th class="n">Amount</th><th>MID</th><th>Slip</th><th>Approval</th><th>Batch</th></tr>${rep.sheets.creditCard.map((x) => `<tr><td>${this.esc(x.drSiNo)}</td><td>${this.esc(x.customer)}</td><td>${this.esc(x.items)}</td><td class="n">${this.m(x.amount)}</td><td>${this.esc(x.mid)}</td><td>${this.esc(x.slip)}</td><td>${this.esc(x.approval)}</td><td>${this.esc(x.batch)}</td></tr>`).join('')}</table>
<div class="sig"><div>Prepared by: ${this.esc(rep.header.preparedBy)}<br><span class="muted">${rep.header.date}</span></div><div>Checked by</div><div>Approved by</div></div>
</body></html>`;
  }

  /** Generic paper form (Pull-Out, Transfer-In, DR-Sales, Supplier's Form, Count, Discrepancy, Charge Form, Credit Note, Journal Voucher). */
  formHtml(title: string, header: [string, unknown][], columns: string[], rows: unknown[][], footer: [string, unknown][] = [], signatures = ['Prepared by', 'Checked by', 'Received by']): string {
    return `<!doctype html><html><head><meta charset="utf-8">${this.css}</head><body><h1>Get Wheysted Supplements — ${this.esc(title)}</h1>
<table>${header.map(([k, v]) => `<tr><td style="width:30%"><b>${this.esc(k)}</b></td><td>${this.esc(v)}</td></tr>`).join('')}</table>
<table><tr>${columns.map((c) => `<th>${this.esc(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td class="${typeof c === 'number' || (c && typeof c === 'object' && 'toNumber' in (c as object)) ? 'n' : ''}">${typeof c === 'object' && c && 'toNumber' in (c as object) ? this.m(c) : this.esc(c)}</td>`).join('')}</tr>`).join('')}</table>
${footer.length ? `<table>${footer.map(([k, v]) => `<tr><td style="width:70%"><b>${this.esc(k)}</b></td><td class="n">${typeof v === 'object' && v && 'toNumber' in (v as object) ? this.m(v) : this.esc(v)}</td></tr>`).join('')}</table>` : ''}
<div class="sig">${signatures.map((s) => `<div>${this.esc(s)}</div>`).join('')}</div></body></html>`;
  }
}
