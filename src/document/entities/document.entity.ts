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

@Entity('kh_document')
export class Document {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id: bigint;

  @BeforeInsert()
  assignSnowflakeId() {
    if (this.id == null) {
      this.id = BigInt(snowflake.generate());
    }
  }

  @Column({ type: 'varchar' })
  title: string;

  /** MongoDB document_content 的 _id */
  @Column({ name: 'content_id', type: 'varchar', unique: true })
  contentId: string;

  @Column({ type: 'varchar', nullable: true })
  summary: string | null;

  @Column({
    name: 'category_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  categoryId: bigint | null;

  @Column({
    name: 'team_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  teamId: bigint | null;

  @Column({
    name: 'author_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  authorId: bigint | null;

  @Column({ name: 'cover_image', type: 'varchar', nullable: true })
  coverImage: string | null;

  @Column({ type: 'varchar', nullable: true })
  tags: string | null;

  @Column({ type: 'smallint', default: 0 })
  status: number;

  @Column({ type: 'varchar', nullable: true })
  remark: string | null;

  @Column({ name: 'view_count', type: 'int', default: 0 })
  viewCount: number;

  @Column({ name: 'like_count', type: 'int', default: 0 })
  likeCount: number;

  @Column({ name: 'comment_count', type: 'int', default: 0 })
  commentCount: number;

  @Column({ name: 'favourite_count', type: 'int', default: 0 })
  favouriteCount: number;

  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount: number;

  @Column({ name: 'publish_time', type: 'timestamp', nullable: true })
  publishTime: Date | null;

  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @Column({
    name: 'create_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  createBy: bigint | null;

  @Column({
    name: 'update_by',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  updateBy: bigint | null;

  @Column({ type: 'boolean', default: false })
  deleted: boolean;
}
