import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { snowflake } from '../../document/snowflake.js';
import { bigintTransformer } from '../bigint.js';

/** 角色。编码如 ROLE_ADMIN、ROLE_REVIEWER、ROLE_USER。 */
@Entity('kh_role')
export class Role {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({ name: 'role_name', type: 'varchar' })
  roleName: string;

  @Column({ name: 'role_code', type: 'varchar' })
  roleCode: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'smallint', default: 1 })
  status: number;
}
