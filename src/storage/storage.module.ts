/**
 * 对象存储模块。
 *
 * 知识库把一篇文档拆在三个地方：
 * - PostgreSQL `kh_document`：标题、分类、作者等元数据
 * - MongoDB `document_content`：正文
 * - RustFS：pdf / docx / xlsx 等源文件本身
 *
 * 本模块只负责第三块。RustFS 兼容 S3，接口在 9000，网页控制台在 9001。
 * 连接信息来自 `.env` 的 `RUSTFS_*`。`RustfsService` 已导出，文档模块以后可以直接注入，
 * 在创建或删除文档时附带上传、删除源文件。
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RustfsService } from './rustfs.service.js';
import { StorageController } from './storage.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [StorageController],
  providers: [RustfsService],
  exports: [RustfsService],
})
export class StorageModule {}
