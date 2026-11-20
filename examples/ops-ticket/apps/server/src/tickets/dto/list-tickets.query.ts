import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListTicketsQuery {
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
