import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller.js';
import { DocumentService } from './document.service.js';
import { Document } from './entities/document.entity.js';
import {
  DocumentContent,
  DocumentContentSchema,
} from './schema/document.content.schema.js';

const mongoUri =
  process.env.MONGODB_URI ??
  'mongodb://mongo_user:mongo_pass123@127.0.0.1:27017/knowledge_hub?authSource=admin';

@Module({
  imports: [
    MongooseModule.forRoot(mongoUri),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      username: process.env.POSTGRES_USER ?? 'user',
      password: process.env.POSTGRES_PASSWORD ?? '123456',
      database: process.env.POSTGRES_DB ?? 'knowledge_hub',
      autoLoadEntities: true,
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Document]),
  ],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentModule {}
