import { Module, Global } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreService } from './firestore.service';

@Global()
@Module({
  providers: [
    {
      provide: Firestore,
      useFactory: () => {
        return new Firestore({
          projectId: process.env.PROJECT_ID,
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        });
      },
    },
    FirestoreService,
  ],
  exports: [FirestoreService],
})
export class FirestoreModule { }
