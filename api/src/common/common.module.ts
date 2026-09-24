import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { SequenceService } from './sequence.service';
import { SettingsService } from './settings.service';
import { ScopeService } from './scope.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, SequenceService, SettingsService, ScopeService],
  exports: [PrismaService, AuditService, SequenceService, SettingsService, ScopeService],
})
export class CommonModule {}
