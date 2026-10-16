import { Module } from '@nestjs/common';
import { NteService } from './nte.service';
import { NteController } from './nte.controller';

@Module({ providers: [NteService], controllers: [NteController], exports: [NteService] })
export class NteModule {}
