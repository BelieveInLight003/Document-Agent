import { IsOptional, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class SubmitReviewDto {
  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  submitterId?: string;
}
