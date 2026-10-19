/** 文本文件本身就是正文，去掉 BOM 后作为 Markdown 返回。 */
export function parseTxt(buffer: Buffer) {
  return buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
}
