import { useState, useEffect, useRef } from 'react'
import { X, RotateCcw, Save } from 'lucide-react'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import type { GeneratableField } from '../../services/workflows/commands/generate-field.command'

interface Props {
  fieldKey: GeneratableField
  fieldName: string
  fieldDesc?: string
  value: string
  isOpen: boolean
  onClose: () => void
  onSave: (value: string) => void
  onAIGenerate?: (fieldKey: GeneratableField) => void
}

const FIELD_CONFIG: Record<GeneratableField, { name: string; desc: string; placeholder: string }> = {
  coreOutline: {
    name: '核心大纲',
    desc: '一段话概括整个故事：谁/在哪/要做什么。也是 AI 一键填充时的灵感输入',
    placeholder: '在此输入你的创作想法，或让 AI 根据这段话一键生成全部配置...',
  },
  worldSetting: {
    name: '世界观 / 初始设定',
    desc: '故事发生的背景、时代、力量体系（架构生成后可由 AI 自动扩展）',
    placeholder: '描述故事发生的背景、时代、力量体系、社会结构（可简写，AI 生成架构时会自动丰富）...',
  },
  goldenFinger: {
    name: '金手指 / 核心卖点',
    desc: '主角的差异化优势：获取方式、核心能力、成长路径（架构生成时 AI 会深度扩展）',
    placeholder: '主角的独特优势或故事核心卖点（可简写，架构生成时AI会深度扩展）...',
  },
  protagonistProfile: {
    name: '主角人设',
    desc: '性格特征、背景故事、核心目标（架构生成时 AI 会补全关系网和角色弧光）',
    placeholder: '主角的性格特征、背景故事、核心目标...',
  },
  globalGuidance: {
    name: '全局写作要求',
    desc: '写作风格、禁忌事项、节奏控制等全局规则（AI 填充配置时会自动生成）',
    placeholder: '全局的写作风格要求、禁忌事项、特殊规则...',
  },
  writingStyle: {
    name: '文风配置',
    desc: 'AI 写稿/修稿时会严格遵循这里的风格要求。可手动填写或由 AI 自动生成。',
    placeholder: '尚未配置。点击右上角「AI 生成」或手动填写…',
  },
}

export default function ConfigFieldEditorDialog({
  fieldKey,
  fieldName,
  fieldDesc,
  value,
  isOpen,
  onClose,
  onSave,
  onAIGenerate,
}: Props) {
  const [editContent, setEditContent] = useState(value)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const config = FIELD_CONFIG[fieldKey]
  const addLog = useWorkflowStore.getState().addLog

  useEffect(() => {
    if (isOpen) {
      setEditContent(value)
    }
  }, [isOpen, value])

  const handleSave = async () => {
    setSaving(true)
    try {
      onSave(editContent)
      addLog('info', `✅ 已保存「${config.name}」`)
      onClose()
    } catch (error) {
      addLog('error', `保存失败：${error}`)
    } finally {
      setSaving(false)
    }
  }

  const handleAIGenerate = async () => {
    if (!onAIGenerate) return
    setGenerating(true)
    try {
      await onAIGenerate(fieldKey)
    } catch (error) {
      addLog('error', `AI 生成失败：${error}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleReset = () => {
    setEditContent(value)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex flex-col w-[95vw] h-[90vh] max-w-5xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--color-editor-bg)', border: '1px solid var(--color-border)' }}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {fieldName || config.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {fieldDesc || config.desc}
            </p>
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
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* 统计信息 */}
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              字数：{editContent.length}
            </div>
            <div className="flex items-center gap-2">
              {onAIGenerate && (
                <Button
                  variant="ai"
                  size="sm"
                  onClick={handleAIGenerate}
                  disabled={generating || saving}
                >
                  {generating ? '生成中...' : 'AI 生成'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={saving || generating || editContent === value}
              >
                <RotateCcw size={13} />
                恢复
              </Button>
            </div>
          </div>

          {/* 文本编辑区 */}
          <div className="flex-1 flex flex-col min-h-0">
            <Textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="flex-1 w-full resize-none text-sm leading-relaxed"
              placeholder={config.placeholder}
              style={{
                fontFamily: 'var(--font-writing)',
              }}
            />
          </div>
        </div>

        {/* 底部操作栏 */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {editContent !== value && '⚠️ 有未保存的更改'}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button variant="default" onClick={handleSave} disabled={saving || generating || editContent === value}>
              <Save size={13} />
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
