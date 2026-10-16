import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocumentContentFormat = 'markdown' | 'html' | 'text';

export type DocumentContentDocument = HydratedDocument<DocumentContent>;

/** 文档内容。contentId 为雪花 ID，对应同一篇文档 */
@Schema({
  collection: 'document_content',
  timestamps: true,
})
export class DocumentContent {
  @Prop({ type: String, required: true, unique: true })
  contentId: string;

  @Prop({ type: String, required: true, default: '' })
  content: string;

  @Prop({ type: Number, required: true, default: 0 })
  length: number;

  @Prop({ type: String, required: false, default: '' })
  contentSummary: string;

  @Prop({ type: Boolean, required: true, default: false, index: true })
  deleted: boolean;
}

export const DocumentContentSchema =
  SchemaFactory.createForClass(DocumentContent);
