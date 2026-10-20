import { IsNotEmpty, IsString, Matches } from 'class-validator';

const SNOWFLAKE_ID = /^\d+$/;

export class PublishDocumentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(SNOWFLAKE_ID)
  documentId: string;
}
