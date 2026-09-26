import { Module } from '@nestjs/common';
import { HelpController } from './help.controller';
import { HelpService } from './help.service';

@Module({ providers: [HelpService], controllers: [HelpController] })
export class HelpModule {}
