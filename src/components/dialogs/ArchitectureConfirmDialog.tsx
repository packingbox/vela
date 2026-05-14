import { useState, useEffect } from 'react'
import { Wand2, AlertCircle, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { guardArchitectureGeneration } from '../../services/workflow-guards'
import { ipc } from '../../services/ipc-client'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'

type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

const ARCH_FILES: Array<{
  key: ArchStepKey
  fileName: string
  label: string
  iconName: string
  desc: string
}> = [
  { key: 'premise',       fileName: 'premise.md',       label: '故事前提', iconName: 'target', desc: 'Logline、核心冲突、金手指定位' },
  { key: 'characters',    fileName: 'characters.md',    label: '角色图谱', iconName: 'users',  desc: '角色弧光、关系网、矛盾交织' },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: '世界观',   iconName: 'globe',  desc: '核心规则、阶层断层、深层危机' },
  { key: 'synopsis',      fileName: 'synopsis.md',      label: '情节大纲', iconName: 'map',    desc: '三幕式情节骨架' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 各架构文件的生成状态 */
  archStatus: Record<string, boolean>
  /** 预先选中的步骤（单文件生成时传入） */
  initialSelectedSteps?: ArchStepKey[]
  onConfirm: (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => void
}

/** 生成架构确认弹框（含步骤勾选） */
export default function ArchitectureConfirmDialog({
  isOpen, onClose, archStatus, initialSelectedSteps, onConfirm,
}: Props) {
  const currentProject = useProjectStore(s => s.currentProject)

  // 默认：未生成的全部勾选；或使用 initialSelectedSteps 覆盖
  const [checked, setChecked] = useState<Record<ArchStepKey, boolean>>(() => {
    if (initialSelectedSteps) {
      return {
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      }
    }
    return {
      premise:      !archStatus.premise,
      characters:   !archStatus.characters,
      worldbuilding: !archStatus.worldbuilding,
      synopsis:     !archStatus.synopsis,
    }
  })

  // 每步的补充指导
  const [stepGuidance, setStepGuidance] = useState<Record<string, string>>({})
  // 是否展开指导输入区
  const [showGuidance, setShowGuidance] = useState(false)

  // 每次弹窗打开时重置选中状态
  const resetChecked = () => {
    if (initialSelectedSteps) {
      setChecked({
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      })
    } else {
      setChecked({
        premise:      !archStatus.premise,
        characters:   !archStatus.characters,
        worldbuilding: !archStatus.worldbuilding,
        synopsis:     !archStatus.synopsis,
      })
    }
  }

  const isArchRunning = useWorkflowStore(s => s.isTypeRunning('architecture_generation'))
  const [isConfirming, setIsConfirming] = useState(false)
  const [guardError, setGuardError] = useState<string | null>(null)
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false)
  const [hasExistingData, setHasExistingData] = useState(false)
  const [pendingSteps, setPendingSteps] = useState<ArchStepKey[] | null>(null)
  const [pendingGuidance, setPendingGuidance] = useState<Record<string, string> | null>(null)

  // 检查是否有现有数据
  const checkExistingData = async () => {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    const characters = await ipc.invoke('db:character-get-all')
    const maxFinalized = await ipc.invoke('db:draft-get-max-finalized-chapter')
    setHasExistingData(blueprints.length > 0 || characters.length > 0 || maxFinalized > 0)
  }

  // 清理现有数据
  const cleanupExistingData = async () => {
    setIsConfirming(true)
    try {
      await ipc.invoke('db:blueprint-delete-all')
      await ipc.invoke('db:character-delete-all')
      await ipc.invoke('db:draft-delete-all')
      await ipc.invoke('db:post-process-delete-all')
      toast.success('已清空现有架构、角色卡和草稿数据')
    } catch (err) {
      toast.error(`清理数据时出错: ${err}`)
    } finally {
      setIsConfirming(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      checkExistingData()
    }
  }, [isOpen])

  if (!currentProject) return null
  const config = currentProject.novelConfig

  const toggleStep = (key: ArchStepKey) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const selectedSteps = (Object.keys(checked) as ArchStepKey[]).filter(k => checked[k])
  const noneSelected = selectedSteps.length === 0

  const handleConfirm = async () => {
    if (noneSelected) return
    // 防重复：同类型工作流正在运行
    if (isArchRunning) {
      toast.warning('已有架构生成任务正在执行，请等待完成后再试')
      return
    }

    setIsConfirming(true)
    try {
      // 前置校验 1：小说配置是否填写
      const configGuard = guardArchitectureGeneration()
      if (!configGuard.ok) {
        setGuardError(configGuard.message || '配置校验失败')
        return
      }

      // 如果有现有数据，显示清理确认
      if (hasExistingData) {
        setPendingSteps(selectedSteps)
        setPendingGuidance(stepGuidance)
        setShowCleanupConfirm(true)
        return
      }

      // 直接生成
      setGuardError(null)
      onConfirm(selectedSteps, stepGuidance)
      onClose()
      const stepNames = selectedSteps.map(k => ARCH_FILES.find(f => f.key === k)?.label).filter(Boolean).join('、')
      toast.info(`✨ 已提交：正在生成${stepNames}...`)
    } finally {
      setIsConfirming(false)
    }
  }

  const handleCleanupAndConfirm = async () => {
    await cleanupExistingData()
    if (pendingSteps && pendingGuidance) {
      setGuardError(null)
      onConfirm(pendingSteps, pendingGuidance)
      onClose()
      const stepNames = pendingSteps.map(k => ARCH_FILES.find(f => f.key === k)?.label).filter(Boolean).join('、')
      toast.info(`✨ 已提交：正在生成${stepNames}...`)
    }
    setShowCleanupConfirm(false)
    setPendingSteps(null)
    setPendingGuidance(null)
  }

  const handleCancelCleanup = () => {
    setShowCleanupConfirm(false)
    setPendingSteps(null)
    setPendingGuidance(null)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
      setShowCleanupConfirm(false)
      setPendingSteps(null)
      setPendingGuidance(null)
    } else {
      resetChecked()
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 size={16} className="text-[var(--color-accent)]" />
              AI 生成故事架构
            </DialogTitle>
            <DialogDescription>
              勾选要生成的步骤，未勾选的步骤将保留已有内容
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 py-3 space-y-4">
            {/* 配置预览 */}
            <div
              className="rounded-lg p-3 space-y-1.5 text-xs"
              style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
            >
              <p className="font-medium text-[0.7rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                当前配置预览
              </p>
              <div className="grid grid-cols-2 gap-1">
                <ConfigRow label="类型" value={[config.genre, config.subGenre].filter(Boolean).join(' · ')} />
                <ConfigRow label="受众" value={config.targetAudience} />
                <ConfigRow label="总章数" value={`${config.totalChapters} 章`} />
                <ConfigRow label="每章字数" value={`${config.wordsPerChapter} 字`} />
              </div>
              {config.coreOutline && (
                <p
                  className="mt-1.5 pt-1.5 text-xs"
                  style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  {config.coreOutline.slice(0, 80)}{config.coreOutline.length > 80 ? '...' : ''}
                </p>
              )}
            </div>

            {/* 步骤勾选列表 */}
            <div
              className="rounded-lg p-3 space-y-2.5"
              style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  勾选要生成的步骤
                </p>
                <button
                  onClick={() => setChecked({ premise: true, characters: true, worldbuilding: true, synopsis: true })}
                  className="text-xs underline"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  全选
                </button>
              </div>

              {ARCH_FILES.map(f => {
                const exists = archStatus[f.key]
                const isChecked = checked[f.key]
                return (
                  <label
                    key={f.key}
                    className="flex items-center gap-2.5 cursor-pointer select-none"
                    onClick={() => toggleStep(f.key)}
                  >
                    {/* 复选框 */}
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        backgroundColor: isChecked ? 'var(--color-accent)' : 'transparent',
                        border: `1.5px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      }}
                    >
                      {isChecked && (
                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                          <path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    {/* 步骤名 */}
                    <span className="text-xs flex-1" style={{ color: isChecked ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                      {f.label}
                      <span className="ml-1 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                        — {f.desc}
                      </span>
                    </span>

                    {/* 状态标签 */}
                    <span
                      className={`text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0 ${
                        exists
                          ? isChecked
                            ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
                            : 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-[rgba(var(--color-accent-rgb),0.1)] text-[var(--color-accent)]'
                      }`}
                    >
                      {exists ? (isChecked ? '将覆盖' : '保留') : '待生成'}
                    </span>
                  </label>
                )
              })}
            </div>

            {/* 逐步指导区域（可折叠） */}
            {selectedSteps.length > 0 && (
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer"
                  style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-panel)' }}
                  onClick={() => setShowGuidance(!showGuidance)}
                >
                  {showGuidance ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  为每个步骤添加补充指导（可选）
                </button>
                {showGuidance && (
                  <div className="px-3 pb-3 space-y-3" style={{ backgroundColor: 'var(--color-panel)' }}>
                    {ARCH_FILES.filter(f => checked[f.key]).map(f => (
                      <div key={f.key}>
                        <label className="text-[0.7rem] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                          {f.label}
                        </label>
                        <Textarea
                          value={stepGuidance[f.key] || ''}
                          onChange={e => setStepGuidance(prev => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={`对「${f.label}」生成的特殊要求，如：“多强调金手指的限制”`}
                          rows={2}
                          className="text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {noneSelected && (
              <p className="text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
                ⚠️ 请至少勾选一个步骤
              </p>
            )}
            {/* 前置校验失败提示 */}
            {guardError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-yellow-500" />
                <span className="whitespace-pre-line">{guardError}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={isConfirming}>取消</Button>
            <Button variant="default" onClick={handleConfirm} disabled={noneSelected || isConfirming}>
              <Wand2 size={13} />
              {isConfirming ? '校验中...' : `确认生成（${selectedSteps.length}/4）`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 清理确认对话框 */}
      <Dialog open={showCleanupConfirm} onOpenChange={setShowCleanupConfirm}>
        <DialogContent className="max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 size={16} className="text-red-500" />
              检测到现有数据
            </DialogTitle>
            <DialogDescription>
              项目中已有蓝图、角色卡或草稿，生成新架构可能会影响现有数据。
            </DialogDescription>
          </DialogHeader>

          <div className="px-2 py-2">
            <div className="rounded-lg p-3 bg-yellow-500/10 border border-yellow-500/30 text-xs">
              <p className="mb-2 text-yellow-600 dark:text-yellow-400">
                ⚠️ 选择以下方式之一继续：
              </p>
              <ul className="list-disc list-inside space-y-1 text-yellow-600 dark:text-yellow-400">
                <li>点击「清空并生成」：将删除所有蓝图、角色卡和草稿，重新开始</li>
                <li>点击「取消」：返回，你可以手动调整后再尝试</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelCleanup} disabled={isConfirming}>取消</Button>
            <Button variant="default" onClick={handleCleanupAndConfirm} disabled={isConfirming} className="bg-red-500 hover:bg-red-600">
              <Trash2 size={12} />
              {isConfirming ? '清理中...' : '清空并生成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}：</span>
      <span style={{ color: 'var(--color-text)' }}>{value || '未填写'}</span>
    </div>
  )
}
