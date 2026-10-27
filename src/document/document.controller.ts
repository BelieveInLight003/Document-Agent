import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SourceFile } from '../storage/rustfs.service.js';
import { DocumentService } from './document.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { DeleteDocumentDto } from './dto/delete-document.dto.js';
import { ParseUploadDto } from './dto/parse-upload.dto.js';
import { PublishDocumentDto } from './dto/publish-document.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';

@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  create(@Body() createDocumentDto: CreateDocumentDto) {
    return this.documentService.create(createDocumentDto);
  }

  @Post('upload/parse')
  @UseInterceptors(FileInterceptor('file'))
  parseUpload(
    @UploadedFile() file: SourceFile,
    @Body() parseUploadDto: ParseUploadDto,
  ) {
    return this.documentService.parseUpload(file, parseUploadDto);
  }

  @Put(':id/publish')
  publish(@Param('id') id: string) {
    return this.documentService.publish(id);
  }

  @Get()
  findAll() {
    return this.documentService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    return this.documentService.update(id, updateDocumentDto);
  }

  @Delete()
  remove(@Body() deleteDocumentDto: DeleteDocumentDto) {
    return this.documentService.remove(deleteDocumentDto);
  }
}
