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

/** 新建团队。parentId 不传时挂在根节点，leaderId 不传则暂不指定负责人。 */
export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  teamName: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  teamCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  leaderId?: string;

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
