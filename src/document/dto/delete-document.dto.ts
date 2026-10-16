import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class DeleteDocumentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(SNOWFLAKE_ID)
  id: string;

  @IsOptional()
  @IsString()
  @Matches(SNOWFLAKE_ID)
  updateBy?: string;
}
