import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        const request = context.switchToHttp().getRequest();
        const { method, url, body } = request;

        // Log detalhado do erro
        this.logger.error({
          message: `Error in ${method} ${url}`,
          method,
          url,
          error: error.message,
          stack: error.stack,
          body: this.sanitizeBody(body),
          context: 'ErrorInterceptor'
        });

        // Mapear erros específicos para códigos HTTP apropriados
        if (error.message.includes('não encontrada') || error.message.includes('não encontrado')) {
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
        }

        if (error.message.includes('Saldo insuficiente') || 
            error.message.includes('já existe') ||
            error.message.includes('mesma carteira') ||
            error.message.includes('já foi cancelada')) {
          throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
        }

        if (error.message.includes('não pertence')) {
          throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        }

        // Erro genérico do servidor
        throw new HttpException(
          'Erro interno do servidor. Tente novamente.',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      })
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;
    
    // Remover informações sensíveis dos logs
    const sanitized = { ...body };
    if (sanitized.password) sanitized.password = '***';
    if (sanitized.token) sanitized.token = '***';
    
    return sanitized;
  }
}
