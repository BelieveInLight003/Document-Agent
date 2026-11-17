import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserProfile } from '../user/user.service.js';
import { documentViewer } from './document-access.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionCode } from '../permission/permission-code.js';
import { Permissions } from '../permission/permissions.decorator.js';
import type { SourceFile } from '../storage/rustfs.service.js';
import { DocumentService } from './document.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { DeleteDocumentDto } from './dto/delete-document.dto.js';
import { ParseUploadDto } from './dto/parse-upload.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';

@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Permissions(PermissionCode.DOCUMENT_CREATE)
  @Post()
  create(
    @Req() request: Request & { user: UserProfile },
    @Body() createDocumentDto: CreateDocumentDto,
  ) {
    return this.documentService.create(
      createDocumentDto,
      documentViewer(request.user),
    );
  }

  @Permissions(PermissionCode.DOCUMENT_CREATE)
  @Post('upload/parse')
  @UseInterceptors(FileInterceptor('file', { defParamCharset: 'utf8' }))
  parseUpload(
    @Req() request: Request & { user: UserProfile },
    @UploadedFile() file: SourceFile,
    @Body() parseUploadDto: ParseUploadDto,
  ) {
    return this.documentService.parseUpload(
      file,
      parseUploadDto,
      documentViewer(request.user),
    );
  }

  @Permissions(PermissionCode.DOCUMENT_EDIT)
  @Put(':id/publish')
  publish(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
  ) {
    return this.documentService.publish(id, documentViewer(request.user));
  }

  @Permissions(PermissionCode.DOCUMENT, PermissionCode.DOCUMENT_LIST)
  @Get()
  findAll(@Req() request: Request & { user: UserProfile }) {
    return this.documentService.findAll(documentViewer(request.user));
  }

  @Permissions(PermissionCode.DOCUMENT, PermissionCode.DOCUMENT_LIST)
  @Get(':id')
  findOne(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
  ) {
    return this.documentService.findOne(id, documentViewer(request.user));
  }

  @Permissions(PermissionCode.DOCUMENT_EDIT)
  @Patch(':id')
  update(
    @Req() request: Request & { user: UserProfile },
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    return this.documentService.update(
      id,
      updateDocumentDto,
      documentViewer(request.user),
    );
  }

  @Permissions(PermissionCode.DOCUMENT_DELETE)
  @Delete()
  remove(
    @Req() request: Request & { user: UserProfile },
    @Body() deleteDocumentDto: DeleteDocumentDto,
  ) {
    return this.documentService.remove(
      deleteDocumentDto,
      documentViewer(request.user),
    );
  }
}
