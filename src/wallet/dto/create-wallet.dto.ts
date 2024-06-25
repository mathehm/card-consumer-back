import {
  IsNumber,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { UserDto } from './user.dto';
import { Type } from 'class-transformer';

export class CreateWalletDto {
  @IsNumber()
  code: number;

  @IsOptional()
  @IsNumber()
  balance?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => UserDto)
  user: UserDto;
}
