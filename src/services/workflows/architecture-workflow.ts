import type { WorkflowDefinition, WorkflowContext, StepCallbacks, WorkflowStep } from '../../stores/workflow-store'
import { useLLMStore } from '../../stores/llm-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useCharacterStore } from '../../stores/character-store'
import { getPromptTemplate } from '../prompt-templates'
import { ipc } from '../ipc-client'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { CharacterData } from '../../../electron/repositories/character-repository'

import { runPostProcessPipeline, type PostProcessStep, stripThinkingTags } from './workflow-utils'

// ==========================================
// 1. 类型定义
// ==========================================

export interface PartialArchData {
  premise_result?: string
  character_dynamics_result?: string
  character_state_result?: string
  world_building_result?: string
  synopsis_result?: string
}

export interface ArchitectureWorkflowParams {
  selectedSteps?: Array<'premise' | 'characters' | 'worldbuilding' | 'synopsis'>
  /** 每步的补充指导（如 { premise: "多强调金手指的限制" }） */
  stepGuidance?: Record<string, string>
}

export interface ConfigGenerationWorkflowParams {
  idea: string
  totalChapters: number
  wordsPerChapter: number
  onGenerated: (config: Partial<NovelConfig>) => void
}

// ==========================================
// 2. 工作流定义
// ==========================================

export function createArchitectureWorkflow(params: ArchitectureWorkflowParams = {}): WorkflowDefinition {
  const sel = params.selectedSteps ?? ['premise', 'characters', 'worldbuilding', 'synopsis']
  const stepDesc = (key: string, defaultDesc: string) => sel.includes(key as never) ? defaultDesc : `（跳过，保留已有内容）`
  // 闭包捕获逐步指导，executor 中注入到 context.data
  const guidance = params.stepGuidance || {}

  const allSteps = [
    {
      name: '故事前提',
      key: 'premise',
      description: stepDesc('premise', '提炼故事前提与核心卖点'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCoreSeedCommand } = await import('./commands/architecture.command')
        return new GenerateCoreSeedCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: '角色图谱',
      key: 'characters',
      description: stepDesc('characters', '构建核心角色关系网与角色弧光'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCharactersCommand } = await import('./commands/architecture.command')
        return new GenerateCharactersCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: '世界观',
      key: 'worldbuilding',
      description: stepDesc('worldbuilding', '构建自带冲突引擎的世界观矩阵'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateWorldBuildingCommand } = await import('./commands/architecture.command')
        return new GenerateWorldBuildingCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: '情节大纲',
      description: stepDesc('synopsis', '整合所有碎片，按选定结构模式生成情节大纲'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GeneratePlotArchitectureCommand } = await import('./commands/architecture.command')
        return new GeneratePlotArchitectureCommand(sel).execute({ step, context, callbacks })
      },
    },
  ]

  return {
    type: 'architecture_generation',
    title: '🏛️ AI 生成故事架构',
    steps: sel.length === 4 
      ? allSteps 
      : allSteps.filter(s => sel.includes((s as { key: string }).key as never)),
    onComplete: {
      mode: 'open',
      openResult: async () => {
        useCharacterStore.getState().loadCharacters()
      },
    },
  }
}

// ==========================================
// 3. 辅助函数
// ==========================================

export function getPOVLabel(pov: string): string {
  const labels: Record<string, string> = {
    first_person: '第一人称',
    second_person: '第二人称',
    third_limited: '第三人称有限视角',
    third_omniscient: '第三人称全知视角',
    multi_pov: '多视角轮换',
  }
  return labels[pov] || pov
}

export function getNarrativePOVLabel(pov: string): string {
  return getPOVLabel(pov)
}

