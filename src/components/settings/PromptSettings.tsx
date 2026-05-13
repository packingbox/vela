import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, ChevronRight, Globe, FolderOpen, RotateCcw, AlertTriangle, Plus, Trash2, X, ExternalLink } from 'lucide-react'
import {
  BUILTIN_PROMPTS,
  EDITABLE_PROMPT_KEYS,
  getPromptTemplate,
  getPromptSource,
  saveCustomPrompt,
  saveProjectCustomPrompt,
  deleteCustomPrompt,
  deleteProjectCustomPrompt,
  loadProjectCustomPrompts,
  applyPresetToProject,
  loadProjectPresetId,
  type PromptTemplate,
} from '../../services/prompt-templates'
import {
  getAllPresets,
  saveCustomPreset,
  deleteCustomPreset,
  generatePresetId,
  loadCustomPresets,
  type PromptPreset,
} from '../../services/prompt-presets'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { NativeSelect } from '../ui/NativeSelect'
import PromptTemplateEditorDialog from '../dialogs/PromptTemplateEditorDialog'
import { cn } from '../../lib/utils'

// ==================== 来源标签配置 ====================

const SOURCE_CONFIG = {
  builtin: { label: '内置', color: 'var(--color-text-muted)', bg: 'var(--color-hover)' },
  global: { label: '全局', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  project: { label: '项目', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
} as const

// ==================== 主组件 ====================

/** 提示词模板设置面板 */
export default function PromptSettings() {
  const project = useProjectStore((s) => s.currentProject)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [presets, setPresets] = useState<PromptPreset[]>([])
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null)
  const [showPresetCreator, setShowPresetCreator] = useState(false)
  const [fullEditorKey, setFullEditorKey] = useState<string | null>(null)

  useEffect(() => {
    loadCustomPresets().then(() => {
      setPresets(getAllPresets())
    })
  }, [])

  useEffect(() => {
    if (project?.path) {
      loadProjectCustomPrompts(project.path).then(async () => {
        const presetId = await loadProjectPresetId(project.path)
        setCurrentPresetId(presetId)
        setRefreshKey((k) => k + 1)
      })
    }
  }, [project?.path])

  const editableTemplates = BUILTIN_PROMPTS.filter((t) => EDITABLE_PROMPT_KEYS.includes(t.key))

  const handleToggle = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const handlePresetChange = async (presetId: string) => {
    if (!project?.path) return
    if (presetId === 'custom') {
      setCurrentPresetId(null)
      return
    }
    const ok = await applyPresetToProject(project.path, presetId)
    if (ok) {
      setCurrentPresetId(presetId)
      setRefreshKey((k) => k + 1)
    }
  }

  const handlePresetCreated = async (preset: PromptPreset) => {
    const ok = await saveCustomPreset(preset)
    if (ok) {
      setPresets(getAllPresets())
      setShowPresetCreator(false)
      if (project?.path) {
        await applyPresetToProject(project.path, preset.id)
        setCurrentPresetId(preset.id)
        setRefreshKey((k) => k + 1)
      }
    }
  }

  const handlePresetDeleted = async (presetId: string) => {
    const ok = await deleteCustomPreset(presetId)
    if (ok) {
      setPresets(getAllPresets())
      if (currentPresetId === presetId) {
        setCurrentPresetId(null)
        if (project?.path) {
          await applyPresetToProject(project.path, 'default')
        }
      }
    }
  }

  return (
    <div className="space-y-4" key={refreshKey}>
      {/* 预设选择器 */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Prompt 预设方案</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>选择预设后会自动覆盖项目级 Prompt 模板</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPresetCreator(true)}
          >
            <Plus size={12} />
            创建自定义预设
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all text-sm',
                currentPresetId === preset.id
                  ? 'ring-2 ring-[var(--color-accent)]'
                  : 'hover:ring-1 hover:ring-[var(--color-border)]'
              )}
              style={{
                backgroundColor: currentPresetId === preset.id ? 'var(--color-accent)' : 'var(--color-hover)',
                color: currentPresetId === preset.id ? 'white' : 'var(--color-text)',
              }}
              onClick={() => handlePresetChange(preset.id)}
            >
              <span>{preset.emoji}</span>
              <span>{preset.name}</span>
              {!preset.isBuiltIn && (
                <button
                  className="ml-1 p-0.5 rounded hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePresetDeleted(preset.id)
                  }}
                  title="删除此预设"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        {currentPresetId && presets.find(p => p.id === currentPresetId) && (
          <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
            当前预设：{presets.find(p => p.id === currentPresetId)?.emoji} {presets.find(p => p.id === currentPresetId)?.name}
            {presets.find(p => p.id === currentPresetId)?.isBuiltIn ? '（内置）' : '（自定义）'}
          </p>
        )}
      </div>

      {/* 说明 */}
      <div
        className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
        style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
      >
        <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>提示</span>
        <span>
          自定义提示词仅修改 AI 的创作指导策略，输出格式约束（如 JSON schema）会自动追加，不受自定义影响。
          选择预设会自动应用覆盖，也可单独编辑某个模板后保存到项目或全局。
        </span>
      </div>

      {editableTemplates.map((builtinTemplate) => {
        const source = getPromptSource(builtinTemplate.key)
        const currentTemplate = getPromptTemplate(builtinTemplate.key) ?? builtinTemplate
        const isExpanded = expandedKey === builtinTemplate.key

        return (
          <TemplateItem
            key={builtinTemplate.key}
            builtinTemplate={builtinTemplate}
            currentTemplate={currentTemplate}
            source={source}
            isExpanded={isExpanded}
            onToggle={() => handleToggle(builtinTemplate.key)}
            projectPath={project?.path ?? null}
            onSaved={triggerRefresh}
            onOpenFullEditor={() => setFullEditorKey(builtinTemplate.key)}
          />
        )
      })}

      {/* 创建自定义预设弹窗 */}
      {showPresetCreator && (
        <PresetCreatorDialog
          onClose={() => setShowPresetCreator(false)}
          onSave={handlePresetCreated}
        />
      )}

      {/* 独立模板编辑弹窗 */}
      {fullEditorKey && (
        <PromptTemplateEditorDialog
          templateKey={fullEditorKey}
          isOpen={true}
          onClose={() => setFullEditorKey(null)}
          onSaved={triggerRefresh}
        />
      )}
    </div>
  )
}

