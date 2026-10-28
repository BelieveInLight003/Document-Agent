import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';
import { snowflake } from '../../document/snowflake.js';
import { bigintTransformer } from '../../user/bigint.js';

/** 团队成员。同一团队同一用户只能有一条，角色是 leader 或 member。 */
@Entity('kh_team_member')
export class TeamMember {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({
    name: 'team_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  teamId: bigint;

  @Column({
    name: 'user_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  userId: bigint;

  @Column({ name: 'member_role', type: 'varchar', default: 'member' })
  memberRole: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
