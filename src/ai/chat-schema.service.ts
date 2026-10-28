import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** 已有库不会重跑 init.sql，启动时把会话表和消息表补上。 */
@Injectable()
export class ChatSchemaService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS kh_chat_session (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        title VARCHAR(200) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_kh_chat_session_user_id
        ON kh_chat_session (user_id, updated_at DESC)
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS kh_chat_message (
        id BIGINT PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES kh_chat_session(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_kh_chat_message_session_id
        ON kh_chat_message (session_id, created_at, id)
    `);
  }
}
