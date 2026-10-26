import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineManagerModule } from '../pipelineManager/pipeline-manager.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentController } from './document.controller.js';
import { DocumentReviewController } from './document-review.controller.js';
import { DocumentReviewService } from './document-review.service.js';
import { DocumentService } from './document.service.js';
import { Document } from './entities/document.entity.js';
import { DocumentReview } from './entities/document-review.entity.js';
import {
  DocumentContent,
  DocumentContentSchema,
} from './schema/document.content.schema.js';

const defaultMongoUri =
  'mongodb://mongo_user:mongo_pass123@127.0.0.1:27017/knowledge_hub?authSource=admin';

@Module({
  imports: [
    StorageModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI') ?? defaultMongoUri,
      }),
    }),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
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
    TypeOrmModule.forFeature([Document, DocumentReview]),
    PipelineManagerModule,
  ],
  controllers: [DocumentController, DocumentReviewController],
  providers: [DocumentService, DocumentReviewService],
})
export class DocumentModule {}
