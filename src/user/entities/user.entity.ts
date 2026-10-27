import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { snowflake } from '../../document/snowflake.js';
import { bigintTransformer } from '../bigint.js';

/** 用户。角色不在这张表上，通过 kh_user_role 关联 kh_role。 */
@Entity('kh_user')
export class User {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({ type: 'varchar' })
  username: string;

  @Column({ type: 'varchar' })
  password: string;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ name: 'real_name', type: 'varchar', nullable: true })
  realName: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar: string | null;

  @Column({ type: 'smallint', default: 1 })
  status: number;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
