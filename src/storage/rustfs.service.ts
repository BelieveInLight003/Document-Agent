/**
 * RustFS 客户端。
 *
 * 用 AWS Signature V4 直接请求 S3 兼容接口，不额外依赖 AWS SDK。
 * 上传路径形如 `sources/年/月/{uuid}-{文件名}`，避免重名覆盖。
 * 第一次上传时会检查桶 `RUSTFS_BUCKET`（默认 `knowledge-hub`），不存在就创建。
 *
 * 配置项：
 * - `RUSTFS_ENABLED`：设为 `false` 时拒绝上传
 * - `RUSTFS_ENDPOINT`：S3 API，本地默认 `http://127.0.0.1:9000`
 * - `RUSTFS_PUBLIC_URL`：返回给调用方的访问地址前缀，默认同 endpoint
 * - `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`：访问密钥
 * - `RUSTFS_BUCKET` / `RUSTFS_REGION`：桶名与签名用的区域
 *
 * 浏览器打开 9000 根路径会看到 `AccessDenied`，那是未签名的 S3 响应，不是服务挂了。
 * 管理页面使用 `http://localhost:9001`。
 */
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

export type SourceFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

export type UploadedSourceFile = {
  bucket: string;
  key: string;
  url: string;
  size: number;
  filename: string;
  contentType: string;
};

@Injectable()
export class RustfsService {
  private readonly endpoint: string;
  private readonly publicBaseUrl: string;
  private readonly bucket: string;
  private readonly region: string;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly enabled: boolean;
  private bucketReady = false;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('RUSTFS_ENABLED', 'true') !== 'false';
    this.endpoint = this.config
      .get<string>('RUSTFS_ENDPOINT', 'http://127.0.0.1:9000')
      .replace(/\/$/, '');
    this.publicBaseUrl = this.config
      .get<string>('RUSTFS_PUBLIC_URL', this.endpoint)
      .replace(/\/$/, '');
    this.bucket = this.config.get<string>('RUSTFS_BUCKET', 'knowledge-hub');
    this.region = this.config.get<string>('RUSTFS_REGION', 'us-east-1');
    this.accessKey = this.config.get<string>('RUSTFS_ACCESS_KEY', 'rustfsadmin');
    this.secretKey = this.config.get<string>('RUSTFS_SECRET_KEY', 'rustfsadmin');
  }

  /** 把文档源文件写入 RustFS，并返回对象键与访问地址。 */
  async uploadSourceFile(file: SourceFile): Promise<UploadedSourceFile> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('RustFS 未启用');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('请上传文档源文件');
    }

    await this.ensureBucket();

    const filename = this.safeFilename(file.originalname);
    const key = this.buildKey(filename);
    const contentType = file.mimetype || 'application/octet-stream';

    const response = await this.request('PUT', key, file.buffer, contentType);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `源文件上传到 RustFS 失败：${response.status} ${await this.errorText(response)}`,
      );
    }

    return {
      bucket: this.bucket,
      key,
      url: this.publicUrl(key),
      size: file.size || file.buffer.length,
      filename,
      contentType,
    };
  }

  /** 确认桶存在。404 时创建；409 表示桶已经存在。 */
  private async ensureBucket() {
    if (this.bucketReady) {
      return;
    }

    const head = await this.request('HEAD', undefined, Buffer.alloc(0));
    if (head.status === 404) {
      const created = await this.request('PUT', undefined, Buffer.alloc(0));
      if (!created.ok && created.status !== 409) {
        throw new ServiceUnavailableException(
          `创建 RustFS 存储桶失败：${created.status} ${await this.errorText(created)}`,
        );
      }
    } else if (!head.ok && head.status !== 403) {
      throw new ServiceUnavailableException(
        `连接 RustFS 失败：${head.status} ${await this.errorText(head)}`,
      );
    }

    this.bucketReady = true;
  }

  /** 按 S3 路径风格发送已签名请求。不传 key 时操作桶本身。 */
  private async request(
    method: string,
    key: string | undefined,
    body: Buffer,
    contentType?: string,
  ) {
    const url = new URL(this.endpoint);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalUri = this.canonicalUri(key);
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (method !== 'HEAD') {
      headers['content-length'] = String(body.length);
    }
    if (contentType) {
      headers['content-type'] = contentType;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join('\n');
    const signature = createHmac('sha256', this.signingKey(dateStamp))
      .update(stringToSign)
      .digest('hex');

    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(`${this.endpoint}${canonicalUri}`, {
      method,
      headers,
      body: method === 'HEAD' || body.length === 0 ? undefined : new Uint8Array(body),
    });
  }

  private signingKey(dateStamp: string) {
    const dateKey = hmac(`AWS4${this.secretKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
  }

  private canonicalUri(key?: string) {
    const bucket = encodeRfc3986(this.bucket);
    if (!key) {
      return `/${bucket}`;
    }
    return `/${bucket}/${key.split('/').map(encodeRfc3986).join('/')}`;
  }

  private buildKey(filename: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `sources/${year}/${month}/${randomUUID()}-${filename}`;
  }

  private safeFilename(originalname: string) {
    const base = path.basename(originalname || 'file');
    const cleaned = base.replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_');
    return cleaned || 'file';
  }

  private publicUrl(key: string) {
    return `${this.publicBaseUrl}${this.canonicalUri(key)}`;
  }

  private async errorText(response: Response) {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text.slice(0, 180);
  }
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest();
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