export function getPlotStructureGuide(structure: string, totalChapters: number): string {
  const guides: Record<string, (chapters: number) => string> = {
    three_act: (ch) => {
      const act1 = Math.floor(ch * 0.25)
      const act2 = Math.floor(ch * 0.5)
      const act3 = ch - act1 - act2
      return `三幕式结构：第一幕(${act1}章)-铺垫引入，第二幕(${act2}章)-冲突升级，第三幕(${act3}章)-高潮解决`
    },
    hero_journey: (ch) => {
      const stages = Math.floor(ch / 12)
      return `英雄之旅结构：共12阶段，每阶段约${stages}章，包含启程、启蒙、归来三大阶段`
    },
    five_act: (ch) => {
      const act = Math.floor(ch / 5)
      return `五幕式结构：序幕(${act}章)-起(${act}章)-承(${act}章)-转(${act}章)-合(${ch - act * 4}章)`
    },
    save_the_cat: (ch) => {
      const beats = Math.floor(ch / 15)
      return `Save the Cat结构：15个节拍，每节拍约${beats}章，含开场画面、主题呈现、铺垫等`
    },
  }
  return guides[structure]?.(totalChapters) || `自定义结构（共${totalChapters}章）`
}

// ==========================================
// 4. 角色卡后处理逻辑
// ==========================================

export const ARCH_CHARACTER_SCOPE = 'arch_characters'

