import { IsOptional, IsString, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ListWalletsDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    'balance_asc', 'balance_desc',
    'totalCredit_asc', 'totalCredit_desc',
    'createdAt_asc', 'createdAt_desc',
    'userName_asc', 'userName_desc',
    'code_asc', 'code_desc'
  ])
  sortBy?: string = 'createdAt_desc';

  @IsOptional()
  @IsString()
  @IsIn(['all', 'winner', 'eligible', 'ineligible'])
  status?: string = 'all';
}
