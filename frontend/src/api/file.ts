/**
 * 统一文件上传。所有附件（文献、成果等）都走这个接口，
 * 后端返回文件标识供业务表引用。见 docs/01-接口规范.md。
 */
import { http } from './request'
import type { FileItem } from './types'

export function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return http.post<FileItem>('/api/v1/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000
  })
}
