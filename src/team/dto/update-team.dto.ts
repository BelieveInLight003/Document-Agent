import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { UserStatus } from '../../user/user-status.js';

/** 修改团队。只更新传入的字段。leaderId 传 null 表示取消负责人。 */
export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  teamName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  teamCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  leaderId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  parentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([UserStatus.DISABLED, UserStatus.ENABLED])
  status?: number;
}
