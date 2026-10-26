import { IsOptional, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class ApproveReviewDto {
  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  reviewerId?: string;

  @IsOptional()
  @IsString()
  opinion?: string;
}
