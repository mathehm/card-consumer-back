import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [],
  providers: [AppService],
})
export class AppModule { }
