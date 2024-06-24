import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { FirestoreService } from './firestore/firestore.service';

@Controller('wallet')
export class WalletController {
  constructor(private readonly firestoreService: FirestoreService) { }

  @Post('register')
  async registerWallet(@Body() walletData: any) {
    try {
      const result = await this.firestoreService.registerWallet(walletData);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':code')
  async getWalletByCode(@Param('code', ParseIntPipe) code: number) {
    try {
      const result = await this.firestoreService.getWalletByCode(code);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Delete(':code')
  async deleteWallet(@Param('code', ParseIntPipe) code: number) {
    try {
      const result = await this.firestoreService.deleteWallet(code);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':code/credit')
  async credit(
    @Param('code', ParseIntPipe) code: number,
    @Body('value') value: number,
  ) {
    try {
      const result = await this.firestoreService.credit(code, value);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':code/debit')
  async debit(
    @Param('code', ParseIntPipe) code: number,
    @Body('value') value: number,
  ) {
    try {
      const result = await this.firestoreService.debit(code, value);
      return result;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
}
