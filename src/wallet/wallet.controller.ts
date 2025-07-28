import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseInterceptors,
  ParseIntPipe,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { TransferDto } from './dto/transfer.dto';
import { CancelTransactionDto } from './dto/cancel-transaction.dto';
import { DebitDto } from './dto/debit.dto';
import { PerformanceInterceptor } from '../common/interceptors/performance.interceptor';
import { ErrorInterceptor } from '../common/interceptors/error.interceptor';

@Controller('wallet')
@UseInterceptors(PerformanceInterceptor, ErrorInterceptor)
export class WalletController {
  constructor(private readonly walletService: WalletService) { }

  @Post('register')
  async create(@Body() createWalletDto: CreateWalletDto) {
    return await this.walletService.create(createWalletDto);
  }

  @Get(':code')
  async findOne(@Param('code', ParseIntPipe) code: number) {
    return await this.walletService.findOne(code);
  }

  @Delete(':code')
  async remove(@Param('code', ParseIntPipe) code: number) {
    return await this.walletService.remove(code);
  }

  @Post(':code/credit')
  async credit(
    @Param('code', ParseIntPipe) code: number, 
    @Body('value') value: number
  ) {
    return await this.walletService.credit(code, value);
  }

  @Post(':code/debit')
  async debit(
    @Param('code', ParseIntPipe) code: number, 
    @Body() debitDto: DebitDto
  ) {
    return await this.walletService.debit(code, debitDto);
  }

  @Post(':code/transfer')
  async transfer(
    @Param('code', ParseIntPipe) code: number, 
    @Body() transferDto: TransferDto
  ) {
    return await this.walletService.transfer(code, transferDto);
  }

  @Post(':code/cancel-transaction')
  async cancelTransaction(
    @Param('code', ParseIntPipe) code: number, 
    @Body() cancelDto: CancelTransactionDto
  ) {
    return await this.walletService.cancelTransaction(code, cancelDto);
  }
}


