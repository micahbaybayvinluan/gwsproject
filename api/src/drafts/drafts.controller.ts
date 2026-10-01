import { Controller, Delete, Param, BadRequestException } from '@nestjs/common';
import { Audited, CurrentUser } from '../common/decorators';
import type { SessionUser } from '../common/request-context';
import { DraftsService, type DraftKind } from './drafts.service';

const KINDS: DraftKind[] = ['transfer', 'receiving', 'count', 'inspection'];

@Controller('api/drafts')
export class DraftsController {
  constructor(private svc: DraftsService) {}
  /** Deletes an unfinished draft; the permission is checked per kind (the person who prepared it, the In-Charge / Head Auditor, the Owner). */
  @Delete(':kind/:id') @Audited('Draft', 'DELETE') remove(@Param('kind') kind: string, @Param('id') id: string, @CurrentUser() u: SessionUser) {
    if (!KINDS.includes(kind as DraftKind)) throw new BadRequestException('Unknown kind of draft');
    return this.svc.remove(kind as DraftKind, id, u);
  }
}
