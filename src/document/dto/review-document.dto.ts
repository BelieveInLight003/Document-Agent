import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class SubmitReviewDto {
  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  submitterId?: string;

  @IsOptional()
  @IsString()
  opinion?: string;
}

export class RejectReviewDto {
  @IsString()
  @IsNotEmpty()
  @Matches(SNOWFLAKE_ID)
  reviewerId: string;

  @IsString()
  @IsNotEmpty()
  opinion: string;
}

export class ApproveReviewDto {
  @IsString()
  @IsNotEmpty()
  @Matches(SNOWFLAKE_ID)
  reviewerId: string;

  @IsOptional()
  @IsString()
  opinion?: string;
}
