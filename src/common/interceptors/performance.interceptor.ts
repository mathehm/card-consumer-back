import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Log performance apenas para operações demoradas (>500ms)
        if (duration > 500) {
          this.logger.warn({
            message: `Slow operation detected: ${method} ${url} took ${duration}ms`,
            method,
            url,
            duration,
            threshold: 'slow',
            context: 'PerformanceInterceptor'
          });
        } else if (duration > 100) {
          this.logger.log({
            message: `${method} ${url} completed in ${duration}ms`,
            method,
            url,
            duration,
            threshold: 'normal',
            context: 'PerformanceInterceptor'
          });
        }
      })
    );
  }
}
