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

/** 权限。父级 parentId 为 0 表示根节点。 */
@Entity('kh_permission')
export class Permission {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({
    name: 'parent_id',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  parentId: bigint;

  @Column({ name: 'permission_name', type: 'varchar' })
  permissionName: string;

  @Column({ name: 'permission_code', type: 'varchar' })
  permissionCode: string;

  @Column({ name: 'permission_type', type: 'smallint' })
  permissionType: number;

  @Column({ name: 'menu_url', type: 'varchar', nullable: true })
  menuUrl: string | null;

  @Column({ name: 'api_url', type: 'varchar', nullable: true })
  apiUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  method: string | null;

  @Column({ type: 'varchar', nullable: true })
  icon: string | null;

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
