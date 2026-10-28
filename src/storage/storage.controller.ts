/**
 * 源文件上传入口：`POST /storage/source`。
 *
 * 使用 multipart，字段名固定为 `file`。这里不解析正文，只把原始文件交给
 * `RustfsService` 写入 RustFS，并返回桶名、对象键和可访问地址。
 */
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import { RustfsService, type SourceFile } from './rustfs.service.js';

@Controller('storage')
export class StorageController {
  constructor(private readonly rustfsService: RustfsService) {}

  @Permissions(PermissionCode.DOCUMENT_CREATE)
  @Post('source')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8' }))
  uploadSource(@UploadedFile() file: SourceFile) {
    return this.rustfsService.uploadSourceFile(file);
  }
}
