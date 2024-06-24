import { Module } from '@nestjs/common';
import { WalletController } from './app.controller';
import { AppService } from './app.service';
import { FirestoreModule } from './firestore/firestore.module';

@Module({
  imports: [FirestoreModule],
  controllers: [WalletController],
  providers: [AppService],
})
export class AppModule { }
