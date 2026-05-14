import { ipcMain } from 'electron'

/**
 * 注册预览相关 IPC 通道
 */
export function registerPreviewController() {
  ipcMain.handle('preview:cleanup', async () => {
    console.log('[Vela] 清理预览文件...')
    return true
  })
}
