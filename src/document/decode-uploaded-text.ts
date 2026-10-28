/**
 * Multer 默认把 multipart 文件名按 latin1 解码。
 * 浏览器实际传的是 UTF-8，中文会变成 æ°´ 这类乱码。
 * 字符都在单字节范围内、且能按 UTF-8 还原时才转回。
 */
export function decodeUploadedText(value: string) {
  if (!value || [...value].some((char) => char.charCodeAt(0) > 0xff)) {
    return value;
  }
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  if (
    decoded.includes('\uFFFD') ||
    Buffer.from(decoded, 'utf8').toString('latin1') !== value
  ) {
    return value;
  }
  return decoded;
}
