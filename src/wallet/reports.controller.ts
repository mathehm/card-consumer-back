import {
  Controller,
  Get,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { PerformanceInterceptor } from '../common/interceptors/performance.interceptor';
import { ErrorInterceptor } from '../common/interceptors/error.interceptor';

@Controller('reports')
@UseInterceptors(PerformanceInterceptor, ErrorInterceptor)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales-today')
  async getSalesToday() {
    return await this.reportsService.getSalesToday();
  }

  @Get('sales-by-product/:productId')
  async getSalesByProduct(@Param('productId') productId: string) {
    return await this.reportsService.getSalesByProduct(productId);
  }

  @Get('sales-by-period')
  async getSalesByPeriod(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    if (!startDate || !endDate) {
      throw new Error('startDate e endDate são obrigatórios');
    }
    return await this.reportsService.getSalesByPeriod(startDate, endDate);
  }
}
