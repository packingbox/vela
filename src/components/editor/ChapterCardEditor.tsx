import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save, BookOpen, RefreshCw, Plus, Trash2,
  Sparkles, PenLine, Bot, Layers
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLayoutStore } from '../../stores/layout-store'
import { ipc } from '../../services/ipc-client'
import {
  loadDirectoryBlueprints,
  saveChapterBlueprint,
  saveAllBlueprints,
  createDirectoryWorkflow,
  type ChapterBlueprint,
  type DirectoryWorkflowParams,
} from '../../services/workflows/directory-workflow'
import { guardDirectoryGeneration } from '../../services/workflow-guards'
import DirectoryConfigDialog from '../dialogs/DirectoryConfigDialog'
import BatchWriteConfigDialog from '../dialogs/BatchWriteConfigDialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { globalEventBus } from '../../shared/event-bus'

const ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾']

const ROLE_COLORS: Record<string, string> = {
  高潮: 'bg-red-500/20 text-red-400',
  冲突: 'bg-orange-500/20 text-orange-400',
  转折: 'bg-purple-500/20 text-purple-400',
  建置: 'bg-blue-500/20 text-blue-400',
  收尾: 'bg-green-500/20 text-green-400',
}

/** 章节蓝图编辑器 — 读写 directory.json */
export default function ChapterCardEditor() {
  const currentProject = useProjectStore(s => s.currentProject)
  // ✅ action 用 getState() 获取，不订阅 workflow store 高频更新
  const startWorkflow = useWorkflowStore.getState().startWorkflow
  const addLog = useWorkflowStore.getState().addLog
  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  // 下一个可写的章节号
  const [nextWriteChapter, setNextWriteChapter] = useState<number | null>(null)

  // 蓝图生成弹窗（替代原 inline 批量面板）
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false)
  
  // 批量写作配置弹窗
  const [showBatchWriteDialog, setShowBatchWriteDialog] = useState(false)

  // 使用 ref 保存当前选中的章节号，避免依赖循环
  const selectedChapterRef = useRef<number | null>(null)
  
  const loadBlueprints = useCallback(async (keepSelection = true) => {
    if (!currentProject) return
    setLoading(true)
    try {
      const data = await loadDirectoryBlueprints()
      setBlueprints(data)
      // 恢复选中状态：尝试找到之前选中的章节，否则选中第一个
      if (data.length > 0) {
        if (keepSelection && selectedChapterRef.current) {
          const newIdx = data.findIndex(bp => bp.chapterNumber === selectedChapterRef.current)
          if (newIdx >= 0) {
            setSelectedIdx(newIdx)
          } else {
            // 如果之前的章节不存在了，选中第一个
            setSelectedIdx(0)
            selectedChapterRef.current = data[0]?.chapterNumber ?? null
          }
        } else {
          setSelectedIdx(0)
          selectedChapterRef.current = data[0]?.chapterNumber ?? null
        }
      }
      // 获取下一个待写章节号
      const maxFinalized = await ipc.invoke('db:draft-get-max-finalized-chapter')
      setNextWriteChapter(maxFinalized !== null ? maxFinalized + 1 : 1)
    } catch {
      addLog('error', '读取章节蓝图失败')
    }
    setLoading(false)
    setDirty(false)
  }, [currentProject, addLog])

  // 当选中索引变化时，更新 ref
  useEffect(() => {
    if (blueprints.length > 0 && selectedIdx < blueprints.length) {
      selectedChapterRef.current = blueprints[selectedIdx].chapterNumber
    }
  }, [selectedIdx, blueprints])

  useEffect(() => {
    let mounted = true
    Promise.resolve().then(() => { if (mounted) loadBlueprints() })
    return () => { mounted = false }
  }, [loadBlueprints])

  // 监听工作流完成事件，刷新蓝图和下一章状态
  useEffect(() => {
    const handleWorkflowComplete = () => {
      loadBlueprints()
    }
    const handleFinalizeComplete = () => {
      loadBlueprints()
    }
    const off1 = globalEventBus.on('WORKFLOW_COMPLETE', handleWorkflowComplete)
    const off2 = globalEventBus.on('FINALIZE_COMPLETE', handleFinalizeComplete)
    return () => {
      off1()
      off2()
    }
  }, [loadBlueprints])

  const selected = blueprints[selectedIdx] ?? null

  /** 更新选中章节蓝图的字段 */
  const updateField = <K extends keyof ChapterBlueprint>(key: K, value: ChapterBlueprint[K]) => {
    setBlueprints(prev =>
      prev.map((b, i) => (i === selectedIdx ? { ...b, [key]: value } : b))
    )
    setDirty(true)
  }

  /** 保存当前章节蓝图 */
  const handleSaveOne = async () => {
    if (!currentProject || !selected) return
    setSaving(true)
    await saveChapterBlueprint(selected)
    setSaving(false)
    setDirty(false)
    addLog('info', `✅ 第 ${selected.chapterNumber} 章蓝图已保存`)
  }

  /** 全量保存（每章写入独立 JSON 文件） */
  const handleSaveAll = async () => {
    if (!currentProject) return
    setSaving(true)
    await saveAllBlueprints(blueprints)
    setSaving(false)
    setDirty(false)
    addLog('info', `✅ 已保存全部 ${blueprints.length} 章蓝图`)
  }

  /** 新建空章节 */
  const handleAddChapter = () => {
    const maxNum = blueprints.reduce((m, b) => Math.max(m, b.chapterNumber), 0)
    const newBlueprint: ChapterBlueprint = {
      chapterNumber: maxNum + 1,
      title: '',
      role: '发展',
      purpose: '',
      keyEvents: '',
      characters: [],
      suspenseHook: '',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
    }
    setBlueprints(prev => [...prev, newBlueprint])
    setSelectedIdx(blueprints.length)
    setDirty(true)
  }

  /** 删除选中章节 */
  const handleDeleteChapter = async () => {
    if (!selected) return
    const ok = await confirm(`确认删除第 ${selected.chapterNumber} 章蓝图？\n此操作不可撤销。`, {
      title: '删除章节蓝图',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    const newList = blueprints.filter((_, i) => i !== selectedIdx)
    setBlueprints(newList)
    setSelectedIdx(Math.max(0, selectedIdx - 1))
    setDirty(true)
  }

  /** 触发蓝图批量生成（来自 DirectoryConfigDialog 的确认回调） */
  const handleBatchGenerate = async (params: DirectoryWorkflowParams) => {
    if (!currentProject) return

    // 前置校验：故事架构是否就绪
    const guard = await guardDirectoryGeneration()
    if (!guard.ok) {
      // 校验失败：阻断并提示
      addLog('error', `⚠️ 前置条件未满足：${guard.message}`)
      toast.warning(`无法出发\n\n${guard.message}`)
      return
    }
    if (guard.message) {
      // 有警告但允许继续：弹出确认
      const yes = await confirm(`${guard.message}\n\n是否仍要继续生成？`, {
        title: '前置条件警告',
        confirmText: '继续生成',
      })
      if (!yes) return
    }

    startWorkflow(createDirectoryWorkflow(params))
    addLog('info', '🚀 已启动章节蓝图生成')
  }

  /**
   * 写作此章 — 将当前蓝图信息注入创作弹窗
   * 支持指定章节（默认为当前选中章）
   */
  const handleWriteChapter = (bp: ChapterBlueprint) => {
    // 通过 layout-store openChapterCreation 传递预填参数，替代 window.dispatchEvent
    useLayoutStore.getState().openChapterCreation({
      chapterNumber: bp.chapterNumber,
      title: bp.title,
      role: bp.role,
      purpose: bp.purpose,
      keyEvents: bp.keyEvents,
      characters: bp.characters.join('、'),
      userGuidance: bp.userGuidance || '',
    })
  }

  /**
   * 预览草稿 — 生成临时预览草稿，不保存到数据库
   * 用于快速判断和参考，关闭应用后自动清除
   */
  const handlePreviewDraft = async (bp: ChapterBlueprint) => {
    if (!currentProject) return

    const guard = await guardDirectoryGeneration()
    if (!guard.ok) {
      addLog('error', `⚠️ 前置条件未满足：${guard.message}`)
      toast.warning(`无法预览\n\n${guard.message}`)
      return
    }
    if (guard.message) {
      const yes = await confirm(`${guard.message}\n\n是否仍要继续预览？`, {
        title: '前置条件警告',
        confirmText: '继续预览',
      })
      if (!yes) return
    }

    const { createPreviewDraftWorkflow } = await import('../../services/workflows/chapter-workflow')

    const chapterInfo = {
      chapterNumber: bp.chapterNumber,
      title: bp.title,
      role: bp.role,
      purpose: bp.purpose,
      characters: bp.characters,
      keyEvents: bp.keyEvents,
      suspenseHook: bp.suspenseHook,
      userGuidance: bp.userGuidance,
    }

    startWorkflow(createPreviewDraftWorkflow(chapterInfo))
    addLog('info', `🔍 已启动第${bp.chapterNumber}章预览`)
  }

  /**
   * 自动编写此章 — 一键完成写稿→审稿→修稿→定稿全流程
   */
  const handleAutoWriteChapter = async (bp: ChapterBlueprint) => {
    if (!currentProject) return

    // 前置校验：故事架构是否就绪
    const guard = await guardDirectoryGeneration()
    if (!guard.ok) {
      addLog('error', `⚠️ 前置条件未满足：${guard.message}`)
      toast.warning(`无法出发\n\n${guard.message}`)
      return
    }
    if (guard.message) {
      const yes = await confirm(`${guard.message}\n\n是否仍要继续自动编写？`, {
        title: '前置条件警告',
        confirmText: '继续编写',
      })
      if (!yes) return
    }

    const { createAutoWriteWorkflow } = await import('../../services/workflows/chapter-workflow')
    
    const chapterInfo = {
      chapterNumber: bp.chapterNumber,
      title: bp.title,
      role: bp.role,
      purpose: bp.purpose,
      characters: bp.characters,
      keyEvents: bp.keyEvents,
      suspenseHook: bp.suspenseHook,
      userGuidance: bp.userGuidance,
    }

    startWorkflow(createAutoWriteWorkflow(chapterInfo))
    addLog('info', `🚀 已启动第${bp.chapterNumber}章自动编写流程`)
  }

  /**
   * 批量自动编写指定范围的章节 — 对每章依次执行写稿→审稿→修稿→定稿
   */
  const handleBatchAutoWrite = async (startChapter?: number, endChapter?: number, authorGuidance?: string) => {
    if (!currentProject) return

    // 前置校验：故事架构是否就绪
    const guard = await guardDirectoryGeneration()
    if (!guard.ok) {
      addLog('error', `⚠️ 前置条件未满足：${guard.message}`)
      toast.warning(`无法出发\n\n${guard.message}`)
      return
    }
    if (guard.message) {
      const yes = await confirm(`${guard.message}\n\n是否仍要继续批量编写？`, {
        title: '前置条件警告',
        confirmText: '继续编写',
      })
      if (!yes) return
    }

    const { createAutoWriteWorkflow } = await import('../../services/workflows/chapter-workflow')
    
    // 确定编写范围
    const start = startChapter ?? (nextWriteChapter ?? 1)
    const end = endChapter ?? (currentProject?.novelConfig.totalChapters ?? 100)
    
    // 过滤出指定范围内的章节，并按章节号排序
    const pendingBlueprints = blueprints
      .filter(bp => bp.chapterNumber >= start && bp.chapterNumber <= end)
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
    
    const totalChaptersToWrite = pendingBlueprints.length
    let completedCount = 0
    
    addLog('info', `🚀 开始批量自动编写，共${totalChaptersToWrite}章（第${start}-${end}章）`)

    // 遍历章节，依次执行自动编写
    for (const bp of pendingBlueprints) {
      try {
        addLog('info', `📝 正在编写第${bp.chapterNumber}章 · ${bp.title || '未命名'}`)
        
        // 组合作者微操指导：章节自身的指导优先，其次使用批量设置的指导
        const combinedGuidance = bp.userGuidance || authorGuidance
        
        const chapterInfo = {
          chapterNumber: bp.chapterNumber,
          title: bp.title,
          role: bp.role,
          purpose: bp.purpose,
          characters: bp.characters,
          keyEvents: bp.keyEvents,
          suspenseHook: bp.suspenseHook,
          userGuidance: combinedGuidance,
        }

        // 创建工作流
        const workflow = createAutoWriteWorkflow(chapterInfo)
        
        // ⚠️ 重要：先注册事件监听器，再启动工作流，避免竞态条件
        const completionPromise = new Promise<void>((resolve) => {
          const off = globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
            if (payload.type === 'auto_write') {
              off()
              resolve()
            }
          })
        })
        
        // 启动工作流
        startWorkflow(workflow)
        
        // 等待工作流完成
        await completionPromise

        completedCount++
        addLog('info', `✅ 第${bp.chapterNumber}章编写完成 (${completedCount}/${totalChaptersToWrite})`)
        
        // 关闭当前章节的所有tab（初稿/审查/合并/定稿等）
        const { useEditorStore } = await import('../../stores/editor-store')
        const tabs = useEditorStore.getState().tabs
        const chapterTabs = tabs.filter(t => t.chapterNumber === bp.chapterNumber)
        if (chapterTabs.length > 0) {
          chapterTabs.forEach(t => useEditorStore.getState().closeTab(t.id))
          addLog('info', `🔒 已关闭第${bp.chapterNumber}章相关页面 (${chapterTabs.length}个)`)
        }
        
        // 刷新蓝图状态，更新 nextWriteChapter
        await loadBlueprints()
        
      } catch (error) {
        addLog('error', `❌ 第${bp.chapterNumber}章编写失败: ${error}`)
        // 继续下一章
      }
    }

    addLog('info', `🎉 批量自动编写完成！共完成${completedCount}/${totalChaptersToWrite}章`)
    toast.success(`批量编写完成！\n共完成 ${completedCount}/${totalChaptersToWrite} 章`)
  }
  
  /**
   * 批量写作配置确认回调
   */
  const handleBatchWriteConfirm = (startChapter: number, endChapter: number, authorGuidance: string) => {
    handleBatchAutoWrite(startChapter, endChapter, authorGuidance)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
        <RefreshCw size={16} className="animate-spin" /> 加载章节蓝图...
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <BookOpen size={36} />
        <span className="text-sm">请先打开项目</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-10 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
      >
        <div className="flex items-center gap-1.5">
          <BookOpen size={13} style={{ color: 'var(--color-text-muted)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            章节蓝图
            {blueprints.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }} className="ml-1 font-normal">
                ({blueprints.length} 章)
              </span>
            )}
          </span>
          {dirty && <span className="text-[0.7rem]" style={{ color: 'var(--color-accent)' }}>● 未保存</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* 写作入口 — 仅下一章可写时显示 */}
          {nextWriteChapter !== null && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBatchWriteDialog(true)}
                title="批量自动编写章节：对每章依次执行写稿→审稿→修稿→定稿"
              >
                <Layers size={12} />
                批量写作
              </Button>
              <Button
                variant="ai"
                size="sm"
                onClick={() => {
                  const bp = blueprints.find(b => b.chapterNumber === nextWriteChapter)
                  if (bp) handleWriteChapter(bp)
                }}
              >
                <PenLine size={12} />
                写作第{nextWriteChapter}章
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const bp = blueprints.find(b => b.chapterNumber === nextWriteChapter)
                  if (bp) handleAutoWriteChapter(bp)
                }}
                title="AI自动写完本章：写稿→审稿→修稿→定稿"
              >
                <Bot size={12} />
                自动编写
              </Button>
            </>
          )}
          {/* AI 生成蓝图 → 弹出 DirectoryConfigDialog */}
          <Button
            variant="ai"
            size="sm"
            onClick={() => setShowBlueprintDialog(true)}
            title="AI 生成章节蓝图（选择范围和模式）"
          >
            <Sparkles size={12} />
            AI 生成蓝图
          </Button>
          <Button variant="ghost" size="icon" onClick={() => loadBlueprints()} title="重新加载" disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleAddChapter} title="新建章节">
            <Plus size={14} />
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" onClick={handleSaveAll} disabled={saving}>
              <Save size={12} /> {saving ? '保存中...' : '保存全部'}
            </Button>
          )}
        </div>
      </div>

      {/* 蓝图生成配置弹窗 */}
      <DirectoryConfigDialog
        isOpen={showBlueprintDialog}
        onClose={() => setShowBlueprintDialog(false)}
        existingCount={blueprints.length}
        onConfirm={handleBatchGenerate}
      />

      {/* 批量写作配置弹窗 */}
      <BatchWriteConfigDialog
        isOpen={showBatchWriteDialog}
        onClose={() => setShowBatchWriteDialog(false)}
        nextWriteChapter={nextWriteChapter}
        totalChapters={currentProject?.novelConfig.totalChapters ?? 100}
        onConfirm={handleBatchWriteConfirm}
      />

      {/* 主区域：左侧列表 + 右侧编辑 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧章节列表 */}
        <div
          className="flex flex-col flex-shrink-0 w-[200px] border-r overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
        >
          {blueprints.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 opacity-40 p-4">
              <BookOpen size={28} />
              <span className="text-xs text-center">暂无蓝图，点击「AI 生成」开始</span>
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto p-1">
            {blueprints.map((bp, idx) => (
              <div
                key={bp.chapterNumber}
                className={cn(
                  'group relative px-2.5 py-2 rounded-md text-xs cursor-pointer mb-0.5 transition-colors',
                  selectedIdx === idx
                    ? 'bg-[var(--color-active)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                )}
                onClick={() => setSelectedIdx(idx)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.7rem] opacity-40 flex-shrink-0">
                    {bp.chapterNumber}
                  </span>
                  <span className="font-medium truncate flex-1">{bp.title || '未命名'}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={cn(
                    'text-[0.7rem] px-1 py-0.5 rounded',
                    ROLE_COLORS[bp.role] || 'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                  )}>
                    {bp.role}
                  </span>
                  {bp.userGuidance && (
                    <span
                      className="text-[0.7rem] px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--color-accent)' }}
                      title="已有作者微操指导"
                    >
                      有指导
                    </span>
                  )}
                  {bp.notes && (
                    <span
                      className="text-[0.7rem] px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: 'rgb(34,197,94)' }}
                      title="已生成章节要点"
                    >
                      有要点
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="max-w-2xl mx-auto px-5 py-4">
              {/* 编辑区头部 */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  第 {selected.chapterNumber} 章：{selected.title || '未命名'}
                </h3>
                <div className="flex items-center gap-1.5">
                  {/* 预览草稿按钮 — 所有章节都可以预览 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePreviewDraft(selected)}
                    title="生成临时预览草稿（不保存，关闭应用后自动清除）"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    <Bot size={12} /> 预览
                  </Button>
                  {/* 仅下一章允许写作 */}
                  {nextWriteChapter !== null && selected.chapterNumber === nextWriteChapter && (
                    <Button
                      variant="ai"
                      size="sm"
                      onClick={() => handleWriteChapter(selected)}
                      title="以当前蓝图信息生成草稿"
                    >
                      <PenLine size={12} /> 写作此章
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={handleDeleteChapter} title="删除此章">
                    <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveOne} disabled={saving}>
                    <Save size={12} /> {saving ? '保存中...' : '保存'}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {/* 基本信息 */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>章节号</Label>
                    <Input
                      type="number"
                      value={selected.chapterNumber}
                      onChange={e => updateField('chapterNumber', (e.target.value === '' ? '' : parseInt(e.target.value)) as number)}
                      onBlur={() => {
                        const v = Number(selected.chapterNumber);
                        if (!v || v < 1) updateField('chapterNumber', 1)
                      }}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label>章节标题</Label>
                    <Input
                      value={selected.title}
                      onChange={e => updateField('title', e.target.value)}
                      placeholder="引人入胜的章节标题"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>章节定位</Label>
                    <NativeSelect value={selected.role} onChange={e => updateField('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label>出场关键人（逗号分隔）</Label>
                    <Input
                      value={selected.characters.join('、')}
                      onChange={e => updateField('characters', e.target.value.split(/[,，、\s]+/).filter(Boolean))}
                      placeholder="如：主角、反派A"
                    />
                  </div>
                </div>

                <div>
                  <Label>主角小目标（本章最想解决的事）</Label>
                  <Textarea
                    value={selected.purpose}
                    onChange={e => updateField('purpose', e.target.value)}
                    placeholder="本章主角最迫切要解决的一件事..."
                    rows={2}
                  />
                </div>

                <div>
                  <Label>实质冲突与转折</Label>
                  <Textarea
                    value={selected.keyEvents}
                    onChange={e => updateField('keyEvents', e.target.value)}
                    placeholder="主角做了什么，遭遇了什么反转，金手指怎么用的..."
                    rows={4}
                  />
                </div>

                <div>
                  <Label>末尾悬念钩子</Label>
                  <Textarea
                    value={selected.suspenseHook}
                    onChange={e => updateField('suspenseHook', e.target.value)}
                    placeholder="一句话说明结尾留了什么悬念..."
                    rows={2}
                  />
                </div>

                {/* 作者微操指导 — 特别标注，写稿时注入为最高优先级 */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-accent)',
                    backgroundColor: 'rgba(var(--accent-rgb, 99 102 241), 0.06)',
                  }}
                >
                  <Label className="flex items-center gap-1.5">
                    <span>作者微操指导</span>
                    <span
                      className="text-[0.7rem] font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      （写稿时会作为最高优先级注入 AI — 可覆盖蓝图）
                    </span>
                  </Label>
                  <Textarea
                    value={selected.userGuidance}
                    onChange={e => updateField('userGuidance', e.target.value)}
                    placeholder="我想在这章加入一个意外的背叛...&#10;让反派在这章露出破绽...&#10;（不填则完全按蓝图走）"
                    rows={3}
                    style={{ marginTop: 6 }}
                  />
                </div>
                {/* 章节要点（定稿后自动生成，也可手动编辑） */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'rgba(34,197,94,0.04)',
                  }}
                >
                  <Label className="flex items-center gap-1.5">
                    <span>章节要点</span>
                    <span
                      className="text-[0.7rem] font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {selected.notesUpdatedAt
                        ? `（定稿后自动生成 — ${new Date(selected.notesUpdatedAt).toLocaleDateString('zh-CN')}）`
                        : '（定稿后自动生成，也可手动填写）'
                      }
                    </span>
                  </Label>
                  <Textarea
                    value={selected.notes || ''}
                    onChange={e => updateField('notes', e.target.value)}
                    placeholder="定稿后 AI 会自动填充本章要点（事件进展/角色变化/伏笔埋点）…＊也可以提前手动输入给 AI 作参考"
                    rows={4}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
              <BookOpen size={36} />
              <span className="text-sm">在左侧选择一章开始编辑</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
