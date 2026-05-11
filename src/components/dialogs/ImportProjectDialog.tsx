import { useState } from 'react'
import { FolderOpen, FileUp, AlertCircle, CheckCircle } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { confirm } from '../ui/Confirm'

interface ImportProjectDialogProps {
  open: boolean
  onClose: () => void
  onSuccess?: (projectPath: string) => void
}

export default function ImportProjectDialog({ open, onClose, onSuccess }: ImportProjectDialogProps) {
  const openProject = useProjectStore((s) => s.openProject)
  const [zipPath, setZipPath] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSelectZip = async () => {
    const result = await ipc.invoke('dialog:select-file', {
      title: '选择项目备份文件',
      filters: [
        { name: 'Vela 项目备份', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result) setZipPath(result)
  }

  const handleSelectTargetDir = async () => {
    const selected = await ipc.invoke('dialog:select-folder')
    if (selected) setTargetDir(selected)
  }

  const handleImport = async (confirmType: 'none' | 'overwrite' | 'clear' = 'none') => {
    if (!zipPath.trim() || !targetDir.trim()) return

    setImporting(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await ipc.invoke('project:import', zipPath, targetDir, confirmType) as {
        success: boolean
        projectPath?: string
        error?: string
        needOverwrite?: boolean
        needClear?: boolean
        existingPath?: string
      }

      if (result.success && result.projectPath) {
        setSuccess(result.projectPath)
        const openChoice = await confirm(`项目导入成功！\n\n是否立即打开「${result.projectPath}」？`, {
          title: '导入成功',
          confirmText: '立即打开',
        })
        if (openChoice) {
          await openProject(result.projectPath)
          onSuccess?.(result.projectPath)
          onClose()
        }
      } else if (result.needOverwrite && result.existingPath) {
        const projectName = result.existingPath.split('/').pop() || result.existingPath.split('\\').pop() || result.existingPath
        const confirmOverwrite = await confirm(`目标目录已存在同名项目「${projectName}」，确定要覆盖它吗？\n\n原项目数据将被完全替换！`, {
          title: '确认覆盖',
          confirmText: '确认覆盖',
          cancelText: '取消',
        })
        if (confirmOverwrite) {
          handleImport('overwrite')
        }
      } else if (result.needClear && result.existingPath) {
        const projectName = result.existingPath.split('/').pop() || result.existingPath.split('\\').pop() || result.existingPath
        const confirmClear = await confirm(`目标目录「${projectName}」本身就是一个项目，确定要清空该目录并导入吗？\n\n目录内所有内容将被完全替换！`, {
          title: '确认清空',
          confirmText: '确认清空',
          cancelText: '取消',
        })
        if (confirmClear) {
          handleImport('clear')
        }
      } else {
        setError(result.error || '导入失败')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    setZipPath('')
    setTargetDir('')
    setError(null)
    setSuccess(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp size={18} className="text-[var(--color-accent)]" />
            导入 Vela 项目
          </DialogTitle>
          <DialogDescription>
            选择之前导出的 .zip 项目备份文件，解压并恢复项目
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div>
            <Label>项目备份文件 (.zip)</Label>
            <div className="flex gap-2">
              <Input
                value={zipPath}
                onChange={(e) => setZipPath(e.target.value)}
                placeholder="选择项目备份 zip 文件"
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectZip}>
                <FolderOpen size={14} />
                选择
              </Button>
            </div>
          </div>

          <div>
            <Label>导入到目录</Label>
            <div className="flex gap-2">
              <Input
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="选择项目存放目录"
                className="flex-1"
              />
              <Button variant="outline" onClick={handleSelectTargetDir}>
                <FolderOpen size={14} />
                选择
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-500">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
              <span className="text-sm text-green-500">导入成功！</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>取消</Button>
          <Button
            onClick={() => handleImport()}
            disabled={importing || !zipPath.trim() || !targetDir.trim()}
          >
            <FileUp size={14} />
            {importing ? '导入中...' : '导入项目'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
