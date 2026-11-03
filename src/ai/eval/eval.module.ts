import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../document/entities/document.entity.js';
import { GraphService } from '../../graph/graph.service.js';
import { AiService } from '../ai.service.js';

/**
 * 评测用的最小模块。
 * 只连 Postgres、文档检索和图谱，不启动整站。
 * 整站会再订阅一次 RabbitMQ，评测进程会把发布消息消费走。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('POSTGRES_HOST') ?? '127.0.0.1',
        port: Number(config.get<string>('POSTGRES_PORT') ?? 5432),
        username: config.get<string>('POSTGRES_USER') ?? 'user',
        password: config.get<string>('POSTGRES_PASSWORD') ?? '123456',
        database: config.get<string>('POSTGRES_DB') ?? 'knowledge_hub',
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Document]),
  ],
  providers: [AiService, GraphService],
})
export class EvalModule {}
