/** 与 .env.example 的 UPLOAD_MAX_SIZE_MB 默认值保持一致 */
export const DEFAULT_MAX_SIZE_MB = 50;

/** 默认扩展名白名单，与 .env.example 的 UPLOAD_ALLOWED_EXT 默认值保持一致 */
export const DEFAULT_ALLOWED_EXT =
  'pdf,doc,docx,ppt,pptx,xls,xlsx,txt,md,zip,png,jpg,jpeg';

/** FileInterceptor 的硬上限（MB），防止超大文件进内存；service 会按配置再检查一次 */
export const INTERCEPTOR_MAX_SIZE_MB = 50;
