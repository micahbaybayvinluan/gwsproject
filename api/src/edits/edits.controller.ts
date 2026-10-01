import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { EditsService, type EditableKind } from './edits.service';
import { Audited, CurrentUser, RequireAnyPermission } from '../common/decorators';
import { Z } from '../common/zod.pipe';
import type { SessionUser } from '../common/request-context';

const RcvLine = z.object({ productId: z.string().uuid(), qty: z.number().int().min(0), freeQty: z.number().int().min(0).optional(), expiryDate: z.string().nullable().optional(), batchNo: z.string().nullable().optional(), unitCost: z.number().nonnegative().nullable().optional(), remarks: z.string().optional() }).refine((l) => l.qty + (l.freeQty ?? 0) > 0, { message: 'Quantity must be more than zero (no negative or empty lines)' });
const RcvEdit = z.object({ supplierId: z.string().uuid().optional(), supplierRef: z.string().nullable().optional(), docDate: z.string().optional(), notes: z.string().nullable().optional(), lines: z.array(RcvLine).min(1) });
const TrLine = z.object({ productId: z.string().uuid(), qty: z.number().int().positive(), batchId: z.string().uuid().nullable().optional(), checkerRemarks: z.string().optional() });
const TrEdit = z.object({ toLocationId: z.string().uuid().optional(), transferType: z.enum(['RESTOCK', 'RETURN', 'REPLACEMENT', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN', 'INTERNAL', 'MARKETING_PULLOUT']).optional(), endorseExpense: z.boolean().optional(), returnReason: z.string().nullable().optional(), docDate: z.string().optional(), notes: z.string().nullable().optional(), lines: z.array(TrLine).min(1) });

/** PUT /api/receiving/:id/edit and /api/transfers/:id/edit — direct for the preparer, acceptance-gated for anyone else. */
@Controller('api')
export class EditsController {
  constructor(private edits: EditsService) {}
  @Put('receiving/:id/edit') @RequireAnyPermission('receiving.create', 'warehouse.edit_others') @Audited('ReceivingDoc', 'EDIT')
  editReceiving(@Param('id') id: string, @Body(Z(RcvEdit)) dto: z.infer<typeof RcvEdit>, @CurrentUser() u: SessionUser) { return this.edits.edit('receiving', id, dto, u); }
  @Put('transfers/:id/edit') @RequireAnyPermission('transfer.create', 'warehouse.edit_others') @Audited('TransferDoc', 'EDIT')
  editTransfer(@Param('id') id: string, @Body(Z(TrEdit)) dto: z.infer<typeof TrEdit>, @CurrentUser() u: SessionUser) { return this.edits.edit('transfers', id, dto, u); }
  @Get(':kind/:id/edits') @RequireAnyPermission('receiving.create', 'transfer.create', 'transfer.confirm', 'warehouse.edit_others', 'report.inventory.all', 'report.inventory.own')
  list(@Param('kind') kind: EditableKind, @Param('id') id: string, @CurrentUser() u: SessionUser) { return this.edits.forDocument(kind, id, u); }
}
