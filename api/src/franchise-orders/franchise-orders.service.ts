import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MasterService } from '../master/master.service';
import { SalesService } from '../sales/sales.service';
import { PdfService } from '../reports/pdf.service';
import { FranchiseArService } from '../franchise/franchise-ar.service';
import { requestContext, type SessionUser } from '../common/request-context';
import { addDays, dateStr, manilaDateStr, todayManila } from '../common/manila';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const COORD_ROLES = ['FRANCHISE_COORDINATOR', 'ASST_FRANCHISE_COORDINATOR'] as const;
const WH_ROLES = ['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE'] as const;
export interface FlavorQty { flavor: string | null; qty: number }
const flavorsOf = (j: unknown): FlavorQty[] => (Array.isArray(j) ? (j as FlavorQty[]) : []);
const fk = (f: string | null | undefined) => f ?? '';
const nat = (n: unknown, what: string) => { const v = Number(n); if (!Number.isInteger(v) || v < 0) throw new BadRequestException(`${what} must be a whole number, 0 or more`); return v; };

/**
 * Franchise availability and orders (owner request 2026-10-15).
 * 1. The Franchise Coordinator generates the list of what the warehouse has for the franchises (from the system stock, by flavor).
 * 2. The Warehouse In-Charge checks it: removes what cannot be given, edits the quantity and the flavors available, and sends it back.
 * 3. The Coordinator sends it to the franchises (they are notified).
 * 4. Each franchise sees the available products and puts the quantity it orders, flavor by flavor.
 * 5. The order becomes a picklist for the Coordinator, who prints it for preparation.
 * 6. The warehouse makes the final check (may change the quantities) and approves; then the Coordinator generates the DR (which tells the franchise and waits for its receipt).
 */
