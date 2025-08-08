import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Firestore } from '@google-cloud/firestore';
import { CacheService } from '../common/services/cache.service';

@Module({
  controllers: [WalletController, ProductController, ReportsController],
  providers: [
    WalletService,
    ProductService,
    ReportsService,
    CacheService,
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