// ==================== 预设创建弹窗 ====================

function PresetCreatorDialog({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (preset: PromptPreset) => void
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📝')
  const [description, setDescription] = useState('')
  const [selectedBasePreset, setSelectedBasePreset] = useState('default')

  const presets = getAllPresets()

  const handleSave = () => {
    if (!name.trim()) return

    const basePreset = presets.find(p => p.id === selectedBasePreset)
    const newPreset: PromptPreset = {
      id: generatePresetId(),
      name: name.trim(),
      emoji,
      description: description.trim(),
      isBuiltIn: false,
      overrides: basePreset?.overrides || {},
    }
    onSave(newPreset)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[480px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--color-editor-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>创建自定义预设</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--color-hover)]">
            <X size={16} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>预设名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的自定义模板"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>图标 Emoji</label>
            <Input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="📝"
              className="w-20 text-center"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述这个预设的特点..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>基于模板（可选）</label>
            <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>选择一个预设作为基础，自动继承其覆盖内容</p>
            <NativeSelect
              value={selectedBasePreset}
              onChange={(e) => setSelectedBasePreset(e.target.value)}
              className="w-full"
            >
              <option value="default">默认模板（无覆盖）</option>
              {presets.filter(p => p.overrides && Object.keys(p.overrides).length > 0).map(p => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="default" onClick={handleSave} disabled={!name.trim()}>创建并应用</Button>
        </div>
      </div>
    </div>
  )
}

// ==================== 单个模板条目 ====================

function TemplateItem({
  builtinTemplate,
  currentTemplate,
  source,
  isExpanded,
  onToggle,
  projectPath,
  onSaved,
  onOpenFullEditor,
}: {
  builtinTemplate: PromptTemplate
  currentTemplate: PromptTemplate
  source: 'builtin' | 'global' | 'project'
  isExpanded: boolean
  onToggle: () => void
  projectPath: string | null
  onSaved: () => void
  onOpenFullEditor: (key: string) => void
}) {
  const [editContent, setEditContent] = useState(currentTemplate.content)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [prevExpanded, setPrevExpanded] = useState(isExpanded)
  const [prevContent, setPrevContent] = useState(currentTemplate.content)

  // 展开时重置编辑内容
  if (isExpanded !== prevExpanded || currentTemplate.content !== prevContent) {
    if (isExpanded) {
      setEditContent(currentTemplate.content)
      setSaveResult(null)
    }
    setPrevExpanded(isExpanded)
    setPrevContent(currentTemplate.content)
  }

  // 检查是否有被删除的变量
  const missingVars = Object.keys(builtinTemplate.variables).filter(
    (v) => builtinTemplate.content.includes(`{{${v}}}`) && !editContent.includes(`{{${v}}}`)
  )

  const sourceConf = SOURCE_CONFIG[source]

  // 插入变量到光标位置
  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = `{{${varName}}}`
    const newContent = editContent.slice(0, start) + text + editContent.slice(end)
    setEditContent(newContent)
    // 恢复光标
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // 保存到全局
  const handleSaveGlobal = async () => {
    setSaving(true)
    setSaveResult(null)
    const template: PromptTemplate = {
      ...builtinTemplate,
      content: editContent,
      // 不保存 systemSuffix，渲染时自动从内置取
    }
    delete (template as Partial<PromptTemplate>).systemSuffix
    const ok = await saveCustomPrompt(template)
    setSaving(false)
    setSaveResult(ok ? { type: 'success', msg: '已保存到全局配置' } : { type: 'error', msg: '保存失败' })
    if (ok) onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  // 保存到项目
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
    if (ok) onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  // 恢复默认
  const handleReset = async () => {
    setSaving(true)
    setSaveResult(null)
    // 依次删除项目级和全局级覆盖
    if (projectPath) await deleteProjectCustomPrompt(projectPath, builtinTemplate.key)
    await deleteCustomPrompt(builtinTemplate.key)
    setEditContent(builtinTemplate.content)
    setSaving(false)
    setSaveResult({ type: 'success', msg: '已恢复为内置默认' })
    onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  return (
    <div
      className="rounded-xl overflow-hidden transition-colors"
      style={{
        border: `1px solid ${isExpanded ? 'var(--color-accent)' : 'var(--color-border)'}`,
        backgroundColor: 'var(--color-panel)',
      }}
    >
      {/* 折叠头部 */}
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-hover)] outline-none focus:outline-none"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {builtinTemplate.name}
            </span>
            <span
              className="text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ color: sourceConf.color, backgroundColor: sourceConf.bg }}
            >
              {sourceConf.label}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {builtinTemplate.description}
          </p>
        </div>
      </button>

      {/* 展开编辑区 */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* 变量标签栏 */}
          <div className="pt-3">
            <p className="text-[0.68rem] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              可用变量（点击插入到光标位置）
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(builtinTemplate.variables).map(([varName, desc]) => (
                <button
                  key={varName}
                  onClick={() => insertVariable(varName)}
                  title={desc}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.68rem] transition-colors hover:bg-[var(--color-accent)] hover:text-white outline-none focus:outline-none"
                  style={{
                    backgroundColor: 'var(--color-hover)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <code className="font-mono">{`{{${varName}}}`}</code>
                  <span className="opacity-60 max-w-[120px] truncate">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 编辑 textarea */}
          <div>
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-xs font-mono resize-y outline-none focus:outline-none"
              style={{
                backgroundColor: 'var(--color-editor-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                minHeight: '200px',
                maxHeight: '500px',
                lineHeight: 1.6,
                transition: 'border-color 0.15s ease',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              spellCheck={false}
            />
          </div>

          {/* 变量缺失警告 */}
          {missingVars.length > 0 && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
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


          {/* 操作按钮 */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveGlobal}
              disabled={saving}
              title="保存到全局配置（所有小说生效）"
            >
              <Globe size={12} />
              保存到全局
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveProject}
              disabled={saving || !projectPath}
              title={projectPath ? '保存到当前项目（仅此小说生效）' : '请先打开一个项目'}
            >
              <FolderOpen size={12} />
              保存到项目
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={saving || source === 'builtin'}
              title="恢复为内置默认版本"
            >
              <RotateCcw size={12} />
              恢复默认
            </Button>
            <div className="flex-1" />
            <Button
              variant="ai"
              size="sm"
              onClick={() => onOpenFullEditor(builtinTemplate.key)}
              title="独立编辑页面，更大的编辑空间"
            >
              <ExternalLink size={12} />
              独立编辑
            </Button>
          </div>

          {/* 保存结果反馈 */}
          {saveResult && (
            <div
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg',
                saveResult.type === 'success'
                  ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                  : 'bg-red-500/10 text-red-500 border border-red-500/20'
              )}
            >
              {saveResult.type === 'success' ? '✅ ' : '❌ '}
              {saveResult.msg}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
