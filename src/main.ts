import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Configuração CORS para permitir requisições do frontend
  app.enableCors({
    origin: [
      'http://localhost:4200',  // Angular dev server
      'http://localhost:3000',  // Mesmo servidor (caso necessário)
      'http://127.0.0.1:4200',  // Variação de localhost
      'http://127.0.0.1:3000',  // Variação de localhost
      'https://card-consumer-admin.vercel.app'  // Frontend Vercel
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true, // Permitir cookies e headers de autenticação
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin'
    ]
  });
  
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(parseInt(process.env.PORT) || 3000);
}
bootstrap();
