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
        const jsonStr = cleanedCards.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        console.log('[DEBUG] JSON 字符串:', jsonStr)
        
        // 解析 JSON，支持数组或包含数组的对象
        let parsedCards: Array<Record<string, unknown>> = []
        try {
          const parsed = JSON.parse(jsonStr)
          if (Array.isArray(parsed)) {
            parsedCards = parsed
          } else if (typeof parsed === 'object' && parsed !== null) {
            if (Array.isArray(parsed.characters)) {
              parsedCards = parsed.characters
            } else if (Array.isArray(parsed.data)) {
              parsedCards = parsed.data
            } else {
              throw new Error('AI 返回的数据格式不支持，期望数组或包含 characters/data 字段的对象')
            }
          } else {
            throw new Error('AI 返回的数据格式无效，期望数组')
          }
        } catch (e) {
          throw new Error(`解析角色数据失败: ${String(e)}`)
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
        const result = await ipc.invoke('db:character-save-all', characterDataList as unknown as CharacterData[])
        console.log('[DEBUG] 角色卡写入结果:', result)
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