import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [ConfigModule.forRoot(), WalletModule],
  controllers: [],
  providers: [],
})
export class AppModule { }
