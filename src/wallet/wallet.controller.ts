import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) { }

  @Post('register')
  async create(@Body() createWalletDto: CreateWalletDto) {
    try {
      const result = await this.walletService.create(createWalletDto);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':code')
  async findOne(@Param('code') code: string) {
    try {
      const result = await this.walletService.findOne(+code);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Delete(':code')
  async remove(@Param('code') code: string) {
    try {
      const result = await this.walletService.remove(+code);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':code/credit')
  async credit(@Param('code') code: number, @Body('value') value: number) {
    try {
      const result = await this.walletService.credit(+code, value);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(':code/debit')
  async debit(@Param('code') code: number, @Body('value') value: number) {
    try {
      const result = await this.walletService.debit(+code, value);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
