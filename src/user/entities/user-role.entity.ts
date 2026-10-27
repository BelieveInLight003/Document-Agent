import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';
import { snowflake } from '../../document/snowflake.js';
import { bigintTransformer } from '../bigint.js';

/** 用户和角色的关联。同一用户同一角色只能有一条。 */
@Entity('kh_user_role')
export class UserRole {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({
    name: 'user_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  userId: bigint;

  @Column({
    name: 'role_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  roleId: bigint;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
