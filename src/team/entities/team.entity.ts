import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { snowflake } from '../../document/snowflake.js';
import { bigintTransformer } from '../../user/bigint.js';

/**
 * 团队。parentId 为 0 表示根团队。
 * leaderId 指向负责人，对应的成员行角色是 leader。
 */
@Entity('kh_team')
export class Team {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({ name: 'team_name', type: 'varchar' })
  teamName: string;

  @Column({ name: 'team_code', type: 'varchar', nullable: true })
  teamCode: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({
    name: 'leader_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  leaderId: bigint | null;

  @Column({
    name: 'parent_id',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  parentId: bigint;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'smallint', default: 1 })
  status: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
