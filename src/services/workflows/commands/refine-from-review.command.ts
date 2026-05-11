import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'


export interface RefineFromReviewParams {
  draftPath: string
  draftContent: string
  reviewReport: string
  reviewFileName?: string
  chapterNumber: number
  userRefinePrompt?: string
  /** 是否自动合并修订稿到草稿，跳过合并视图（用于自动编写流程） */
  autoMerge?: boolean
  /** 从第几个分段开始继续修稿（用于断点续修） */
  startSegmentIndex?: number
  /** 已完成的分段结果（用于断点续修） */
  completedSegments?: string[]
}

export class RefineFromReviewCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineFromReviewParams) {
    super()
  }

  /**
   * 将内容分段，尽量在段落边界处分割
   */
  private splitContentIntoSegments(content: string, maxChars: number): Array<{ content: string; startPos: number; endPos: number }> {
    const segments: Array<{ content: string; startPos: number; endPos: number }> = []
    let currentPos = 0
    const contentLength = content.length

    while (currentPos < contentLength) {
      let endPos = Math.min(currentPos + maxChars, contentLength)
      
      // 如果不是最后一段，尽量在段落边界处分割
      if (endPos < contentLength) {
        // 优先找段落结束符（连续换行）
        const doubleNewlinePos = content.lastIndexOf('\n\n', endPos)
        const newlinePos = content.lastIndexOf('\n', endPos)
        
        if (doubleNewlinePos > currentPos + maxChars * 0.5) {
          // 在双换行处分割（段落边界）
          endPos = doubleNewlinePos + 2
        } else if (newlinePos > currentPos + maxChars * 0.5) {
          // 在换行处分割
          endPos = newlinePos + 1
        } else {
          // 找不到合适的换行，在句子边界处分割
          const sentenceEndPos = content.lastIndexOf('。', endPos)
          if (sentenceEndPos > currentPos + maxChars * 0.5) {
            endPos = sentenceEndPos + 1
          } else {
            // 作为最后的手段，直接截断
          }
        }
      }

      // 确保至少前进一些
      if (endPos <= currentPos) {
        endPos = Math.min(currentPos + maxChars, contentLength)
      }

      segments.push({
        content: content.slice(currentPos, endPos),
        startPos: currentPos,
        endPos: endPos
      })

      currentPos = endPos
    }

    return segments
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    callbacks.log('正在根据审稿报告精准修复...')

    const draft = this.params.draftContent
    if (!draft) throw new Error('无草稿内容')

    // 获取当前模型的上下文长度限制
    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    const defaultModel = llmStore.models.find(m => m.id === llmStore.defaultModelId)
    const modelMaxTokens = defaultModel?.maxTokens || 4096
    
    // 计算可用的内容 token 预算（预留 60% 给系统提示词和审稿报告）
    const contentTokenBudget = Math.floor(modelMaxTokens * 0.4)
    // 假设中文字符约占 2 tokens，英文单词约占 1 token，取保守估计
    const charsPerSegment = Math.floor(contentTokenBudget * 0.7) // 进一步预留，因为审稿报告也会占用 tokens

    callbacks.log(`📊 当前模型上下文限制: ${modelMaxTokens} tokens`)
    callbacks.log(`📋 每段处理字数: 约 ${charsPerSegment} 字`)

    // 将草稿内容分段
    const segments = this.splitContentIntoSegments(draft, charsPerSegment)
    callbacks.log(`📝 本章内容将分为 ${segments.length} 段进行修稿`)

    // 检查是否有断点续修的参数（优先使用 params，其次从 context 获取）
    const refineProgress = context?.data?.refineProgress as {
      currentSegment?: number
      completedSegments?: string[]
    } || null
    const startIdx = this.params.startSegmentIndex ?? refineProgress?.currentSegment ?? 0
    const completedFromContext = refineProgress?.completedSegments
    const allRefinedSegments: string[] = 
      this.params.completedSegments ? [...this.params.completedSegments] : 
      (completedFromContext ? [...completedFromContext] : [])

    if (startIdx > 0) {
      callbacks.log(`🔄 从第 ${startIdx + 1} 段继续修稿（已完成 ${startIdx} 段）`)
    }

    const template = getPromptTemplate('refine_from_review')
    if (!template) throw new Error('未找到审稿修复模板')

    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    // 对每段内容进行修稿
    for (let i = startIdx; i < segments.length; i++) {
      const segment = segments[i]
      callbacks.log(`🔧 正在修稿第 ${i + 1}/${segments.length} 段...`)

      const promptBuilder = new ChapterPromptBuilder(template)
        .withReviewReport(this.params.reviewReport)
        .withDraftContent(segment.content)
        .withGlobalGuidance(project.novelConfig.globalGuidance || '')
        .withUserRefinePrompt(userPromptBlock)

      // 添加分段信息
      promptBuilder.withSegmentInfo({
        current: i + 1,
        total: segments.length,
        startPos: segment.startPos,
        endPos: segment.endPos
      })

      const refinedSegment = await this.callLLMWithBuilder(promptBuilder, callbacks)
      const cleanRefinedSegment = this.stripThinkingTags(refinedSegment)
      
      allRefinedSegments.push(cleanRefinedSegment)

      // 每完成一段就保存进度到 context，方便断点续修
      if (context) {
        context.data.refineProgress = {
          currentSegment: i + 1,
          totalSegments: segments.length,
          completedSegments: [...allRefinedSegments]
        }
      }
    }

    // 合并所有分段的修稿结果
    const cleanRefined = allRefinedSegments.join('\n\n')

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error('找不到基准草稿版本')

    const revIndex = await ipc.invoke('db:revision-next-index', baseDraft.id)

    // 清理该草稿下已有的 pending 状态修稿，保证只保留最新的一条
    const pendingRevs = await ipc.invoke('db:revision-get-pending', baseDraft.id)
    for (const rev of pendingRevs) {
      await ipc.invoke('db:revision-mark-discarded', rev.id)
    }

    const createRes = await ipc.invoke('db:revision-create', {
      baseDraftId: baseDraft.id,
      revisionIndex: revIndex,
      revisionType: 'review-fix',
      content: cleanRefined,
      wordCount: cleanRefined.length,
      userPrompt: this.params.userRefinePrompt,
    }) as { success: boolean; id: number }

    // 如果是自动编写流程，自动合并修订稿到草稿
    if (this.params.autoMerge) {
      // 标记修订稿为已合并
      await ipc.invoke('db:revision-mark-merged', createRes.id, baseDraft.id)
      // 更新草稿内容为修稿后的内容
      await ipc.invoke('db:draft-update-content', baseDraft.id, cleanRefined, cleanRefined.length)
      callbacks.log(`✅ 审稿修复完成（${cleanRefined.length} 字），已自动合并到草稿`)
    } else {
      // 正常流程：打开合并视图
      const { useEditorStore } = await import('../../../stores/editor-store')
      useEditorStore.getState().openFile({
        id: `diff-${this.params.draftPath}-${createRes.id}`,
        name: `审稿修复：第${this.params.chapterNumber}章`,
        type: 'diff',
        filePath: this.params.draftPath,
        originalContent: this.params.draftContent,
        content: cleanRefined,
        revisionPath: String(createRes.id),
        chapterNumber: this.params.chapterNumber,
        chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
      })
      callbacks.log(`✅ 审稿修复完成（${cleanRefined.length} 字），已生成修订稿版本 r${revIndex}`)
    }
    
    return cleanRefined
  }
}
