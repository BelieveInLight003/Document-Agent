import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class RejectReviewDto {
  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  reviewerId?: string;

  @IsString()
  @IsNotEmpty()
  opinion: string;
}
