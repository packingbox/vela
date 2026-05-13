import { useState, useEffect, useRef } from 'react'
import { X, RotateCcw, Globe, FolderOpen, AlertTriangle } from 'lucide-react'
import {
  BUILTIN_PROMPTS,
  getPromptTemplate,
  getPromptSource,
  saveCustomPrompt,
  saveProjectCustomPrompt,
  deleteCustomPrompt,
  deleteProjectCustomPrompt,
  loadProjectCustomPrompts,
  type PromptTemplate,
} from '../../services/prompt-templates'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

interface Props {
  templateKey: string
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

const SOURCE_CONFIG = {
  builtin: { label: '内置', color: 'var(--color-text-muted)', bg: 'var(--color-hover)' },
  global: { label: '全局', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  project: { label: '项目', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
} as const

export default function PromptTemplateEditorDialog({ templateKey, isOpen, onClose, onSaved }: Props) {
  const project = useProjectStore((s) => s.currentProject)
  const projectPath = project?.path ?? null

  const builtinTemplate = BUILTIN_PROMPTS.find((p) => p.key === templateKey)
  const currentTemplate = getPromptTemplate(templateKey) ?? builtinTemplate
  const source = getPromptSource(templateKey)

  const [editContent, setEditContent] = useState(currentTemplate?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen && currentTemplate) {
      setEditContent(currentTemplate.content)
      setSaveResult(null)
    }
  }, [isOpen, templateKey])

  if (!isOpen || !builtinTemplate) return null

  const missingVars = Object.keys(builtinTemplate.variables).filter(
    (v) => builtinTemplate.content.includes(`{{${v}}}`) && !editContent.includes(`{{${v}}}`)
  )

  const sourceConf = SOURCE_CONFIG[source]

  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = `{{${varName}}}`
    const newContent = editContent.slice(0, start) + text + editContent.slice(end)
    setEditContent(newContent)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const handleSaveGlobal = async () => {
    setSaving(true)
    setSaveResult(null)
    const template: PromptTemplate = {
      ...builtinTemplate,
      content: editContent,
    }
    delete (template as Partial<PromptTemplate>).systemSuffix
    if (projectPath) {
      await deleteProjectCustomPrompt(projectPath, template.key)
      await loadProjectCustomPrompts(projectPath)
    }
    const ok = await saveCustomPrompt(template)
    setSaving(false)
    if (ok) {
      setSaveResult({ type: 'success', msg: '已保存到全局配置' })
      onSaved?.()
      setTimeout(() => setSaveResult(null), 3000)
    } else {
      setSaveResult({ type: 'error', msg: '保存失败' })
    }
  }

  const handleSaveProject = async () => {
    if (!projectPath) return
    setSaving(true)
    setSaveResult(null)
    const template: PromptTemplate = {
      ...builtinTemplate,
      content: editContent,
    }
    delete (template as Partial<PromptTemplate>).systemSuffix
    const ok = await saveProjectCustomPrompt(projectPath, template)
    setSaving(false)
    setSaveResult(ok ? { type: 'success', msg: '已保存到当前项目' } : { type: 'error', msg: '保存失败' })
    if (ok) onSaved?.()
    setTimeout(() => setSaveResult(null), 3000)
  }

  const handleReset = async () => {
    setSaving(true)
    setSaveResult(null)
    if (projectPath) await deleteProjectCustomPrompt(projectPath, builtinTemplate.key)
    await deleteCustomPrompt(builtinTemplate.key)
    setEditContent(builtinTemplate.content)
    setSaving(false)
    setSaveResult({ type: 'success', msg: '已恢复为内置默认' })
    onSaved?.()
    setTimeout(() => setSaveResult(null), 3000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex flex-col w-[95vw] h-[90vh] rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--color-editor-bg)', border: '1px solid var(--color-border)' }}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                  {builtinTemplate.name}
                </h2>
                <span
                  className="text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ color: sourceConf.color, backgroundColor: sourceConf.bg }}
                >
                  {sourceConf.label}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {builtinTemplate.description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-[var(--color-hover)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：变量面板 */}
          <aside
            className="w-64 flex-shrink-0 p-4 overflow-y-auto"
            style={{ borderRight: '1px solid var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
          >
            <div className="mb-4">
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
                可用变量
              </h3>
              <p className="text-[0.65rem] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                点击插入到光标位置
              </p>
              <div className="space-y-1.5">
                {Object.entries(builtinTemplate.variables).map(([varName, desc]) => (
                  <button
                    key={varName}
                    onClick={() => insertVariable(varName)}
                    title={desc}
                    className="w-full flex flex-col items-start gap-1 px-3 py-2 rounded-lg text-left transition-colors hover:bg-[var(--color-hover)] outline-none focus:outline-none"
                    style={{ backgroundColor: 'var(--color-panel)' }}
                  >
                    <code className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>
                      {`{{${varName}}}`}
                    </code>
                    <span className="text-[0.65rem] truncate w-full" style={{ color: 'var(--color-text-muted)' }}>
                      {desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* systemSuffix 提示 */}
            {builtinTemplate.systemSuffix && (
              <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.08)' }}>
                <h4 className="text-[0.65rem] font-semibold mb-1" style={{ color: '#3b82f6' }}>
                  系统约束（自动追加）
                </h4>
                <p className="text-[0.6rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  以下内容会自动追加到模板末尾，不可编辑：
                </p>
                <pre
                  className="text-[0.6rem] mt-2 p-2 rounded overflow-x-auto"
                  style={{
                    backgroundColor: 'var(--color-editor-bg)',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {builtinTemplate.systemSuffix.slice(0, 300)}
                  {builtinTemplate.systemSuffix.length > 300 && '...'}
                </pre>
              </div>
            )}

            {/* 提示 */}
            <div className="mt-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-hover)' }}>
              <p className="text-[0.65rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                修改 AI 的创作指导策略，输出格式约束会自动追加，不受自定义影响。
              </p>
            </div>
          </aside>

          {/* 右侧：编辑器 */}
          <main className="flex-1 flex flex-col p-4 overflow-hidden">
            {/* 变量缺失警告 */}
            {missingVars.length > 0 && (
              <div
                className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs mb-3 flex-shrink-0"
                style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b' }}
              >
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span>
                  以下变量在原模板中使用但在当前内容中未找到：
                  {missingVars.map((v) => (
                    <code key={v} className="mx-1 font-mono">{`{{${v}}}`}</code>
                  ))}
                  ，可能导致渲染时出现未替换的占位符。
                </span>
              </div>
            )}

            {/* 文本编辑区 */}
            <div className="flex-1 flex flex-col min-h-0">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 w-full rounded-lg px-4 py-3 text-sm font-mono resize-none outline-none"
                style={{
                  backgroundColor: 'var(--color-editor-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  lineHeight: 1.7,
                  tabSize: 2,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                spellCheck={false}
                placeholder="在此编辑模板内容..."
              />
            </div>

            {/* 保存结果反馈 */}
            {saveResult && (
              <div
                className={cn(
                  'text-sm px-4 py-2 rounded-lg my-3 flex-shrink-0',
                  saveResult.type === 'success'
                    ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                    : 'bg-red-500/10 text-red-500 border border-red-500/20'
                )}
              >
                {saveResult.type === 'success' ? '✅ ' : '❌ '}
                {saveResult.msg}
              </div>
            )}

            {/* 底部操作栏 */}
            <div
              className="flex items-center justify-between pt-4 flex-shrink-0"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleSaveGlobal} disabled={saving}>
                  <Globe size={13} />
                  保存到全局
                </Button>
                <Button variant="outline" size="sm" onClick={handleSaveProject} disabled={saving || !projectPath}>
                  <FolderOpen size={13} />
                  保存到项目
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving || source === 'builtin'}>
                  <RotateCcw size={13} />
                  恢复默认
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>
                关闭
              </Button>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}