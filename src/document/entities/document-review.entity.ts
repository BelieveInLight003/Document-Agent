import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { snowflake } from '../snowflake.js';

const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null) => (value == null ? value : value.toString()),
  from: (value?: string | null) => (value == null ? value : BigInt(value)),
};

@Entity('kh_document_review')
export class DocumentReview {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({
    name: 'document_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  documentId: bigint;

  @Column({
    name: 'reviewer_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  reviewerId: bigint | null;

  @Column({
    name: 'submitter_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  submitterId: bigint | null;

  @Column({ name: 'status_before', type: 'smallint' })
  statusBefore: number;

  @Column({ name: 'status_after', type: 'smallint', nullable: true })
  statusAfter: number | null;

  @Column({ name: 'review_status', type: 'smallint', default: 0 })
  reviewStatus: number;

  @Column({ type: 'varchar', nullable: true })
  opinion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
