import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DocumentContentFormat = 'markdown' | 'html' | 'text';

export type DocumentContentDocument = HydratedDocument<DocumentContent>;

/** 文档正文。文档身份用 MongoDB 自己的 _id，Postgres kh_document.content_id 存这个值。 */
@Schema({
  collection: 'document_content',
  timestamps: true,
})
export class DocumentContent {
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
