import { Global, Module } from '@nestjs/common';
import { CashFundService } from './cashfund.service';
import { CashFundController } from './cashfund.controller';
import { GlModule } from '../gl/gl.module';
import { ClosingModule } from '../closing/closing.module';

@Global()
@Module({ imports: [GlModule, ClosingModule], providers: [CashFundService], controllers: [CashFundController], exports: [CashFundService] })
export class CashFundModule {}
