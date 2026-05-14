import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import { DirectoryWorkflowParams, ChapterBlueprint, parseAndValidateBlueprints, saveAllBlueprints } from '../directory-workflow'

export class GenerateDirectoryCommand extends BaseWorkflowCommand<ChapterBlueprint[]> {
  constructor(private params: DirectoryWorkflowParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    const architecture = context.data.architecture as string
    const existingBlueprints = (context.data.existingBlueprints || []) as ChapterBlueprint[]

    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const genre = project.novelConfig.genre || ''

    let startChapter = 1
    let endChapter = totalChapters

    if (this.params.mode === 'append') {
      startChapter = this.params.startChapter || (existingBlueprints.length + 1)
      if (this.params.count && this.params.count > 0) {
        endChapter = startChapter + this.params.count - 1
      }
    } else if (this.params.mode === 'fill') {
      // 补全模式：找出所有缺失的章节
      const existingNumbers = new Set(existingBlueprints.map(b => b.chapterNumber))
      const missingChapters: number[] = []
      for (let n = 1; n <= totalChapters; n++) {
        if (!existingNumbers.has(n)) {
          missingChapters.push(n)
        }
      }
      
      if (missingChapters.length === 0) {
        callbacks.log('✅ 没有缺失的章节，无需补全')
        return []
      }
      
      callbacks.log(`🔧 检测到 ${missingChapters.length} 个缺失章节: ${missingChapters.join(', ')}`)
      startChapter = Math.min(...missingChapters)
      endChapter = Math.max(...missingChapters)
      // 将缺失章节传递给上下文，供后续使用
      context.data.missingChapters = missingChapters
    } else if (this.params.count && this.params.count > 0) {
      endChapter = Math.min(this.params.count, totalChapters)
    }

    callbacks.log(`生成第 ${startChapter}–${endChapter} 章蓝图...`)

    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    const defaultModel = llmStore.models.find(m => m.id === llmStore.defaultModelId)
    const modelMaxTokens = defaultModel?.maxTokens || 4096
    const outputBudget = Math.floor(modelMaxTokens * 0.6)
    const tokensPerChapter = 250
    // 减小批量大小，避免 LLM 输出过长被截断
    const batchSize = Math.min(10, Math.max(3, Math.floor(outputBudget / tokensPerChapter)))

    callbacks.log(`配置信息: modelMaxTokens=${modelMaxTokens}, outputBudget=${outputBudget}, tokensPerChapter=${tokensPerChapter}, batchSize=${batchSize}`)

    const newBlueprints: ChapterBlueprint[] = []
    let cursor = startChapter
    // 补全模式下需要跟踪缺失章节
    const missingChapters = (context.data.missingChapters as number[]) || []
    const existingNumbers = new Set(existingBlueprints.map(b => b.chapterNumber))

    while (cursor <= endChapter) {
      if (context.cancelled) { callbacks.log('已取消'); break }

      const batchEnd = Math.min(cursor + batchSize - 1, endChapter)
      
      // 在补全模式下，计算当前批次中实际缺失的章节
      let actualBatchChapters: number[]
      if (this.params.mode === 'fill') {
        actualBatchChapters = missingChapters.filter(n => n >= cursor && n <= batchEnd)
      } else {
        actualBatchChapters = Array.from({ length: batchEnd - cursor + 1 }, (_, i) => cursor + i)
      }
      
      // 如果当前批次没有缺失章节，跳过
      if (actualBatchChapters.length === 0) {
        cursor = batchEnd + 1
        continue
      }
      
      callbacks.log(`  当前循环: cursor=${cursor}, batchEnd=${batchEnd}, 计划请求 ${actualBatchChapters.length} 章 (${actualBatchChapters.join(', ')})`)

      let prompt: string
      if (cursor === 1 && this.params.mode === 'full') {
        const template = getPromptTemplate('chapter_blueprint')
        if (!template) throw new Error('模板丢失')
        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withNumberOfChapters(endChapter)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      } else {
        const template = getPromptTemplate('chapter_blueprint_chunk')
        if (!template) throw new Error('模板丢失')

        const prevAll = [...existingBlueprints, ...newBlueprints]
        const chapterList = prevAll.slice(-100).map(c => `第${c.chapterNumber}章 ${c.title}：${c.keyEvents}`).join('\n')

        // 补全模式下使用实际要生成的章节范围
        const reqStart = actualBatchChapters[0]
        const reqEnd = actualBatchChapters[actualBatchChapters.length - 1]
        
        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withChapterList(chapterList || '（首批生成）')
          .withNumberOfChapters(totalChapters)
          .withN(reqStart)
          .withM(reqEnd)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      }

      callbacks.setProgress(Math.round(((cursor - startChapter) / (endChapter - startChapter + 1)) * 90))

      const systemRole = getPromptTemplate('chapter_blueprint')?.systemRole || '你是一位经验丰富的网文架构师。'

      callbacks.log(`    调用 LLM 生成第 ${cursor}–${batchEnd} 章...`)

      let resultText = ''
      try {
        resultText = await this.callLLM(prompt, systemRole, callbacks, { responseFormat: { type: 'json_object' } })

        if (resultText) {
          callbacks.log(`    LLM 返回内容长度: ${resultText.length} 字符`)
          callbacks.log(`    LLM 返回预览: ${resultText.substring(0, Math.min(200, resultText.length))}${resultText.length > 200 ? '...' : ''}`)
        } else {
          callbacks.log(`    ⚠️ LLM 返回空内容`)
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        callbacks.log(`    ❌ LLM 调用失败: ${errMsg}`)
        throw new Error(`LLM 调用失败: ${errMsg}`)
      }

      callbacks.log(`    调用解析函数，期望章节范围: ${cursor}-${batchEnd}`)
      const parseResult = parseAndValidateBlueprints(resultText, cursor, batchEnd)

      if (parseResult.success) {
        // 打印解析到的章节号列表
        const chapterNumbers = parseResult.blueprints.map(p => p.chapterNumber).sort((a, b) => a - b)
        callbacks.log(`    解析到的章节号: [${chapterNumbers.join(', ')}]`)
        
        if (parseResult.partialSuccess) {
          callbacks.log(`    ⚠️ 部分成功: ${parseResult.blueprints.length} 章`)
          if (parseResult.error) {
            callbacks.log(`    ⚠️ ${parseResult.error.message}`)
          }
        } else {
          callbacks.log(`    ✅ 解析成功，共 ${parseResult.blueprints.length} 章`)
        }
        newBlueprints.push(...parseResult.blueprints)

        for (const blueprint of parseResult.blueprints) {
          await saveAllBlueprints([blueprint])
          callbacks.log(`    已保存第 ${blueprint.chapterNumber} 章：${blueprint.title}`)
        }
        useProjectStore.getState().refreshFileTree()
        // 每批次保存后发出事件通知蓝图编辑器刷新界面
        const { globalEventBus } = await import('../../../shared/event-bus')
        globalEventBus.emit('WORKFLOW_COMPLETE', {})

        const actualMaxChapter = parseResult.blueprints.length > 0
          ? Math.max(...parseResult.blueprints.map(p => p.chapterNumber))
          : batchEnd
        callbacks.log(`  ✅ 第 ${cursor}–${actualMaxChapter} 章完成（${parseResult.blueprints.length} 章）`)
        
        // 检查是否解析到的章节数少于预期
        const expectedCount = batchEnd - cursor + 1
        if (parseResult.blueprints.length > 0 && parseResult.blueprints.length < expectedCount) {
          callbacks.log(`    ⚠️ 预期 ${expectedCount} 章，但只解析到 ${parseResult.blueprints.length} 章`)
          
          // 找出缺失的章节号
          const existingChapters = new Set(parseResult.blueprints.map(p => p.chapterNumber))
          const missingChapters: number[] = []
          for (let n = cursor; n <= batchEnd; n++) {
            if (!existingChapters.has(n)) {
              missingChapters.push(n)
            }
          }
          
          if (missingChapters.length > 0) {
            callbacks.log(`    ⚠️ 缺失章节: ${missingChapters.join(', ')}`)
            callbacks.log(`    🔄 尝试为缺失章节单独生成蓝图...`)
            
            // 对每个缺失的章节单独请求生成
            for (const missingNum of missingChapters) {
              callbacks.log(`      生成第 ${missingNum} 章...`)
              await new Promise(resolve => setTimeout(resolve, 500)) // 避免请求过于频繁
              
              const prompt = await buildPrompt(
                project, 
                [{ chapterNumber: missingNum }], 
                existingBlueprints,
                modelMaxTokens,
                outputBudget
              )
              
              const llmResult = await this.callLLM(prompt, SYSTEM_PROMPT, callbacks, {
                responseFormat: { type: 'json_object' }
              }, context)
              
              callbacks.log(`      LLM 返回长度: ${llmResult.length} 字符`)
              
              const singleResult = parseBlueprints(llmResult, missingNum, missingNum)
              if (singleResult.success && singleResult.blueprints.length > 0) {
                const bp = singleResult.blueprints[0]
                await saveAllBlueprints([bp])
                callbacks.log(`      ✅ 已补全第 ${bp.chapterNumber} 章：${bp.title}`)
                newBlueprints.push(bp)
                existingChapters.add(bp.chapterNumber)
              } else {
                callbacks.log(`      ❌ 第 ${missingNum} 章补全失败`)
              }
            }
          }
        }
        
        cursor = actualMaxChapter + 1
        
        // 在批次之间添加延迟，避免请求过于频繁
        if (cursor <= endChapter) {
          callbacks.log(`    ⏳ 等待 1 秒后继续...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } else {
        callbacks.log(`    ❌ 第 ${cursor}–${batchEnd} 章解析失败`)
        if (parseResult.error) {
          callbacks.log(`    错误详情: ${parseResult.error.message}`)
          if (parseResult.error.problemArea) {
            callbacks.log(`    问题位置: ${parseResult.error.problemArea}`)
          }
          callbacks.log(`    📝 调试日志已保存，请查看项目目录下的 debug_blueprint_*.txt 文件`)
        }
        callbacks.log(`    ⏳ 等待 3 秒后重试...`)
        await new Promise(resolve => setTimeout(resolve, 3000))

        const err = new Error(`第 ${cursor}–${batchEnd} 章蓝图解析失败: ${parseResult.error?.message || '未知错误'}`)
        ;(err as any).parseResult = parseResult
        throw err
      }
    }

    context.data.newBlueprints = newBlueprints
    context.data.existingBlueprints = existingBlueprints

    callbacks.log(`✅ 共生成 ${newBlueprints.length} 章蓝图`)
    return newBlueprints
  }
}