export function createCharacterExtractSteps(_projectPath: string, characterDynamicsContent: string, genre: string): PostProcessStep[] {
  return [
    {
      key: 'extract_character_cards',
      label: '📇 提取初始角色卡',
      critical: true,
      executor: async (cb) => {
        const { ArchitecturePromptBuilder } = await import('../prompts/prompt-builder')
        const template = getPromptTemplate('extract_initial_characters')
        if (!template) throw new Error('未找到 extract_initial_characters')
        const extractPrompt = new ArchitecturePromptBuilder(template).withCharacterDynamics(characterDynamicsContent).withGenre(genre).build()
        const systemRole = template.systemRole || '你是一位专业的小说数据结构化专家。'

        const llmStore = useLLMStore.getState()
        cb.appendText('🔍 正在调用 AI 提取角色卡片...\n')

        // 使用 Promise 包装流式生成，支持取消
        const fullContent = await new Promise<string>((resolve, reject) => {
          let streamRequestId = ''
          let cancelCheckTimer: ReturnType<typeof setInterval> | null = null
          let timeoutTimer: ReturnType<typeof setTimeout> | null = null
          let content = ''

          // 检查取消状态（轮询）
          cancelCheckTimer = setInterval(() => {
            const workflowStore = useWorkflowStore.getState()
            const activeRuns = workflowStore.activeRuns
            // 检查是否存在包含角色卡提取步骤的活跃工作流
            const hasActiveExtract = activeRuns.some(r => 
              r.type === 'post_process' && 
              r.steps.some((s: WorkflowStep) => s.name === '提取角色卡片')
            )
            
            if (!hasActiveExtract && streamRequestId) {
              clearInterval(cancelCheckTimer!)
              if (timeoutTimer) clearTimeout(timeoutTimer)
              llmStore.cancelGeneration(streamRequestId).catch(() => {})
              reject(new Error('工作流已取消'))
            }
          }, 200)

          // 设置超时：300秒(5分钟)无响应则超时
          timeoutTimer = setTimeout(() => {
            if (cancelCheckTimer) clearInterval(cancelCheckTimer)
            if (streamRequestId) llmStore.cancelGeneration(streamRequestId).catch(() => {})
            reject(new Error('LLM 请求超时（超过5分钟未响应）'))
          }, 300000)

          const cleanup = () => {
            if (cancelCheckTimer) clearInterval(cancelCheckTimer)
            if (timeoutTimer) clearTimeout(timeoutTimer)
          }

          llmStore.generateStream(
            [{ role: 'system', content: systemRole }, { role: 'user', content: extractPrompt }],
            {
              onChunk: (chunk) => {
                // 检查是否已取消
                const workflowStore = useWorkflowStore.getState()
                const activeRuns = workflowStore.activeRuns
                const hasActiveExtract = activeRuns.some(r => 
                  r.type === 'post_process' && 
                  r.steps.some((s: WorkflowStep) => s.name === '提取角色卡片')
                )
                if (!hasActiveExtract) return
                
                content += chunk
                cb.appendText(chunk)
                
                // 收到数据，重置超时计时器
                if (timeoutTimer) {
                  clearTimeout(timeoutTimer)
                  timeoutTimer = setTimeout(() => {
                    if (cancelCheckTimer) clearInterval(cancelCheckTimer)
                    if (streamRequestId) llmStore.cancelGeneration(streamRequestId).catch(() => {})
                    reject(new Error('LLM 请求超时（超过5分钟未响应）'))
                  }, 300000)
                }
              },
              onDone: (text) => {
                cleanup()
                // 检查是否已取消
                const workflowStore = useWorkflowStore.getState()
                const activeRuns = workflowStore.activeRuns
                const hasActiveExtract = activeRuns.some(r => 
                  r.type === 'post_process' && 
                  r.steps.some((s: WorkflowStep) => s.name === '提取角色卡片')
                )
                if (!hasActiveExtract) {
                  reject(new Error('工作流已取消'))
                  return
                }
                resolve(text || content)
              },
              onError: (err) => {
                cleanup()
                reject(new Error(err || '流式生成失败'))
              }
            },
            undefined,
            { responseFormat: { type: 'json_object' } }
          ).then(reqId => {
            streamRequestId = reqId
            // 如果在 generateStream 返回前已经取消
            const workflowStore = useWorkflowStore.getState()
            const activeRuns = workflowStore.activeRuns
            const hasActiveExtract = activeRuns.some(r => 
              r.type === 'post_process' && 
              r.steps.some((s: WorkflowStep) => s.name === '提取角色卡片')
            )
            if (!hasActiveExtract) {
              llmStore.cancelGeneration(reqId).catch(() => {})
              cleanup()
              reject(new Error('工作流已取消'))
            }
          }).catch(err => {
            cleanup()
            reject(err)
          })
        })

        console.log('[DEBUG] AI 原始返回:', fullContent.substring(0, 500))
        const cleanedCards = stripThinkingTags(fullContent)
        console.log('[DEBUG] 清洗后:', cleanedCards.substring(0, 500))
        
        // 将 AI 返回内容写入临时文件以便调试
        try {
          const fs = await import('fs')
          const path = await import('path')
          const logPath = path.join(process.env.APP_ROOT || '.', 'debug_ai_response.txt')
          fs.writeFileSync(logPath, fullContent, 'utf-8')
          console.log('[DEBUG] AI 返回内容已写入:', logPath)
        } catch (e) {
          console.log('[DEBUG] 写入日志文件失败:', e)
        }

        // 移除基本干扰字符
        let jsonStr = cleanedCards
          .replace(/```json?\n?/g, '')
          .replace(/```/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/[\x00-\x1F\x7F]/g, ' ')
          .replace(/\r/g, '')
          .replace(/\n\s*/g, ' ')
          .trim()
        
        // 移除 BOM 字符（UTF-8 BOM: 0xEF, 0xBB, 0xBF）
        if (jsonStr.charCodeAt(0) === 0xEF && jsonStr.charCodeAt(1) === 0xBB && jsonStr.charCodeAt(2) === 0xBF) {
          jsonStr = jsonStr.substring(3)
          console.log('[DEBUG] 已移除 BOM 字符')
        }
        
        // 调试：显示处理后的字符串开头
        console.log('[DEBUG] 预处理后的 JSON:', jsonStr.substring(0, 100))
        
        // === 核心增强：处理多个 JSON 对象拼接的情况 ===
        // 寻找所有完整的 JSON 对象/数组
        const jsonFragments: string[] = []
        let depth = 0
        let startIndex = -1
        
        for (let i = 0; i < jsonStr.length; i++) {
          const char = jsonStr[i]
          
          if (char === '{' || char === '[') {
            if (depth === 0) {
              startIndex = i
            }
            depth++
          } else if (char === '}' || char === ']') {
            depth--
            if (depth === 0 && startIndex !== -1) {
              const fragment = jsonStr.substring(startIndex, i + 1)
              jsonFragments.push(fragment)
              startIndex = -1
            }
          }
        }
        
        console.log('[DEBUG] 找到', jsonFragments.length, '个 JSON 片段')
        
        // 如果找到多个片段，尝试将它们组合成数组
        let combinedJson = jsonStr
        if (jsonFragments.length > 1) {
          console.log('[DEBUG] 检测到多个 JSON 对象，尝试组合成数组')
          combinedJson = '[' + jsonFragments.join(',') + ']'
        } else if (jsonFragments.length === 1) {
          combinedJson = jsonFragments[0]
        }
        
        jsonStr = combinedJson
        console.log('[DEBUG] 组合后的 JSON:', jsonStr.substring(0, 100))
        
        // === 修复常见的 JSON 格式问题 ===
        
        // 1. 处理未加引号的属性名（如: name: "xxx" -> "name": "xxx"）
        // 使用状态机确保只在对象内部、字符串外部添加引号
        let processedResult = ''
        let inString = false
        let escapeNext = false
        let inObject = false
        let afterColonOrComma = true
        
        for (let i = 0; i < jsonStr.length; i++) {
          const char = jsonStr[i]
          
          if (escapeNext) {
            processedResult += char
            escapeNext = false
            continue
          }
          
          if (char === '\\') {
            processedResult += char
            escapeNext = true
            continue
          }
          
          if (char === '"') {
            inString = !inString
            processedResult += char
            continue
          }
          
          if (inString) {
            processedResult += char
            continue
          }
          
          // 在字符串外部
          if (char === '{') {
            inObject = true
            afterColonOrComma = true
            processedResult += char
            continue
          }
          
          if (char === '}') {
            inObject = false
            afterColonOrComma = false
            processedResult += char
            continue
          }
          
          if (char === ':') {
            afterColonOrComma = false
            processedResult += char
            continue
          }
          
          if (char === ',') {
            afterColonOrComma = true
            processedResult += char
            continue
          }
          
          // 跳过空白
          if (/\s/.test(char)) {
            processedResult += char
            continue
          }
          
          // 在对象内部、冒号/逗号之后，可能是属性名
          if (inObject && afterColonOrComma) {
            const match = jsonStr.substring(i).match(/^([a-zA-Z_\u4e00-\u9fa5][a-zA-Z0-9_\u4e00-\u9fa5]*)(?=\s*:)/)
            if (match) {
              processedResult += '"' + match[1] + '"'
              i += match[1].length - 1
              afterColonOrComma = false
              continue
            }
          }
          
          processedResult += char
        }
        jsonStr = processedResult
        
        // 2. 处理多余的逗号
        jsonStr = jsonStr.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}')
        
        // 3. 处理单引号属性名
        jsonStr = jsonStr.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
        
        // 4. 确保字符串正确闭合
        let openQuotes = 0
        for (const char of jsonStr) {
          if (char === '"') openQuotes++
        }
        if (openQuotes % 2 !== 0) {
          jsonStr += '"'
        }
        
        console.log('[DEBUG] 最终处理后的 JSON:', jsonStr.substring(0, 150))
        
        // 解析 JSON，支持数组或包含数组的对象
        let parsedCards: Array<Record<string, unknown>> = []
        
        // 定义多个解析策略
        const parseStrategies = [
          // 策略1：直接解析
          () => {
            const parsed = JSON.parse(jsonStr)
            if (Array.isArray(parsed)) return parsed
            if (typeof parsed === 'object' && parsed !== null) {
              if (Array.isArray(parsed.characters)) return parsed.characters
              if (Array.isArray(parsed.data)) return parsed.data
            }
            throw new Error('不是数组格式')
          },
          // 策略2：尝试用正则提取所有对象
          () => {
            const objects: any[] = []
            const objRegex = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g
            let match
            while ((match = objRegex.exec(jsonStr)) !== null) {
              try {
                objects.push(JSON.parse(match[0]))
              } catch {
                // 跳过无法解析的对象
              }
            }
            if (objects.length > 0) return objects
            throw new Error('未找到有效对象')
          },
          // 策略3：尝试用正则提取所有数组
          () => {
            const arrRegex = /\[(?:[^\[\]]|(?:\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\]))*\]/g
            let match
            while ((match = arrRegex.exec(jsonStr)) !== null) {
              try {
                const parsed = JSON.parse(match[0])
                if (Array.isArray(parsed)) return parsed
              } catch {
                // 跳过无法解析的数组
              }
            }
            throw new Error('未找到有效数组')
          },
        ]
        
        // 依次尝试各个策略
        let lastError: Error | null = null
        for (let i = 0; i < parseStrategies.length; i++) {
          try {
            parsedCards = parseStrategies[i]()
            console.log(`[DEBUG] 使用策略 ${i + 1} 解析成功，共 ${parsedCards.length} 个角色`)
            break
          } catch (e) {
            lastError = e as Error
            console.log(`[DEBUG] 策略 ${i + 1} 失败:`, lastError.message)
          }
        }
        
        // 如果所有策略都失败
        if (parsedCards.length === 0) {
          // 输出更详细的错误信息和问题位置
          console.error('[DEBUG] 所有解析策略均失败')
          console.error('[DEBUG] 原始 JSON 字符串:', jsonStr)
          if (lastError) {
            const match = lastError.message.match(/position (\d+)/)
            if (match) {
              const pos = parseInt(match[1])
              const start = Math.max(0, pos - 50)
              const end = Math.min(jsonStr.length, pos + 100)
              console.error('[DEBUG] 错误位置:', pos)
              console.error('[DEBUG] 上下文:', jsonStr.substring(start, end))
            }
            throw new Error(`解析角色数据失败: ${lastError.message}`)
          }
          throw new Error('解析角色数据失败: 无法从AI返回中提取有效数据')
        }

        // 构建角色卡数据列表
        const validRoles = ['protagonist', 'antagonist', 'supporting', 'minor']
        const characterDataList: Array<Record<string, unknown>> = []
        for (const card of parsedCards) {
          if (!card || typeof card !== 'object' || !card.name) continue
          const role = validRoles.includes(card.role as string) ? card.role : 'supporting'
          characterDataList.push({ ...card, role, name: card.name })
        }

        // 检查是否提取到有效角色
        if (characterDataList.length === 0) {
          throw new Error('未能从角色图谱中提取到任何有效角色，请检查角色图谱内容或重新生成')
        }

        console.log('[DEBUG] 角色卡提取 - 准备写入数据库:', characterDataList.length, '个角色')
        const saveResult = await ipc.invoke('db:character-save-all', characterDataList as unknown as CharacterData[])
        console.log('[DEBUG] 角色卡写入结果:', saveResult)
        cb.log(`✅ 角色卡提取完毕（共 ${characterDataList.length} 个角色）`)
      },
    },
  ]
}