@Injectable()
export class FranchiseOrdersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notify: NotificationsService, private master: MasterService, private sales: SalesService, private pdf: PdfService, private ar: FranchiseArService) {}

  private isFranchiseUser(user: SessionUser) { return user.roleKey === 'FRANCHISE_OWNER' || user.roleKey === 'FRANCHISE_SALES_ASSOCIATE'; }
  private async nextNo(docType: string, prefix: string, pad: number) {
    const year = todayManila().getUTCFullYear();
    return this.prisma.db.$transaction(async (tx) => { const n = await this.seq.next(tx, docType, { locationId: String(year), year, prefix, pad }); return `${prefix}-${year}-${String(Number(/(\d+)$/.exec(n)![1])).padStart(pad, '0')}`; });
  }
  private async warehouse() { const w = await requestContext.runSystem(async () => await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE', active: true }, select: { id: true, name: true } })); if (!w) throw new BadRequestException('No warehouse found'); return w; }

  /** Warehouse stock by product and flavor (expired batches are not offered). */
  private async stockByFlavor(productIds?: string[]) {
    const w = await this.warehouse(); const today = todayManila();
    const rows = await requestContext.runSystem(async () => await this.prisma.db.stockBalance.findMany({ where: { locationId: w.id, qty: { gt: 0 }, ...(productIds ? { productId: { in: productIds } } : {}), OR: [{ batch: { expiryDate: null } }, { batch: { expiryDate: { gte: today } } }] }, include: { batch: { select: { flavor: true } } } }));
    const m = new Map<string, Map<string, number>>();
    for (const r of rows) { const p = m.get(r.productId) ?? new Map<string, number>(); p.set(fk(r.batch.flavor), (p.get(fk(r.batch.flavor)) ?? 0) + r.qty); m.set(r.productId, p); }
    return m;
  }

  // ── 1. generate ──
  async generate(user: SessionUser, input: { notes?: string }) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException('Only the Franchise Coordinators generate the availability');
    const stock = await this.stockByFlavor();
    const prods = await this.prisma.db.product.findMany({ where: { id: { in: [...stock.keys()] }, active: true, franchiseVisible: true, isBundle: false, category: { accountingClass: { notIn: ['FREEBIE', 'PLASTIC'] } } }, select: { id: true } });
    const ok = new Set(prods.map((p) => p.id));
    const lines = [...stock].filter(([pid]) => ok.has(pid)).map(([productId, fl]) => { const flavors = [...fl].map(([f, qty]) => ({ flavor: f === '' ? null : f, qty })).sort((a, b) => (a.flavor ?? '').localeCompare(b.flavor ?? '')); const total = flavors.reduce((n, x) => n + x.qty, 0); return { productId, systemQty: total, qty: total, flavors: flavors as unknown as Prisma.InputJsonValue }; });
    if (!lines.length) throw new BadRequestException('The warehouse has nothing available for the franchises');
    const listNo = await this.nextNo('FRANCHISE_AVAIL', 'FA', 3);
    const a = await this.prisma.db.franchiseAvailability.create({ data: { listNo, notes: input.notes?.trim() || null, createdBy: user.id, createdByName: user.fullName, lines: { create: lines } } });
    await this.notify.toRoles([...WH_ROLES], { type: 'FRANCHISE_AVAILABILITY', title: `${listNo}: please check what the warehouse can give to the franchises`, body: `${lines.length} items from the system stock. Remove what cannot be given, edit the quantities and the flavors available, then send it to the Franchise Coordinator.`, link: `/franchise-orders/availability/${a.id}` });
    await this.audit.log({ action: 'CREATE', entityType: 'FranchiseAvailability', entityId: a.id, after: { listNo, items: lines.length } });
    return this.get(user, a.id);
  }

  private async shapeList(rows: Prisma.FranchiseAvailabilityGetPayload<{ include: { lines: true } }>[]) {
    return rows.map((a) => ({ id: a.id, listNo: a.listNo, status: a.status, notes: a.notes, createdByName: a.createdByName, createdAt: a.createdAt, reviewedByName: a.reviewedByName, reviewedAt: a.reviewedAt, publishedAt: a.publishedAt, publishedTo: a.publishedTo, items: a.lines.length, units: a.lines.reduce((n, l) => n + l.qty, 0) }));
  }
  async list(user: SessionUser) {
    if (!user.permissions.has('fo.view')) throw new ForbiddenException();
    const where: Prisma.FranchiseAvailabilityWhereInput = this.isFranchiseUser(user) ? { status: { in: ['PUBLISHED', 'CLOSED'] }, publishedTo: { hasSome: user.locationIds } } : {};
    return this.shapeList(await this.prisma.db.franchiseAvailability.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 100 }));
  }

  /** What is still free to order for each product and flavor (the quantity offered less what other franchises already ordered). */
  private async orderedQty(availabilityId: string, exceptOrderId?: string) {
    const lines = await this.prisma.db.franchiseOrderLine.findMany({ where: { order: { availabilityId, status: { not: 'CANCELLED' }, ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}) } }, select: { productId: true, flavor: true, qty: true } });
    const m = new Map<string, number>(); for (const l of lines) m.set(`${l.productId}|${fk(l.flavor)}`, (m.get(`${l.productId}|${fk(l.flavor)}`) ?? 0) + l.qty); return m;
  }

  async get(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.view')) throw new ForbiddenException();
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id }, include: { lines: true } }); if (!a) throw new NotFoundException();
    const franchiseUser = this.isFranchiseUser(user);
    if (franchiseUser && !(['PUBLISHED', 'CLOSED'].includes(a.status) && a.publishedTo.some((x) => user.locationIds.includes(x)))) throw new ForbiddenException();
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: a.lines.map((l) => l.productId) } }, select: { id: true, sku: true, name: true, brand: true } })).map((p) => [p.id, p]));
    const showPrice = franchiseUser || user.permissions.has('price.view.FRANCHISE');
    const prices = showPrice ? await this.master.currentPrices(a.lines.map((l) => l.productId)) : null;
    // while the warehouse checks the list: every flavor in the system stock, with the most it can offer
    const live = a.status === 'WAREHOUSE_REVIEW' ? await this.stockByFlavor(a.lines.map((l) => l.productId)) : null;
    const mine = franchiseUser ? await this.prisma.db.franchiseOrder.findFirst({ where: { availabilityId: id, franchiseLocationId: user.locationIds[0], status: { not: 'CANCELLED' } }, include: { lines: true } }) : null;
    // for a franchise: what is left after the OTHER franchises' orders (its own order can still be changed); for the head office: after every order
    const taken = a.status === 'PUBLISHED' || a.status === 'CLOSED' ? await this.orderedQty(id, mine?.status === 'ORDERED' ? mine.id : undefined) : new Map<string, number>();
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    return { id: a.id, listNo: a.listNo, status: a.status, notes: a.notes, createdByName: a.createdByName, createdAt: a.createdAt, reviewedByName: a.reviewedByName, reviewedAt: a.reviewedAt, publishedAt: a.publishedAt, publishedTo: a.publishedTo.map((x) => ({ id: x, name: locs.get(x) ?? '' })),
      lines: a.lines.map((l) => { const fl = flavorsOf(l.flavors); const p = prods.get(l.productId); return { id: l.id, productId: l.productId, sku: p?.sku ?? '', product: p?.name ?? '', brand: p?.brand ?? null, systemQty: l.systemQty, qty: l.qty, franchisePrice: prices?.get(l.productId)?.FRANCHISE != null ? Number(prices.get(l.productId)!.FRANCHISE) : null,
        flavors: (live ? [...(live.get(l.productId) ?? new Map<string, number>())].map(([f, max]) => ({ flavor: f === '' ? null : f, qty: fl.find((x) => fk(x.flavor) === f)?.qty ?? 0, remaining: 0, max })) : fl.map((f) => ({ flavor: f.flavor, qty: f.qty, remaining: Math.max(0, f.qty - (taken.get(`${l.productId}|${fk(f.flavor)}`) ?? 0)), max: undefined as number | undefined }))).sort((x, y) => (x.flavor ?? '').localeCompare(y.flavor ?? '')) }; }).sort((x, y) => x.product.localeCompare(y.product)),
      myOrder: mine ? { id: mine.id, orderNo: mine.orderNo, status: mine.status, lines: mine.lines.map((l) => ({ productId: l.productId, flavor: l.flavor, qty: l.qty })) } : null };
  }

  // ── 2. warehouse review ──
  async review(user: SessionUser, id: string, input: { lines: { lineId: string; remove?: boolean; flavors?: FlavorQty[] }[]; notes?: string | null }) {
    if (!user.permissions.has('fo.review')) throw new ForbiddenException('Only the warehouse checks the availability');
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id }, include: { lines: true } }); if (!a) throw new NotFoundException();
    if (a.status !== 'WAREHOUSE_REVIEW') throw new BadRequestException('This list is no longer with the warehouse');
    for (const x of input.lines) {
      const l = a.lines.find((y) => y.id === x.lineId); if (!l) throw new BadRequestException('Unknown line');
      if (x.remove) { await this.prisma.db.franchiseAvailabilityLine.delete({ where: { id: l.id } }); continue; }
      if (x.flavors) {
        const sys = new Map([...((await this.stockByFlavor([l.productId])).get(l.productId) ?? new Map<string, number>())]);
        const next: FlavorQty[] = [];
        for (const f of x.flavors) { const max = sys.get(fk(f.flavor)); if (max == null) throw new BadRequestException(`That flavor is not in the system stock of this item`); const q = nat(f.qty, 'The quantity'); if (q > max) throw new BadRequestException(`Only ${max} in the system stock for that flavor: the warehouse can offer less, not more`); if (q > 0) next.push({ flavor: f.flavor ?? null, qty: q }); }
        if (!next.length) { await this.prisma.db.franchiseAvailabilityLine.delete({ where: { id: l.id } }); continue; }
        await this.prisma.db.franchiseAvailabilityLine.update({ where: { id: l.id }, data: { flavors: next as unknown as Prisma.InputJsonValue, qty: next.reduce((n, f) => n + f.qty, 0) } });
      }
    }
    if (input.notes !== undefined) await this.prisma.db.franchiseAvailability.update({ where: { id }, data: { notes: input.notes?.trim() || null } });
    await this.audit.log({ action: 'REVIEW_EDIT', entityType: 'FranchiseAvailability', entityId: id, after: { removed: input.lines.filter((x) => x.remove).length } });
    return this.get(user, id);
  }

  async sendToCoordinator(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.review')) throw new ForbiddenException();
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id }, include: { lines: true } }); if (!a) throw new NotFoundException();
    if (a.status !== 'WAREHOUSE_REVIEW') throw new BadRequestException('Already sent');
    if (!a.lines.length) throw new BadRequestException('Nothing is left on the list: keep at least one item');
    await this.prisma.db.franchiseAvailability.update({ where: { id }, data: { status: 'FOR_COORDINATOR', reviewedBy: user.id, reviewedByName: user.fullName, reviewedAt: new Date() } });
    await this.notify.toRoles([...COORD_ROLES], { type: 'FRANCHISE_AVAILABILITY', title: `${a.listNo}: the warehouse checked the availability (${a.lines.length} items, ${a.lines.reduce((n, l) => n + l.qty, 0)} pcs): send it to the franchises`, link: `/franchise-orders/availability/${id}` });
    await this.audit.log({ action: 'SEND_TO_COORDINATOR', entityType: 'FranchiseAvailability', entityId: id, userId: user.id });
    return this.get(user, id);
  }

  // ── 3. publish to the franchises ──
  async publish(user: SessionUser, id: string, franchiseIds?: string[]) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id } }); if (!a) throw new NotFoundException();
    if (a.status !== 'FOR_COORDINATOR') throw new BadRequestException('The warehouse has not sent this list back yet');
    const all = await this.prisma.db.location.findMany({ where: { type: 'FRANCHISE', active: true }, select: { id: true, name: true } });
    const to = franchiseIds?.length ? all.filter((l) => franchiseIds.includes(l.id)) : all; if (!to.length) throw new BadRequestException('Choose at least one franchise');
    await this.prisma.db.franchiseAvailability.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedTo: to.map((l) => l.id) } });
    for (const l of to) await this.notify.toLocation(l.id, { type: 'FRANCHISE_AVAILABILITY', title: `Products available for ${l.name} (${a.listNo}): choose what you order`, body: 'Open it, put the quantity you want for each product and flavor, and send your order.', link: `/franchise-orders/availability/${id}` });
    await this.audit.log({ action: 'PUBLISH', entityType: 'FranchiseAvailability', entityId: id, after: { franchises: to.length } });
    return this.get(user, id);
  }
  async returnToWarehouse(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id } }); if (!a) throw new NotFoundException();
    if (a.status !== 'FOR_COORDINATOR') throw new BadRequestException('Only a list waiting for the coordinator can go back');
    await this.prisma.db.franchiseAvailability.update({ where: { id }, data: { status: 'WAREHOUSE_REVIEW' } });
    await this.notify.toRoles([...WH_ROLES], { type: 'FRANCHISE_AVAILABILITY', title: `${a.listNo} is back with the warehouse for another check`, link: `/franchise-orders/availability/${id}` });
    return this.get(user, id);
  }
  async close(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id } }); if (!a) throw new NotFoundException();
    await this.prisma.db.franchiseAvailability.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } });
    return this.get(user, id);
  }

  // ── 4. the franchise orders ──
  async order(user: SessionUser, availabilityId: string, input: { lines: { productId: string; flavor?: string | null; qty: number }[]; notes?: string }) {
    if (!user.permissions.has('fo.order') || !this.isFranchiseUser(user)) throw new ForbiddenException('Only a franchise orders');
    const franchiseId = user.locationIds[0]; if (!franchiseId) throw new BadRequestException('This account is not assigned to a franchise');
    const a = await this.prisma.db.franchiseAvailability.findUnique({ where: { id: availabilityId }, include: { lines: true } }); if (!a) throw new NotFoundException();
    if (a.status !== 'PUBLISHED' || !a.publishedTo.includes(franchiseId)) throw new BadRequestException('This list is not open for your franchise');
    const existing = await this.prisma.db.franchiseOrder.findFirst({ where: { availabilityId, franchiseLocationId: franchiseId, status: { not: 'CANCELLED' } } });
    if (existing && existing.status !== 'ORDERED') throw new BadRequestException('Your order has already gone to the warehouse; ask the Franchise Coordinator to change it');
    const taken = await this.orderedQty(availabilityId, existing?.id);
    const merged = new Map<string, { productId: string; flavor: string | null; qty: number }>();
    for (const l of input.lines) { const q = nat(l.qty, 'The quantity'); if (q === 0) continue; const k = `${l.productId}|${fk(l.flavor)}`; const c = merged.get(k) ?? { productId: l.productId, flavor: l.flavor ?? null, qty: 0 }; c.qty += q; merged.set(k, c); }
    if (!merged.size) throw new BadRequestException('Put a quantity on at least one product');
    for (const m of merged.values()) {
      const line = a.lines.find((x) => x.productId === m.productId); const f = line ? flavorsOf(line.flavors).find((x) => fk(x.flavor) === fk(m.flavor)) : undefined;
      if (!line || !f) throw new BadRequestException('One of the items is not on the list');
      const free = f.qty - (taken.get(`${m.productId}|${fk(m.flavor)}`) ?? 0);
      if (m.qty > free) { const p = await this.prisma.db.product.findUnique({ where: { id: m.productId }, select: { name: true } }); throw new BadRequestException(`Only ${Math.max(0, free)} of ${p?.name ?? 'this item'}${m.flavor ? ` (${m.flavor})` : ''} are still available`); }
    }
    const lines = [...merged.values()].map((m) => ({ productId: m.productId, flavor: m.flavor, qty: m.qty, checkedQty: null as number | null }));
    const orderNo = existing?.orderNo ?? await this.nextNo('FRANCHISE_ORDER', 'FO', 4);
    const o = existing
      ? await this.prisma.db.$transaction(async (tx) => { await tx.franchiseOrderLine.deleteMany({ where: { orderId: existing.id } }); return tx.franchiseOrder.update({ where: { id: existing.id }, data: { notes: input.notes?.trim() || null, orderedAt: new Date(), lines: { create: lines } } }); })
      : await this.prisma.db.franchiseOrder.create({ data: { orderNo, availabilityId, franchiseLocationId: franchiseId, notes: input.notes?.trim() || null, orderedBy: user.id, orderedByName: user.fullName, lines: { create: lines } } });
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: franchiseId }, select: { name: true } });
    await this.notify.toRoles([...COORD_ROLES], { type: 'FRANCHISE_ORDER', title: `${loc.name} ${existing ? 'changed' : 'sent'} order ${orderNo}: ${lines.length} lines, ${lines.reduce((n, l) => n + l.qty, 0)} pcs`, body: 'Generate the picklist, print it for preparation and send it to the warehouse for the final check.', link: `/franchise-orders/order/${o.id}` });
    await this.audit.log({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'FranchiseOrder', entityId: o.id, after: { orderNo, lines: lines.length } });
    return this.getOrder(user, o.id);
  }

  // ── orders ──
  async listOrders(user: SessionUser, q: { availabilityId?: string; status?: string }) {
    if (!user.permissions.has('fo.view')) throw new ForbiddenException();
    const where: Prisma.FranchiseOrderWhereInput = { ...(q.availabilityId ? { availabilityId: q.availabilityId } : {}), ...(q.status ? { status: q.status } : {}), ...(this.isFranchiseUser(user) ? { franchiseLocationId: { in: user.locationIds } } : {}) };
    const rows = await this.prisma.db.franchiseOrder.findMany({ where, include: { lines: true, availability: { select: { listNo: true } } }, orderBy: { orderedAt: 'desc' }, take: 200 });
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    return rows.map((o) => ({ id: o.id, orderNo: o.orderNo, listNo: o.availability.listNo, availabilityId: o.availabilityId, franchise: locs.get(o.franchiseLocationId) ?? '', status: o.status, orderedAt: o.orderedAt, orderedByName: o.orderedByName, picklistNo: o.picklistNo, salesDocId: o.salesDocId, lines: o.lines.length, pcs: o.lines.reduce((n, l) => n + (o.status === 'CHECKING' || o.status === 'APPROVED' || o.status === 'DR_MADE' ? l.checkedQty ?? l.qty : l.qty), 0) }));
  }
  async getOrder(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.view')) throw new ForbiddenException();
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id }, include: { lines: true, availability: { select: { listNo: true } } } }); if (!o) throw new NotFoundException();
    if (this.isFranchiseUser(user) && !user.locationIds.includes(o.franchiseLocationId)) throw new ForbiddenException();
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: o.lines.map((l) => l.productId) } }, select: { id: true, sku: true, name: true } })).map((p) => [p.id, p]));
    const showPrice = this.isFranchiseUser(user) || user.permissions.has('price.view.FRANCHISE'); const prices = showPrice ? await this.master.currentPrices(o.lines.map((l) => l.productId)) : null;
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: o.franchiseLocationId }, select: { name: true } });
    const sale = o.salesDocId ? await requestContext.runSystem(async () => await this.prisma.db.salesDoc.findUnique({ where: { id: o.salesDocId! }, select: { id: true, drSiNo: true } })) : null;
    return { id: o.id, orderNo: o.orderNo, listNo: o.availability.listNo, availabilityId: o.availabilityId, franchise: loc.name, franchiseLocationId: o.franchiseLocationId, status: o.status, notes: o.notes, orderedByName: o.orderedByName, orderedAt: o.orderedAt, picklistNo: o.picklistNo, picklistAt: o.picklistAt, sentToWarehouseAt: o.sentToWarehouseAt, checkedByName: o.checkedByName, checkedAt: o.checkedAt, checkNote: o.checkNote, cancelReason: o.cancelReason, dr: sale,
      lines: o.lines.map((l) => ({ id: l.id, productId: l.productId, sku: prods.get(l.productId)?.sku ?? '', product: prods.get(l.productId)?.name ?? '', flavor: l.flavor, qty: l.qty, checkedQty: l.checkedQty, price: prices?.get(l.productId)?.FRANCHISE != null ? Number(prices.get(l.productId)!.FRANCHISE) : null })).sort((a, b) => a.product.localeCompare(b.product) || (a.flavor ?? '').localeCompare(b.flavor ?? '')) };
  }

  /** 5. the order becomes a picklist for the Franchise Coordinator. */
  async generatePicklist(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id } }); if (!o) throw new NotFoundException();
    if (o.status !== 'ORDERED') throw new BadRequestException('The picklist was already made');
    const picklistNo = await this.nextNo('FRANCHISE_PICKLIST', 'PL', 4);
    await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'PICKLIST', picklistNo, picklistAt: new Date() } });
    await this.audit.log({ action: 'PICKLIST', entityType: 'FranchiseOrder', entityId: id, after: { picklistNo } });
    return this.getOrder(user, id);
  }
  async sendToWarehouse(user: SessionUser, id: string) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id } }); if (!o) throw new NotFoundException();
    if (!['PICKLIST', 'CHECKING'].includes(o.status)) throw new BadRequestException('Make the picklist first');
    await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'CHECKING', sentToWarehouseAt: new Date(), checkNote: null } });
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: o.franchiseLocationId }, select: { name: true } });
    await this.notify.toRoles([...WH_ROLES], { type: 'FRANCHISE_ORDER', title: `${o.picklistNo}: ${loc.name} order ${o.orderNo} is prepared: please do the final check`, body: 'Check the goods against the picklist, correct a quantity if needed, then approve it. The Franchise Coordinator then makes the DR.', link: `/franchise-orders/order/${id}` });
    return this.getOrder(user, id);
  }

  /** 6. the warehouse's final check: it may change the quantities; approving lets the Coordinator make the DR. */
  async check(user: SessionUser, id: string, input: { lines?: { lineId: string; checkedQty: number }[]; note?: string; decision: 'APPROVE' | 'RETURN' }) {
    if (!user.permissions.has('fo.review')) throw new ForbiddenException('Only the warehouse does the final check');
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id }, include: { lines: true } }); if (!o) throw new NotFoundException();
    if (o.status !== 'CHECKING') throw new BadRequestException('This order is not waiting for the final check');
    for (const x of input.lines ?? []) { const l = o.lines.find((y) => y.id === x.lineId); if (!l) throw new BadRequestException('Unknown line'); const q = nat(x.checkedQty, 'The quantity'); if (q > l.qty) throw new BadRequestException('The warehouse cannot give more than the franchise ordered'); await this.prisma.db.franchiseOrderLine.update({ where: { id: l.id }, data: { checkedQty: q } }); }
    if (input.decision === 'RETURN') {
      if (!input.note?.trim()) throw new BadRequestException('Say what is wrong so the coordinator can fix it');
      await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'PICKLIST', checkNote: input.note.trim() } });
      await this.notify.toRoles([...COORD_ROLES], { type: 'FRANCHISE_ORDER', title: `${o.picklistNo}: the warehouse sent it back: ${input.note.trim()}`, link: `/franchise-orders/order/${id}` });
      return this.getOrder(user, id);
    }
    const fresh = await this.prisma.db.franchiseOrderLine.findMany({ where: { orderId: id } });
    const need = new Map<string, number>(); for (const l of fresh) { const q = l.checkedQty ?? l.qty; if (q > 0) need.set(`${l.productId}|${fk(l.flavor)}`, (need.get(`${l.productId}|${fk(l.flavor)}`) ?? 0) + q); }
    if (!need.size) throw new BadRequestException('Nothing is being given: return the order to the coordinator instead');
    const stock = await this.stockByFlavor([...new Set(fresh.map((l) => l.productId))]);
    for (const [k, q] of need) { const [pid, f] = k.split('|'); const have = stock.get(pid)?.get(f) ?? 0; if (have < q) { const p = await this.prisma.db.product.findUnique({ where: { id: pid }, select: { name: true } }); throw new BadRequestException(`The warehouse has only ${have} of ${p?.name ?? 'an item'}${f ? ` (${f})` : ''}; lower the quantity`); } }
    for (const l of fresh) if (l.checkedQty == null) await this.prisma.db.franchiseOrderLine.update({ where: { id: l.id }, data: { checkedQty: l.qty } });
    await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'APPROVED', checkedBy: user.id, checkedByName: user.fullName, checkedAt: new Date(), checkNote: input.note?.trim() || null } });
    await this.notify.toRoles([...COORD_ROLES], { type: 'FRANCHISE_ORDER', title: `${o.picklistNo}: approved by the warehouse (${user.fullName}): generate the DR`, link: `/franchise-orders/order/${id}` });
    await this.audit.log({ action: 'FINAL_CHECK', entityType: 'FranchiseOrder', entityId: id, userId: user.id });
    return this.getOrder(user, id);
  }

  /** The DR from the approved order: the usual franchise sale from the warehouse (the franchise is told and confirms receipt; unpaid goods show in Franchise AR). */
  async makeDr(user: SessionUser, id: string, input: { drSiNo: string; paymentMode?: 'AR_PDC' | 'CASH'; dueDate?: string | null; franchiseShipping?: { mode: 'NONE' | 'TO_FOLLOW' | 'AMOUNT'; amount?: number; courier?: string } }) {
    if (!user.permissions.has('fo.generate')) throw new ForbiddenException();
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id }, include: { lines: true } }); if (!o) throw new NotFoundException();
    if (o.status !== 'APPROVED') throw new BadRequestException('The warehouse has not approved this order yet');
    if (!input.drSiNo?.trim()) throw new BadRequestException('Type the DR number');
    const w = await this.warehouse();
    const customer = await requestContext.runSystem(async () => await this.prisma.db.customer.findFirst({ where: { type: 'FRANCHISE', locationId: o.franchiseLocationId }, select: { id: true } }));
    if (!customer) throw new BadRequestException('This franchise has no customer account yet: ask Accounting to add it');
    // each flavor is sold from the warehouse batches of that flavor, the nearest expiry first
    const today = todayManila(); const lines: { productId: string; qty: number; batchId: string; exactBatch: boolean }[] = [];
    for (const l of o.lines) {
      let left = l.checkedQty ?? l.qty; if (left <= 0) continue;
      const bal = await requestContext.runSystem(async () => await this.prisma.db.stockBalance.findMany({ where: { locationId: w.id, productId: l.productId, qty: { gt: 0 }, batch: { flavor: l.flavor ?? null, OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] } }, include: { batch: { select: { expiryDate: true } } } }));
      bal.sort((a, b) => (a.batch.expiryDate?.getTime() ?? 9e15) - (b.batch.expiryDate?.getTime() ?? 9e15));
      for (const b of bal) { if (left <= 0) break; const take = Math.min(b.qty, left); lines.push({ productId: l.productId, qty: take, batchId: b.batchId, exactBatch: true }); left -= take; }
      if (left > 0) { const p = await this.prisma.db.product.findUnique({ where: { id: l.productId }, select: { name: true } }); throw new BadRequestException(`The warehouse no longer has enough ${p?.name ?? 'stock'}${l.flavor ? ` (${l.flavor})` : ''}: ask the warehouse to lower the quantity`); }
    }
    const terms = (await this.ar.rules()).termsDays;
    const paymentMode = input.paymentMode ?? 'AR_PDC';
    const sale = await this.sales.create({ locationId: w.id, channel: 'FRANCHISE', customerId: customer.id, paymentMode, drSiNo: input.drSiNo.trim(), dueDate: paymentMode === 'AR_PDC' ? input.dueDate ?? dateStr(addDays(today, terms)) : null, franchiseShipping: input.franchiseShipping ?? { mode: 'NONE' }, notes: `Order ${o.orderNo}${o.picklistNo ? ` · picklist ${o.picklistNo}` : ''}`, lines }, user);
    await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'DR_MADE', salesDocId: sale.id } });
    await this.audit.log({ action: 'DR_MADE', entityType: 'FranchiseOrder', entityId: id, after: { saleId: sale.id, drSiNo: sale.drSiNo } });
    return this.getOrder(user, id);
  }

  async cancel(user: SessionUser, id: string, reason: string) {
    const o = await this.prisma.db.franchiseOrder.findUnique({ where: { id } }); if (!o) throw new NotFoundException();
    const coord = user.permissions.has('fo.generate'); const own = this.isFranchiseUser(user) && user.locationIds.includes(o.franchiseLocationId) && o.status === 'ORDERED';
    if (!coord && !own) throw new ForbiddenException();
    if (['DR_MADE', 'CANCELLED'].includes(o.status)) throw new BadRequestException('This order can no longer be cancelled');
    if (!reason?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.franchiseOrder.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason.trim() } });
    await this.notify.toLocation(o.franchiseLocationId, { type: 'FRANCHISE_ORDER', title: `Order ${o.orderNo} was cancelled: ${reason.trim()}`, link: `/franchise-orders/order/${id}` });
    await this.notify.toRoles([...COORD_ROLES], { type: 'FRANCHISE_ORDER', title: `Order ${o.orderNo} was cancelled: ${reason.trim()}`, link: `/franchise-orders/order/${id}` });
    return this.getOrder(user, id);
  }

  /** The picklist for preparation: what to pick, by flavor, with the batches to take first (nearest expiry); blank boxes for the checker. */
  async picklistPdf(user: SessionUser, id: string) {
    if (!(user.permissions.has('fo.generate') || user.permissions.has('fo.review'))) throw new ForbiddenException();
    const o = await this.getOrder(user, id); const w = await this.warehouse(); const today = todayManila();
    const rows: string[] = [];
    for (const l of o.lines) {
      const bal = await requestContext.runSystem(async () => await this.prisma.db.stockBalance.findMany({ where: { locationId: w.id, productId: l.productId, qty: { gt: 0 }, batch: { flavor: l.flavor ?? null, OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] } }, include: { batch: { select: { batchNo: true, expiryDate: true } } } }));
      bal.sort((a, b) => (a.batch.expiryDate?.getTime() ?? 9e15) - (b.batch.expiryDate?.getTime() ?? 9e15));
      let left = l.checkedQty ?? l.qty; const picks: string[] = []; for (const b of bal) { if (left <= 0) break; const t = Math.min(b.qty, left); picks.push(`${t} × batch ${esc(b.batch.batchNo)}${b.batch.expiryDate ? ` (exp ${dateStr(b.batch.expiryDate)})` : ''}`); left -= t; }
      rows.push(`<tr><td>${esc(l.sku)}</td><td>${esc(l.product)}</td><td>${esc(l.flavor ?? '')}</td><td class="n"><b>${l.checkedQty ?? l.qty}</b></td><td>${picks.join('<br>') || '<i>no stock</i>'}</td><td class="box"></td><td class="box"></td></tr>`);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111}table{border-collapse:collapse;width:100%;margin:6px 0}th{background:#FFF200;border:1px solid #222;padding:4px 6px;text-align:left}td{border:1px solid #666;padding:4px 6px;vertical-align:top}.n{text-align:right}.box{width:70px;height:28px}h1{font-size:18px;margin:6px 0}.muted{color:#555}.sig{display:flex;gap:30px;margin-top:30px}.sig div{border-top:1px solid #333;min-width:170px;padding-top:3px}</style></head><body>${await this.pdf.letterheadHtml()}
<h1>PICKLIST ${esc(o.picklistNo ?? '')} <span style="font-size:11px;font-weight:400">· order ${esc(o.orderNo)} · for preparation</span></h1>
<table><tr><td><b>Franchise:</b> ${esc(o.franchise)}<br><b>Ordered by:</b> ${esc(o.orderedByName ?? '')} on ${manilaDateStr(new Date(o.orderedAt))}</td><td><b>Availability list:</b> ${esc(o.listNo)}<br><b>Printed:</b> ${manilaDateStr()}${o.notes ? `<br><b>Note:</b> ${esc(o.notes)}` : ''}</td></tr></table>
<table><tr><th>SKU</th><th>Item</th><th>Flavor</th><th class="n">Qty</th><th>Take from (nearest expiry first)</th><th>Picked</th><th>Checked</th></tr>${rows.join('')}</table>
<p class="muted">Total ${o.lines.reduce((n, l) => n + (l.checkedQty ?? l.qty), 0)} pcs. After preparing, hand it to the warehouse for the final check; once approved the Franchise Coordinator generates the DR.</p>
<div class="sig"><div>Prepared by</div><div>Final check (warehouse)</div><div>Franchise Coordinator</div></div></body></html>`;
    const out = await this.pdf.render(html);
    return { ...out, fileName: `${o.picklistNo ?? o.orderNo}.${out.ext}` };
  }
}
