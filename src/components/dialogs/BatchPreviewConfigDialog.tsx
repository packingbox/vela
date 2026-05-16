import { useState } from 'react'
import { Eye } from 'lucide-react'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Textarea } from '../ui/Textarea'

interface Props {
  isOpen: boolean
  onClose: () => void
  nextWriteChapter: number | null
  totalChapters: number
  onConfirm: (startChapter: number, endChapter: number, authorGuidance: string) => void
}

/** 批量预览配置弹框 — 选择预览章数范围 */
export default function BatchPreviewConfigDialog({ isOpen, onClose, nextWriteChapter, totalChapters, onConfirm }: Props) {
  // 用户可自由指定起始和结束章节
  const [startChapter, setStartChapter] = useState<number | ''>(nextWriteChapter ?? 1)
  const [endChapter, setEndChapter] = useState<number | ''>(Math.min(totalChapters, (nextWriteChapter ?? 1) + 9))
  // 作者微操指导 — 批量预览时应用到所有章节
  const [authorGuidance, setAuthorGuidance] = useState('')

  const handleConfirm = () => {
    const start = Number(startChapter) || 1
    const end = Number(endChapter) || totalChapters
    const finalStart = Math.max(1, Math.min(start, totalChapters))
    const finalEnd = Math.max(finalStart, Math.min(end, totalChapters))
    
    if (finalEnd < finalStart) {
      toast.warning('结束章节不能小于起始章节')
      return
    }

    onConfirm(finalStart, finalEnd, authorGuidance)
    onClose()
    const guidanceInfo = authorGuidance ? '（含作者微操指导）' : ''
    toast.info(`✨ 已提交：正在批量预览第 ${finalStart} - ${finalEnd} 章${guidanceInfo}...`)
  }

  const chapterCount = (() => {
    const start = Number(startChapter) || 1
    const end = Number(endChapter) || totalChapters
    const finalStart = Math.max(1, Math.min(start, totalChapters))
    const finalEnd = Math.max(finalStart, Math.min(end, totalChapters))
    return finalEnd - finalStart + 1
  })()

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye size={16} className="text-[var(--color-accent)]" />
            批量预览草稿
          </DialogTitle>
          <DialogDescription>
            选择要预览的章节范围（生成临时预览草稿，不保存到数据库）
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--color-text)' }}>
              预览范围
            </Label>
            <div className="space-y-3 mt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  指定预览：第
                </span>
                {/* 起始章 - 用户可自由修改 */}
                <Input
                  type="number"
                  value={startChapter}
                  onChange={e => setStartChapter(e.target.value === '' ? '' : parseInt(e.target.value))}
                  onBlur={() => {
                    const v = Number(startChapter)
                    if (!v || v < 1) setStartChapter(1)
                    else if (v > totalChapters) setStartChapter(totalChapters)
                  }}
                  className="w-16 h-6 text-xs px-2 py-0"
                  style={{ 
                    backgroundColor: 'var(--color-panel)',
                    color: 'var(--color-text)',
                    borderColor: 'var(--color-border)'
                  }}
                  onClick={e => e.stopPropagation()}
                  min={1}
                  max={totalChapters}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  章 到 第
                </span>
                {/* 结束章 - 可修改 */}
                <Input
                  type="number"
                  value={endChapter}
                  onChange={e => setEndChapter(e.target.value === '' ? '' : parseInt(e.target.value))}
                  onBlur={() => {
                    const start = Number(startChapter) || 1
                    const v = Number(endChapter)
                    if (!v || v < start) setEndChapter(start)
                    else if (v > totalChapters) setEndChapter(totalChapters)
                  }}
                  className="w-16 h-6 text-xs px-2 py-0"
                  onClick={e => e.stopPropagation()}
                  min={1}
                  max={totalChapters}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  章
                </span>
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                提示：范围不能超过实际章节总量（共 {totalChapters} 章）
              </div>
            </div>
          </div>

          {/* 统计信息 */}
          <div
            className="rounded-lg p-3"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--color-text-muted)' }}>共需预览</span>
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                {chapterCount} 章
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2">
              <span style={{ color: 'var(--color-text-muted)' }}>范围</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                第 {Number(startChapter) || 1} - {Number(endChapter) || totalChapters} 章
              </span>
            </div>
          </div>

          {/* 作者微操指导 — 批量预览时应用到所有章节 */}
          <div
            className="p-3 rounded-lg border"
            style={{
              borderColor: 'var(--color-accent)',
              backgroundColor: 'rgba(var(--accent-rgb, 99 102 241), 0.06)',
            }}
          >
            <Label className="flex items-center gap-1.5 mb-2">
              <span style={{ color: 'var(--color-text)' }}>作者微操指导</span>
              <span
                className="text-[0.7rem] font-normal"
                style={{ color: 'var(--color-text-muted)' }}
              >
                （预览时会作为最高优先级注入 AI）
              </span>
            </Label>
            <Textarea
              value={authorGuidance}
              onChange={(e) => setAuthorGuidance(e.target.value)}
              placeholder="特殊要求：整体风格、节奏把控、某个细节处理方式..."
              rows={3}
              className="text-sm"
              style={{ resize: 'none' }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button variant="ai" onClick={handleConfirm}>
            <Eye size={13} />
            开始批量预览
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