/** 创建配置生成工作流 */
export function createConfigGenerationWorkflow(params: ConfigGenerationWorkflowParams): WorkflowDefinition {
  return {
    type: 'config_generation',
    title: '✨ AI 智能配置生成',
    steps: [
      {
        name: '配置生成',
        description: '根据创作脑洞生成小说配置',
        executor: async (_step, _context, callbacks) => {
          const { GenerateConfigCommand } = await import('./commands/architecture.command')
          return new GenerateConfigCommand(
            params.idea,
            params.totalChapters,
            params.wordsPerChapter,
            params.onGenerated
          ).execute({ step: {} as WorkflowStep, context: { data: {}, cancelled: false }, callbacks })
        },
      },
    ],
  }
}

export async function runArchCharacterExtract(projectPath: string, characterDynamicsContent: string, genre: string): Promise<void> {
  const steps = createCharacterExtractSteps(projectPath, characterDynamicsContent, genre)
  const { useWorkflowStore } = await import('../../stores/workflow-store')
  await useWorkflowStore.getState().startWorkflow({
    type: 'post_process',
    title: '📋 后处理：角色卡提取',
    steps: [
      {
        name: '提取角色卡片',
        description: '从角色图谱中提取并生成角色卡片数据',
        executor: async (_step, _ctx, callbacks) => {
          const { globalEventBus } = await import('../../shared/event-bus')
          const archStatus = await runPostProcessPipeline(projectPath, ARCH_CHARACTER_SCOPE, '架构-角色图谱', steps, callbacks, { onlyFailed: false })
          if (archStatus.allCriticalPassed) {
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          } else {
            globalEventBus.emit('CHARACTER_EXTRACT_FAILED', { error: archStatus.steps.extract_character_cards?.error })
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          }
        },
      },
    ],
  })
}