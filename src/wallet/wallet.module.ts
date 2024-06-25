import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { Firestore } from '@google-cloud/firestore';

@Module({
  controllers: [WalletController],
  providers: [
    WalletService,
    {
      provide: Firestore,
      useFactory: () => {
        return new Firestore({
          projectId: process.env.PROJECT_ID,
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        });
      },
    },
  ],
})
export class WalletModule { }
