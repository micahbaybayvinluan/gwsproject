import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { SequenceService } from '../common/sequence.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TransfersService } from './transfers.service';
import { requestContext, type SessionUser } from '../common/request-context';
import { dateStr, todayManila } from '../common/manila';

const HANDLERS = ['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE', 'ADMIN'];

/**
 * A branch's request for stock from the warehouse (owner request 2026-10-15). The request is a record the Warehouse In-Charge opens: the items are already
 * listed, so the In-Charge only changes the quantities (or removes an item) and makes the pull-out from it; the branch just receives the Transfer-In.
 */
@Injectable()
export class StockRequestsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notify: NotificationsService, private transfers: TransfersService) {}

  private isHandler(user: SessionUser) { return HANDLERS.includes(user.roleKey); }

  async create(user: SessionUser, input: { locationId?: string; items: { productId: string; qty: number }[]; notes?: string }) {
    const locationId = input.locationId ?? user.locationIds[0];
    if (!locationId) throw new BadRequestException('locationId required');
    if (user.locationScoped && !user.locationIds.includes(locationId)) throw new ForbiddenException();
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: locationId } });
    const merged = new Map<string, number>(); for (const i of input.items) { if (!(i.qty > 0)) throw new BadRequestException('Each quantity must be more than zero'); merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.qty); }
    const products = await this.prisma.db.product.findMany({ where: { id: { in: [...merged.keys()] }, active: true }, select: { id: true, name: true } });
    if (products.length !== merged.size) throw new BadRequestException('One of the products was not found');
    const year = todayManila().getUTCFullYear();
    const r = await this.prisma.db.$transaction(async (tx) => {
      const n = await this.seq.next(tx, 'STOCK_REQUEST', { locationId: String(year), year, prefix: 'SR', pad: 4 });
      const no = Number(/(\d+)$/.exec(n)![1]);
      return tx.stockRequest.create({ data: { requestNo: `SR-${year}-${String(no).padStart(4, '0')}`, locationId, notes: input.notes?.trim() || null, requestedBy: user.id, requestedByName: user.fullName, lines: { create: [...merged].map(([productId, qty]) => ({ productId, requestedQty: qty, qty })) } } });
    });
    const list = [...merged].map(([pid, q]) => `${q}× ${products.find((p) => p.id === pid)?.name}`).join(', ');
    await this.notify.toRoles(['WAREHOUSE_IN_CHARGE', 'WAREHOUSE_ASSOCIATE'], { type: 'STOCK_REQUEST', title: `Stock request ${r.requestNo} from ${loc.name} (${user.fullName})`, body: `${list}${input.notes ? ` — ${input.notes}` : ''}`, link: '/transfers' });
    await this.audit.log({ action: 'STOCK_REQUEST', entityType: 'StockRequest', entityId: r.id, after: { requestNo: r.requestNo, items: input.items } });
    return { ok: true, id: r.id, requestNo: r.requestNo, sentTo: 'Warehouse', items: list };
  }

  async list(user: SessionUser, q: { status?: string }) {
    const handler = this.isHandler(user);
    const where = { ...(q.status ? { status: q.status } : {}), ...(handler ? {} : { locationId: { in: user.locationIds } }) };
    const rows = await this.prisma.db.stockRequest.findMany({ where, include: { lines: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const locs = new Map((await this.prisma.db.location.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const prods = new Map((await this.prisma.db.product.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.productId)))] } }, select: { id: true, sku: true, name: true } })).map((p) => [p.id, p]));
    const wh = await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE', active: true }, select: { id: true } });
    const stock = wh ? await this.prisma.db.stockBalance.groupBy({ by: ['productId'], where: { locationId: wh.id, productId: { in: [...prods.keys()] } }, _sum: { qty: true } }) : [];
    return rows.map((r) => ({ id: r.id, requestNo: r.requestNo, status: r.status, branch: locs.get(r.locationId) ?? '', locationId: r.locationId, notes: r.notes, requestedByName: r.requestedByName, createdAt: r.createdAt, handledAt: r.handledAt, transferId: r.transferId, declineNote: r.declineNote,
      lines: r.lines.map((l) => ({ id: l.id, productId: l.productId, sku: prods.get(l.productId)?.sku ?? '', product: prods.get(l.productId)?.name ?? '', requestedQty: l.requestedQty, qty: l.qty, warehouseOnHand: handler ? stock.find((s) => s.productId === l.productId)?._sum.qty ?? 0 : undefined })).sort((a, b) => a.product.localeCompare(b.product)) }));
  }

  private async open(user: SessionUser, id: string) {
    if (!this.isHandler(user)) throw new ForbiddenException('Only the warehouse prepares stock requests');
    const r = await this.prisma.db.stockRequest.findUnique({ where: { id }, include: { lines: true } }); if (!r) throw new NotFoundException();
    if (r.status !== 'OPEN') throw new BadRequestException('This request has already been handled');
    return r;
  }

  /** The In-Charge changes the quantities to send (0 removes the item). */
  async update(user: SessionUser, id: string, lines: { lineId: string; qty: number }[]) {
    const r = await this.open(user, id);
    for (const l of lines) { if (!r.lines.some((x) => x.id === l.lineId)) throw new BadRequestException('Unknown line'); if (!Number.isInteger(l.qty) || l.qty < 0) throw new BadRequestException('Quantities are whole numbers, 0 or more'); }
    await this.prisma.db.$transaction(lines.map((l) => this.prisma.db.stockRequestLine.update({ where: { id: l.lineId }, data: { qty: l.qty } })));
    return (await this.list(user, {})).find((x) => x.id === id);
  }

  /** Makes the draft pull-out (warehouse → the branch) with the edited quantities; the In-Charge checks it and submits it as usual. */
  async prepare(user: SessionUser, id: string) {
    const r = await this.open(user, id);
    const send = r.lines.filter((l) => l.qty > 0);
    if (!send.length) throw new BadRequestException('Nothing is left to send: use Decline if the branch cannot be given anything');
    const from = user.locationIds.length ? (await this.prisma.db.location.findFirst({ where: { id: { in: user.locationIds }, type: 'WAREHOUSE' } }))?.id : (await this.prisma.db.location.findFirst({ where: { type: 'WAREHOUSE', active: true } }))?.id;
    if (!from) throw new BadRequestException('No warehouse found for your account');
    const doc = await this.transfers.create({ fromLocationId: from, toLocationId: r.locationId, transferType: 'RESTOCK', notes: `Stock request ${r.requestNo}`, lines: send.map((l) => ({ productId: l.productId, qty: l.qty })) }, user);
    await this.prisma.db.stockRequest.update({ where: { id }, data: { status: 'PREPARED', handledBy: user.id, handledAt: new Date(), transferId: doc.id } });
    const loc = await this.prisma.db.location.findUniqueOrThrow({ where: { id: r.locationId } });
    await this.notify.toLocation(r.locationId, { type: 'STOCK_REQUEST_PREPARED', title: `${r.requestNo}: the warehouse is preparing your stock (${send.length} item${send.length === 1 ? '' : 's'}${send.some((l) => l.qty !== l.requestedQty) ? ', some quantities changed' : ''})`, body: `You will receive the Transfer-In copy under Incoming for ${loc.name}.`, link: `/transfers/${doc.id}` });
    await this.audit.log({ action: 'STOCK_REQUEST_PREPARED', entityType: 'StockRequest', entityId: id, after: { transferId: doc.id } });
    return { id, transferId: doc.id, controlNo: doc.controlNo };
  }

  async decline(user: SessionUser, id: string, note: string) {
    const r = await this.open(user, id);
    if (!note?.trim()) throw new BadRequestException('Give the reason');
    await this.prisma.db.stockRequest.update({ where: { id }, data: { status: 'DECLINED', handledBy: user.id, handledAt: new Date(), declineNote: note.trim() } });
    await this.notify.toLocation(r.locationId, { type: 'STOCK_REQUEST_DECLINED', title: `${r.requestNo}: the warehouse cannot send this now`, body: note.trim(), link: '/transfers' });
    return { id };
  }
}
