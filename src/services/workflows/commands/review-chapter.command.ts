import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ReviewPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'


export interface ReviewChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  /** 审稿维度侧重点（可选） */
  reviewFocus?: string
  /** 从第几个分段开始继续审查（用于断点续审） */
  startSegmentIndex?: number
  /** 已完成的分段结果（用于断点续审） */
  completedResults?: Array<{ summary: string; items: Array<Record<string, unknown>> }>
}

export class ReviewChapterCommand extends BaseWorkflowCommand<string> {
  constructor(private params: ReviewChapterParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    const draft = this.params.draftContent
    if (!draft) throw new Error('无草稿内容')

    callbacks.log('准备启动一致性审查引擎...')
    callbacks.log('  检索全书设定档案...')

    // 从 context 中获取断点续审的进度信息
    const reviewProgress = context?.data?.reviewProgress as {
      currentSegment?: number
      totalSegments?: number
      completedResults?: Array<{ summary: string; items: Array<Record<string, unknown>> }>
    } || null

    // 使用向量检索获取与待审章节相关的历史上下文（替代全局摘要）
    let contextSummary = '（无上下文参考）'
    try {
      // 从待审内容中提取前 200 字作为检索 query
      const queryText = draft.slice(0, 200)
      const results = await ipc.invoke('kb:search', queryText, 5)
      if (results.length > 0) {
        contextSummary = results
          .map((r: { fileName: string; score: number; text: string }, i: number) =>
            `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`)
          .join('\n\n')
      }
    } catch {
      contextSummary = '（知识库检索不可用）'
    }

    const characterState = await this.readCharacterStates()
    const worldBuilding = await this.readWorldBuilding()

    // 获取当前模型的上下文长度限制
    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    const defaultModel = llmStore.models.find(m => m.id === llmStore.defaultModelId)
    const modelMaxTokens = defaultModel?.maxTokens || 4096
    
    // 计算可用的内容 token 预算（预留 60% 给系统提示词和上下文）
    const contentTokenBudget = Math.floor(modelMaxTokens * 0.4)
    // 假设中文字符约占 2 tokens，英文单词约占 1 token，取保守估计
    const charsPerSegment = Math.floor(contentTokenBudget * 0.8) // 进一步预留

    callbacks.log(`📊 当前模型上下文限制: ${modelMaxTokens} tokens`)
    callbacks.log(`📋 每段处理字数: 约 ${charsPerSegment} 字`)

    // 将草稿内容分段
    const segments = this.splitContentIntoSegments(draft, charsPerSegment)
    callbacks.log(`📝 本章内容将分为 ${segments.length} 段进行审查`)

    // 检查是否有断点续审的参数（优先使用 params，其次从 context 获取）
    const startIdx = this.params.startSegmentIndex ?? reviewProgress?.currentSegment ?? 0
    const completedFromContext = reviewProgress?.completedResults
    const allReviewResults: Array<{ summary: string; items: Array<Record<string, unknown>> }> = 
      this.params.completedResults ? [...this.params.completedResults] : 
      (completedFromContext ? [...completedFromContext] : [])

    if (startIdx > 0) {
      callbacks.log(`🔄 从第 ${startIdx + 1} 段继续审查（已完成 ${startIdx} 段）`)
    }

    for (let i = startIdx; i < segments.length; i++) {
      const segment = segments[i]
      callbacks.log(`🔍 正在审查第 ${i + 1}/${segments.length} 段...`)

      const template = getPromptTemplate('consistency_check')
      if (!template) throw new Error('未找到审稿模板')

      const promptBuilder = new ReviewPromptBuilder(template)
        .withChapterContent(segment.content)
        .withCharacterStates(characterState)
        .withGlobalSummary(contextSummary)
        .withWorldBuilding(worldBuilding)
        .withReviewFocus(this.params.reviewFocus || '')

      // 添加分段信息
      promptBuilder.withSegmentInfo({
        current: i + 1,
        total: segments.length,
        startPos: segment.startPos,
        endPos: segment.endPos
      })

      // 期望 JSON 格式返回
      const reviewResultRaw = await this.callLLMWithBuilder(
        promptBuilder,
        callbacks,
        { responseFormat: { type: 'json_object' } },
        context
      )

      const reviewResultClean = this.stripThinkingTags(reviewResultRaw)

      let parsedResult: { summary: string; items: Array<Record<string, unknown>> }
      try {
        parsedResult = this.parseJSON<{ summary: string; items: Array<Record<string, unknown>> }>(reviewResultClean)
      } catch {
        callbacks.log(`⚠️ 第 ${i + 1} 段审稿结果解析失败`)
        parsedResult = { summary: `第 ${i + 1} 段解析失败`, items: [] }
      }

      allReviewResults.push(parsedResult)

      // 每完成一段就保存进度到 context，方便断点续审
      if (context) {
        context.data.reviewProgress = {
          currentSegment: i + 1,
          totalSegments: segments.length,
          completedResults: [...allReviewResults]
        }
      }
    }

    // 合并所有分段的审稿结果
    const mergedResult = this.mergeReviewResults(allReviewResults)
    const reviewResultClean = JSON.stringify(mergedResult, null, 2)

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error('找不到基准草稿版本')
    const baseVersion = baseDraft.version

    const revIndex = await ipc.invoke('db:review-next-index', baseDraft.id)

    await ipc.invoke('db:review-create', {
      baseDraftId: baseDraft.id,
      reviewIndex: revIndex,
      content: reviewResultClean,
    })

    // 将审稿报告 JSON 序列化为字符串，作为 content 传给 Tab
    // EditorArea 渲染 ReviewReport 的条件：activeTab.content 存在
    const reportContent = reviewResultClean

    const { useEditorStore } = await import('../../../stores/editor-store')
    const pseudoReviewPath = `vela://draft/ch${this.params.chapterNumber}/v${baseVersion}/review${revIndex}`
    useEditorStore.getState().openFile({
      id: `review-${this.params.draftPath}-${revIndex}`,
      name: `审稿报告：第${this.params.chapterNumber}章`,
      type: 'review-report',
      content: reportContent,
      filePath: this.params.draftPath,
      reportPath: pseudoReviewPath,
      reviewReport: reportContent,
      chapterNumber: this.params.chapterNumber,
    })

    callbacks.log(`✅ 审查完成，已生成审稿报告 r${revIndex}`)
    return reviewResultClean
  }

