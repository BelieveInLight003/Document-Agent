import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { snowflake } from '../../document/snowflake.js';

export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null) => (value == null ? value : value.toString()),
  from: (value?: string | null) => (value == null ? value : BigInt(value)),
};

@Entity('kh_chat_session')
export class ChatSession {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({ name: 'user_id', type: 'bigint', transformer: bigintTransformer })
  userId: bigint;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
