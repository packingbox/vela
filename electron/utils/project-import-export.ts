import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import unzipper from 'unzipper'

const require = createRequire(import.meta.url)
const Archiver = require('archiver').Archiver

export interface ExportOptions {
  projectPath: string
  targetPath: string
}

export interface ImportOptions {
  zipPath: string
  targetDir: string
}

export async function exportProject(options: ExportOptions): Promise<{ success: boolean; exportPath?: string; error?: string }> {
  try {
    const { projectPath, targetPath } = options
    const projectName = path.basename(projectPath)
    const now = new Date()
    const timeStr = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0')
    const randomStr = Math.floor(1000 + Math.random() * 9000).toString()
    const exportFileName = `${projectName}_${timeStr}_${randomStr}.zip`
    const exportPath = path.join(targetPath, exportFileName)

    if (!fs.existsSync(projectPath)) {
      return { success: false, error: '项目目录不存在' }
    }

    const velaDir = path.join(projectPath, '.vela')
    if (!fs.existsSync(velaDir)) {
      return { success: false, error: '项目数据目录(.vela)不存在，无法导出' }
    }

    const readDirRecursive = (dir: string, baseDir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...readDirRecursive(fullPath, baseDir))
        } else if (!entry.name.endsWith('.zip')) {
          files.push(fullPath)
        }
      }
      return files
    }

    const allFiles = readDirRecursive(projectPath, projectPath)

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(exportPath)
      const archive = new Archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => resolve())
      archive.on('error', (err: Error) => reject(err))

      archive.pipe(output)

      for (const filePath of allFiles) {
        const relativePath = path.relative(projectPath, filePath)
        archive.file(filePath, { name: path.join(projectName, relativePath) })
      }

      archive.finalize().catch(reject)
    })

    return { success: true, exportPath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function importProject(options: ImportOptions, confirmType: 'none' | 'overwrite' | 'clear' = 'none'): Promise<{ success: boolean; projectPath?: string; error?: string; needOverwrite?: boolean; needClear?: boolean; existingPath?: string }> {
  try {
    const { zipPath, targetDir } = options

    if (!fs.existsSync(zipPath)) {
      return { success: false, error: '导入文件不存在' }
    }

    const tempDir = path.join(os.tmpdir(), `vela_import_${Date.now()}`)

    fs.mkdirSync(tempDir, { recursive: true })

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: tempDir }))
        .on('close', () => resolve())
        .on('error', (err: Error) => reject(err))
    })

    const entries = fs.readdirSync(tempDir)
    if (entries.length === 0) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: '压缩包内容为空' }
    }

    const firstEntry = entries[0]
    const extractedProjectPath = path.join(tempDir, firstEntry)

    const stat = fs.statSync(extractedProjectPath)
    if (!stat.isDirectory()) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      return { success: false, error: '压缩包结构无效，期望第一个条目为项目文件夹' }
    }

    const projectName = firstEntry
    const targetVelaDir = path.join(targetDir, '.vela')
    let destProjectPath: string
    
    // 检查目标目录是否已经是一个 Vela 项目目录
    if (fs.existsSync(targetVelaDir)) {
      destProjectPath = targetDir
      const targetDirName = path.basename(targetDir)
      
      if (confirmType === 'none') {
        fs.rmSync(tempDir, { recursive: true, force: true })
        if (targetDirName === projectName) {
          return { success: false, needOverwrite: true, existingPath: destProjectPath }
        } else {
          return { success: false, needClear: true, existingPath: destProjectPath }
        }
      }
      
      // 清空目标目录内容
      const targetEntries = fs.readdirSync(destProjectPath)
      for (const entry of targetEntries) {
        fs.rmSync(path.join(destProjectPath, entry), { recursive: true, force: true })
      }
      // 直接把解压内容移动到目标目录
      const extractedEntries = fs.readdirSync(extractedProjectPath)
      for (const entry of extractedEntries) {
        fs.renameSync(path.join(extractedProjectPath, entry), path.join(destProjectPath, entry))
      }
    } else {
      // 正常情况：在目标目录下创建项目子目录
      destProjectPath = path.join(targetDir, projectName)
      const destVelaDir = path.join(destProjectPath, '.vela')

      if (fs.existsSync(destVelaDir)) {
        if (confirmType !== 'overwrite') {
          fs.rmSync(tempDir, { recursive: true, force: true })
          return { success: false, needOverwrite: true, existingPath: destProjectPath }
        }
        fs.rmSync(destProjectPath, { recursive: true, force: true })
      } else if (fs.existsSync(destProjectPath)) {
        fs.rmSync(destProjectPath, { recursive: true, force: true })
      }

      try {
        fs.renameSync(extractedProjectPath, destProjectPath)
      } catch (renameError) {
        fs.rmSync(tempDir, { recursive: true, force: true })
        return { success: false, error: `文件移动失败: ${String(renameError)}` }
      }
    }
    
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // 忽略清理失败
    }

    return { success: true, projectPath: destProjectPath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function checkProjectExists(projectName: string, targetDir: string): { exists: boolean; existingPath?: string } {
  const projectPath = path.join(targetDir, projectName)
  const velaDbPath = path.join(projectPath, '.vela', 'vela.db')

  if (fs.existsSync(velaDbPath)) {
    return { exists: true, existingPath: projectPath }
  }

  return { exists: false }
}
