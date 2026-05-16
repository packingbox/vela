import { useState } from 'react'
import { Layers } from 'lucide-react'
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

/** 批量写作配置弹框 — 选择写作章数范围 */
export default function BatchWriteConfigDialog({ isOpen, onClose, nextWriteChapter, totalChapters, onConfirm }: Props) {
  // 默认起始章为未完成的第一章，不可修改
  const startChapter = nextWriteChapter ?? 1
  const [endChapter, setEndChapter] = useState<number | ''>(Math.min(totalChapters, startChapter + 49))
  // 作者微操指导 — 批量写作时应用到所有章节
  const [authorGuidance, setAuthorGuidance] = useState('')

  const handleConfirm = () => {
    const end = Number(endChapter) || startChapter
    const finalEnd = Math.max(startChapter, Math.min(end, totalChapters))
    
    if (finalEnd < startChapter) {
      toast.warning('结束章节不能小于起始章节')
      return
    }

    onConfirm(startChapter, finalEnd, authorGuidance)
    onClose()
    const guidanceInfo = authorGuidance ? '（含作者微操指导）' : ''
    toast.info(`✨ 已提交：正在自动编写第 ${startChapter} - ${finalEnd} 章${guidanceInfo}...`)
  }

  const chapterCount = (() => {
    const end = Number(endChapter) || startChapter
    return Math.max(1, Math.min(end, totalChapters) - startChapter + 1)
  })()

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers size={16} className="text-[var(--color-accent)]" />
            批量自动编写
          </DialogTitle>
          <DialogDescription>
            选择要自动编写的章节范围（对每章依次执行写稿→审稿→修稿→定稿）
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--color-text)' }}>
              写作范围
            </Label>
            <div className="space-y-3 mt-2">
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  指定编写：第
                </span>
                {/* 起始章 - 灰色不可修改 */}
                <Input
                  type="number"
                  value={startChapter}
                  onChange={() => {}}
                  className="w-16 h-6 text-xs px-2 py-0"
                  style={{ 
                    backgroundColor: 'var(--color-panel)',
                    color: 'var(--color-text-muted)',
                    cursor: 'not-allowed',
                    borderColor: 'var(--color-border)'
                  }}
                  readOnly
                />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  章（未完成的第一章）
                </span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  到 第
                </span>
                {/* 结束章 - 可修改 */}
                <Input
                  type="number"
                  value={endChapter}
                  onChange={e => setEndChapter(e.target.value === '' ? '' : parseInt(e.target.value))}
                  onBlur={() => {
                    const v = Number(endChapter)
                    if (!v || v < startChapter) setEndChapter(startChapter)
                    else if (v > totalChapters) setEndChapter(totalChapters)
                  }}
                  className="w-16 h-6 text-xs px-2 py-0"
                  onClick={e => e.stopPropagation()}
                  min={startChapter}
                  max={totalChapters}
                />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  章
                </span>
              </div>
            </div>
          </div>

          {/* 统计信息 */}
          <div
            className="rounded-lg p-3"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--color-text-muted)' }}>共需编写</span>
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                {chapterCount} 章
              </span>
            </div>
            <div className="flex items-center justify-between text-xs mt-2">
              <span style={{ color: 'var(--color-text-muted)' }}>范围</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                第 {startChapter} - {Number(endChapter) || startChapter} 章
              </span>
            </div>
          </div>

          {/* 作者微操指导 — 批量写作时应用到所有章节 */}
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
                （写稿时会作为最高优先级注入 AI）
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
            <Layers size={13} />
            开始批量编写
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}