  /**
   * 将内容分段，每段不超过指定字符数
   * 尽量在段落边界处分割
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
          // 找不到合适的分割点，直接截断
          // 尽量在句子边界处截断
          const periodPos = content.lastIndexOf('。', endPos)
          const questionPos = content.lastIndexOf('？', endPos)
          const exclaimPos = content.lastIndexOf('！', endPos)
          const maxPunctPos = Math.max(periodPos, questionPos, exclaimPos)
          
          if (maxPunctPos > currentPos + maxChars * 0.5) {
            endPos = maxPunctPos + 1
          }
        }
      }

      const segmentContent = content.slice(currentPos, endPos).trim()
      if (segmentContent) {
        segments.push({
          content: segmentContent,
          startPos: currentPos,
          endPos: endPos
        })
      }
      
      currentPos = endPos
    }

    return segments
  }

  /**
   * 合并多个分段的审稿结果
   */
  private mergeReviewResults(results: Array<{ summary: string; items: Array<Record<string, unknown>> }>): { summary: string; items: Array<Record<string, unknown>> } {
    if (results.length === 0) {
      return { summary: '未生成审稿结果', items: [] }
    }

    if (results.length === 1) {
      return results[0]
    }

    // 合并摘要
    const summaries = results.map((r, i) => `【第 ${i + 1} 段】${r.summary}`).join('\n\n')
    const mergedSummary = `本章分为 ${results.length} 段审查，综合评价如下：\n\n${summaries}`

    // 合并问题列表，去除重复项
    const allItems: Array<Record<string, unknown>> = []
    const seenIssues = new Set<string>()

    for (const result of results) {
      for (const item of result.items || []) {
        const issueKey = `${item.type || ''}${item.description || ''}`
        if (!seenIssues.has(issueKey)) {
          seenIssues.add(issueKey)
          allItems.push(item)
        }
      }
    }

    return {
      summary: mergedSummary,
      items: allItems
    }
  }

  private async readCharacterStates(): Promise<string> {
    try {
      const allChars = await ipc.invoke('db:character-get-all')
      const states: string[] = []
      for (const card of allChars) {
        if (card.name && card.currentState) {
          const cs = card.currentState
          states.push(`${card.name}（${card.role || '未知'}）: ${cs.powerLevel || ''}, ${cs.location || ''}, ${cs.physicalState || ''}, ${cs.mentalState || ''}, 最近：${cs.recentEvents || ''}`)
        }
      }
      return states.length > 0 ? states.join('\n') : '（暂无）'
    } catch { return '（读取失败）' }
  }

  private async readWorldBuilding(): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    return core?.worldbuilding || '（暂无）'
  }
}
