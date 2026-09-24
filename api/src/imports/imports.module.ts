import { Module } from '@nestjs/common';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';

@Module({ providers: [ImportsService], controllers: [ImportsController], exports: [ImportsService] })
export class ImportsModule {}
