import { create } from 'zustand'
import { randomUUID } from '../utils/id'

// ===== 持久化工具 =====

const STORAGE_KEY = 'vela-workflow-history'

function loadHistory(): WorkflowRun[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveHistory(history: WorkflowRun[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // 忽略存储错误
  }
}

// ===== 工作流数据模型 =====

/** 工作流步骤状态 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 工作流运行状态 */
export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed' | 'paused' | 'waiting'

/** 工作流步骤 */
export interface WorkflowStep {
  id: string
  name: string
  description: string
  status: StepStatus
  progress?: number
  result?: string
  error?: string
  startedAt?: string
  completedAt?: string
  logs: string[]
}

/** 工作流运行实例 */
export interface WorkflowRun {
  id: string
  type: WorkflowType
  title: string
  status: WorkflowStatus
  steps: WorkflowStep[]
  currentStepIndex: number
  createdAt: string
  completedAt?: string
  /** 保存工作流定义引用，用于断点恢复时重新执行 */
  definitionRef?: WorkflowDefinition
  /** 保存上下文数据（如断点进度），用于断点恢复 */
  contextData?: Record<string, unknown>
}

/** 工作流类型 */
export type WorkflowType =
  | 'new_project_setup'       // 新项目初始化（配置→架构→目录）
  | 'architecture_generation' // 架构生成（故事前提→角色图谱→世界观→情节大纲）
  | 'directory'               // 目录/蓝图生成
  | 'chapter_creation'        // 章节创作（写稿→修稿→审稿→定稿）
  | 'auto_write'              // 自动编写（写稿→审稿→修稿→定稿全流程）
  | 'batch_generate'          // 批量生成
  | 'config_generation'       // 智能配置生成
  | 'post_process'            // 后处理任务（角色卡提取等）
  | 'novel_import'            // 导入已有小说（逆向推演全流程）

/** 工作流步骤执行器 */
export type StepExecutor = (
  step: WorkflowStep,
  context: WorkflowContext,
  callbacks: StepCallbacks,
) => Promise<string | void>

/** 工作流上下文（共享数据） */
export interface WorkflowContext {
  /** 步骤间传递的数据 */
  data: Record<string, unknown>
  /** 是否已取消 */
  cancelled: boolean
}

/** 步骤回调 */
export interface StepCallbacks {
  /** 追加日志 */
  log: (message: string) => void
  /** 更新进度 (0-100) */
  setProgress: (progress: number) => void
  /** 流式文本追加 */
  appendText: (text: string) => void
}

// ===== 工作流定义 =====

/** 工作流完成后的通知/跳转动作 */
export interface WorkflowCompleteAction {
  /** 通知策略：open=直接打开 | silent=仅内部状态不额外动作 */
  mode: 'open' | 'silent'
  /** 成功时的提示文案（备用，供日志用） */
  message?: string
  /** 打开结果的回调（open 模式直接调用） */
  openResult?: () => void | Promise<void>
}

export interface WorkflowDefinition {
  type: WorkflowType
  title: string
  steps: Array<{
    name: string
    description: string
    executor: StepExecutor
  }>
  /** 工作流完成后的通知/跳转动作（可选） */
  onComplete?: WorkflowCompleteAction
}

// ===== Store =====

interface WorkflowState {
  /** 所有活跃的工作流（支持多任务并发） */
  activeRuns: WorkflowRun[]
  /** 历史工作流记录 */
  history: WorkflowRun[]
  /** 全局日志（下方面板用） */
  globalLogs: Array<{ time: string; level: 'info' | 'warn' | 'error'; message: string }>

  /** 兼容属性：第一个活跃工作流（供旧代码平稳过渡） */
  currentRun: WorkflowRun | null

  /** 步进模式：各工作流的等待状态 */
  waitingRuns: Record<string, { waitingForConfirm: boolean; waitingAfterStepIndex: number }>

  // ===== 旧接口兼容（映射到第一个 activeRun） =====
  waitingForConfirm: boolean
  waitingAfterStepIndex: number

  // ===== 便捷查询 =====
  /** 检查指定类型的工作流是否有在运行 */
  isTypeRunning: (type: WorkflowType) => boolean
  /** 是否有任何工作流在运行 */
  hasActiveRun: () => boolean
  /** 活跃任务数量 */
  activeCount: () => number
  /** 获取当前正在流式输出的活跃工作流（供 AI 输出面板消费） */
  getActiveStreamingRun: () => WorkflowRun | null
  /** 获取当前最活跃任务的步骤信息（供 StatusBar 胶囊显示） */
  getActiveStepInfo: () => { title: string; stepName: string; progress: number; total: number; completed: number } | null

  // ===== Actions =====
  /** 启动一个工作流（可并发），返回 runId */
  startWorkflow: (definition: WorkflowDefinition, stepByStep?: boolean) => Promise<string>
  /** 步进模式下确认继续执行下一步（需指定 runId） */
  confirmContinue: (runId?: string) => void
  /** 取消工作流（传 runId 取消指定，不传取消全部） */
  cancelWorkflow: (runId?: string) => void
  /** 从历史中移除指定工作流 */
  removeFromHistory: (runId: string) => void
  /** 从失败的工作流继续执行 */
  resumeWorkflow: (runId: string, additionalParams?: Record<string, unknown>) => Promise<void>
  /** 添加全局日志 */
  addLog: (level: 'info' | 'warn' | 'error', message: string) => void
  /** 清空日志 */
  clearLogs: () => void
}

/** 工作流上下文实例 Map（runId → context） */
const activeContexts = new Map<string, WorkflowContext>()
/** 步进模式：存储「等待用户确认」的 Promise resolve（runId → resolve） */
const continueResolveRefs = new Map<string, () => void>()

/** 计算兼容字段的辅助函数 */
function computeCompat(activeRuns: WorkflowRun[], waitingRuns: Record<string, { waitingForConfirm: boolean; waitingAfterStepIndex: number }>) {
  const currentRun = activeRuns.length > 0 ? activeRuns[0] : null
  const firstRunId = currentRun?.id ?? ''
  const firstWaiting = waitingRuns[firstRunId]
  return {
    currentRun,
    waitingForConfirm: firstWaiting?.waitingForConfirm ?? false,
    waitingAfterStepIndex: firstWaiting?.waitingAfterStepIndex ?? -1,
  }
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  activeRuns: [],
  history: loadHistory(), // 初始化时加载历史
  globalLogs: [],
  waitingRuns: {},

  // 兼容属性初始值
  currentRun: null,
  waitingForConfirm: false,
  waitingAfterStepIndex: -1,

  // ===== 便捷查询 =====
  isTypeRunning: (type) => get().activeRuns.some(r => r.type === type && (r.status === 'running' || r.status === 'waiting')),
  hasActiveRun: () => get().activeRuns.length > 0,
  activeCount: () => get().activeRuns.length,

  getActiveStreamingRun: () => {
    const runs = get().activeRuns
    // 优先返回正在 running 的任务；其次 waiting 的
    return runs.find(r => r.status === 'running') || runs.find(r => r.status === 'waiting') || null
  },

  getActiveStepInfo: () => {
    const run = get().activeRuns.find(r => r.status === 'running' || r.status === 'waiting')
    if (!run) return null
    const step = run.steps[run.currentStepIndex] || run.steps[0]
    const completed = run.steps.filter(s => s.status === 'completed').length
    return {
      title: run.title,
      stepName: step?.name || '',
      progress: step?.progress || 0,
      total: run.steps.length,
      completed,
    }
  },

  confirmContinue: (runId) => {
    // 如果未指定 runId，使用第一个等待中的
    const targetId = runId ?? Object.keys(get().waitingRuns).find(id => get().waitingRuns[id]?.waitingForConfirm)
    if (!targetId) return
    const resolve = continueResolveRefs.get(targetId)
    if (resolve) {
      resolve()
      continueResolveRefs.delete(targetId)
    }
    set(s => {
      const newWaiting = { ...s.waitingRuns }
      delete newWaiting[targetId]
      const compat = computeCompat(s.activeRuns, newWaiting)
      return { waitingRuns: newWaiting, ...compat }
    })
  },

  /**
   * 从失败的工作流继续执行
   * @param runId 失败的工作流 ID
   * @param additionalParams 额外参数（如断点续审的进度信息）
   */
  resumeWorkflow: async (runId: string, additionalParams?: Record<string, unknown>) => {
    const history = get().history
    const failedRun = history.find((r) => r.id === runId)
    if (!failedRun || failedRun.status !== 'failed') {
      get().addLog('warn', `⚠️ 未找到可继续的失败工作流: ${runId}`)
      return
    }

    // 获取失败步骤的索引
    const failedStepIndex = failedRun.steps.findIndex((s) => s.status === 'failed')
    const startStepIndex = failedStepIndex >= 0 ? failedStepIndex : 0

    // 检查是否有保存的 definition 引用
    const definition = failedRun.definitionRef
    if (!definition) {
      get().addLog('warn', `⚠️ 工作流「${failedRun.title}」无法继续：缺少定义引用`)
      return
    }

    // 创建新的工作流运行实例，复制已完成的步骤状态
    const run: WorkflowRun = {
      id: randomUUID(),
      type: failedRun.type,
      title: `🔄 ${failedRun.title}`,
      status: 'running',
      currentStepIndex: startStepIndex,
      createdAt: new Date().toISOString(),
      steps: failedRun.steps.map((s, i) => {
        if (i < startStepIndex) {
          // 已完成的步骤保持状态
          return { ...s }
        }
        return {
          id: randomUUID(),
          name: s.name,
          description: s.description,
          status: i === startStepIndex ? 'running' : 'pending',
          logs: [],
        }
      }),
      definitionRef: definition,
    }

    // 添加到活跃列表，并从历史中移除旧的工作流
    set((s) => {
      const newRuns = [...s.activeRuns, run]
      const newHistory = s.history.filter(r => r.id !== runId)
      saveHistory(newHistory)
      return { activeRuns: newRuns, history: newHistory, ...computeCompat(newRuns, s.waitingRuns) }
    })
    get().addLog('info', `🔄 继续工作流「${failedRun.title}」，从第 ${startStepIndex + 1} 步开始`)

    // 自动联动：打开右侧面板的 AI 输出视图
    import('./layout-store').then((m) => m.useLayoutStore.getState().openRightPanel('ai-output')).catch(() => {})

    // 创建执行上下文，合并失败工作流的 contextData 和额外参数
    const context: WorkflowContext = { 
      data: { ...failedRun.contextData, ...additionalParams }, 
      cancelled: false 
    }
    activeContexts.set(run.id, context)

    // 从失败步骤开始执行（使用保存的 definition）
    for (let i = startStepIndex; i < definition.steps.length; i++) {
      if (context.cancelled) break

      const stepDef = definition.steps[i]
      updateStepById(set, run.id, i, { status: 'running', startedAt: new Date().toISOString(), progress: 0 })
      get().addLog('info', `▶ [${run.title}] 执行步骤: ${stepDef.name}`)

      // 创建步骤回调
      const callbacks: StepCallbacks = {
        log: (message) => {
          appendStepLogById(set, run.id, i, message)
          get().addLog('info', `  ${message}`)
        },
        setProgress: (progress) => {
          updateStepById(set, run.id, i, { progress })
        },
        appendText: (text) => {
          const activeRun = get().activeRuns.find(r => r.id === run.id)
          if (activeRun) {
            const step = activeRun.steps[i]
            updateStepById(set, run.id, i, { result: (step.result || '') + text })
          }
        },
      }

      try {
        const result = await stepDef.executor(run.steps[i], context, callbacks)
        updateStepById(set, run.id, i, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          progress: 100,
          result: result || get().activeRuns.find(r => r.id === run.id)?.steps[i].result,
        })
        get().addLog('info', `✅ [${run.title}] 步骤完成: ${stepDef.name}`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        updateStepById(set, run.id, i, {
          status: 'failed',
          error: errorMsg,
          completedAt: new Date().toISOString(),
        })
        updateRunById(set, run.id, { status: 'failed' })
        get().addLog('error', `❌ [${run.title}] 步骤失败: ${stepDef.name} — ${errorMsg}`)
        break
      }
    }

    // 检查是否全部完成
    const finalRun = get().activeRuns.find((r) => r.id === run.id)
    if (finalRun && finalRun.status === 'running') {
      updateRunById(set, run.id, { status: 'completed', completedAt: new Date().toISOString() })
      get().addLog('info', `🎉 工作流「${run.title}」已完成`)

      // 通过 EventBus 广播工作流完成事件
      import('../shared/event-bus').then((m) => {
        m.globalEventBus.emit('WORKFLOW_COMPLETE', { type: run.type })
      }).catch(() => {})
    }

    // 从活跃列表移除，存入历史（保存 context data 以便断点恢复）
    const ctxData = activeContexts.get(run.id)?.data
    set((s) => {
      const completedRun = s.activeRuns.find((r) => r.id === run.id)
      const newRuns = s.activeRuns.filter((r) => r.id !== run.id)
      const newWaiting = { ...s.waitingRuns }
      delete newWaiting[run.id]
      const newHistory = completedRun
        ? [{ ...completedRun, contextData: ctxData }, ...s.history].slice(0, 50)
        : s.history
      // 保存历史到 localStorage
      saveHistory(newHistory)
      return {
        activeRuns: newRuns,
        history: newHistory,
        waitingRuns: newWaiting,
        ...computeCompat(newRuns, newWaiting),
      }
    })

    // 清理上下文
    activeContexts.delete(run.id)
  },

  startWorkflow: async (definition, stepByStep = false) => {
    const run: WorkflowRun = {
      id: randomUUID(),
      type: definition.type,
      title: definition.title,
      status: 'running',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      steps: definition.steps.map((s) => ({
        id: randomUUID(),
        name: s.name,
        description: s.description,
        status: 'pending',
        logs: [],
      })),
      definitionRef: definition,
    }

    // 添加到活跃列表
    set(s => {
      const newRuns = [...s.activeRuns, run]
      return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
    })
    get().addLog('info', `🚀 工作流「${definition.title}」已启动`)

    // 自动联动：打开右侧面板的 AI 输出视图（非阻塞 import 避免循环依赖）
    import('./layout-store').then(m => m.useLayoutStore.getState().openRightPanel('ai-output')).catch(() => {})

    // 创建执行上下文
    const context: WorkflowContext = { data: {}, cancelled: false }
    activeContexts.set(run.id, context)

    // 逐步执行
    for (let i = 0; i < definition.steps.length; i++) {
      // 检查取消
      if (context.cancelled) {
        updateRunById(set, run.id, { status: 'failed' })
        get().addLog('warn', `⏹ 工作流「${definition.title}」已取消`)
        break
      }

      const stepDef = definition.steps[i]

      // 标记当前步骤为运行中
      updateStepById(set, run.id, i, { status: 'running', startedAt: new Date().toISOString() })
      updateRunById(set, run.id, { currentStepIndex: i })
      get().addLog('info', `▶ [${definition.title}] 执行步骤: ${stepDef.name}`)

      // 创建步骤回调
      const callbacks: StepCallbacks = {
        log: (message) => {
          appendStepLogById(set, run.id, i, message)
          get().addLog('info', `  ${message}`)
        },
        setProgress: (progress) => {
          updateStepById(set, run.id, i, { progress })
        },
        appendText: (text) => {
          const activeRun = get().activeRuns.find(r => r.id === run.id)
          if (activeRun) {
            const step = activeRun.steps[i]
            updateStepById(set, run.id, i, { result: (step.result || '') + text })
          }
        },
      }

      try {
        const result = await stepDef.executor(run.steps[i], context, callbacks)
        updateStepById(set, run.id, i, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          progress: 100,
          result: result || get().activeRuns.find(r => r.id === run.id)?.steps[i].result,
        })
        get().addLog('info', `✅ [${definition.title}] 步骤完成: ${stepDef.name}`)

        // 步进模式：非最后一步，且未取消 → 暂停等待用户确认
        if (stepByStep && i < definition.steps.length - 1 && !context.cancelled) {
          updateRunById(set, run.id, { status: 'waiting' })
          set(s => {
            const newWaiting = { ...s.waitingRuns, [run.id]: { waitingForConfirm: true, waitingAfterStepIndex: i } }
            return { waitingRuns: newWaiting, ...computeCompat(s.activeRuns, newWaiting) }
          })
          get().addLog('info', `⏸ [${definition.title}] 等待确认继续第 ${i + 2} 步：${definition.steps[i + 1].name}`)
          await new Promise<void>((resolve) => { continueResolveRefs.set(run.id, resolve) })
          if (context.cancelled) break
          updateRunById(set, run.id, { status: 'running' })
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        updateStepById(set, run.id, i, {
          status: 'failed',
          error: errorMsg,
          completedAt: new Date().toISOString(),
        })
        updateRunById(set, run.id, { status: 'failed' })
        get().addLog('error', `❌ [${definition.title}] 步骤失败: ${stepDef.name} — ${errorMsg}`)
        break
      }
    }

    // 检查是否全部完成
    const finalRun = get().activeRuns.find(r => r.id === run.id)
    if (finalRun && finalRun.status === 'running') {
      updateRunById(set, run.id, { status: 'completed', completedAt: new Date().toISOString() })
      get().addLog('info', `🎉 工作流「${definition.title}」已完成`)

      // 通过 EventBus 广播工作流完成事件（替代 window.dispatchEvent）
      import('../shared/event-bus').then(m => {
        m.globalEventBus.emit('WORKFLOW_COMPLETE', { type: definition.type })
      }).catch(() => {})

      // ===== 执行 onComplete 通知/跳转 =====
      if (definition.onComplete) {
        const { mode, openResult } = definition.onComplete
        try {
          if (mode === 'open' && openResult) {
            // 直接打开结果
            await openResult()
          }
          // silent 模式不做额外操作
        } catch (e) {
          get().addLog('warn', `⚠️ onComplete 执行失败: ${e}`)
        }
      }
    }

    // 从活跃列表移除，存入历史（保存 context data 以便断点恢复）
    const ctxData = activeContexts.get(run.id)?.data
    set(s => {
      const completedRun = s.activeRuns.find(r => r.id === run.id)
      const newRuns = s.activeRuns.filter(r => r.id !== run.id)
      const newWaiting = { ...s.waitingRuns }
      delete newWaiting[run.id]
      const newHistory = completedRun
        ? [{ ...completedRun, contextData: ctxData }, ...s.history].slice(0, 50)
        : s.history
      return {
        activeRuns: newRuns,
        history: newHistory,
        waitingRuns: newWaiting,
        ...computeCompat(newRuns, newWaiting),
      }
    })

    // 清理上下文
    activeContexts.delete(run.id)
    continueResolveRefs.delete(run.id)

    return run.id
  },

  cancelWorkflow: (runId) => {
    if (runId) {
      // 取消指定工作流
      const ctx = activeContexts.get(runId)
      if (ctx) ctx.cancelled = true
      // 如果在步进等待，解除 Promise
      const resolve = continueResolveRefs.get(runId)
      if (resolve) { resolve(); continueResolveRefs.delete(runId) }
      // 移入历史（保存 context data 以便断点恢复）
      const ctxData = activeContexts.get(runId)?.data
      set(s => {
        const targetRun = s.activeRuns.find(r => r.id === runId)
        const newRuns = s.activeRuns.filter(r => r.id !== runId)
        const newWaiting = { ...s.waitingRuns }
        delete newWaiting[runId]
        const newHistory = targetRun
          ? [{ ...targetRun, status: 'failed' as const, completedAt: new Date().toISOString(), contextData: ctxData }, ...s.history].slice(0, 50)
          : s.history
        // 保存历史到 localStorage
        saveHistory(newHistory)
        return {
          activeRuns: newRuns,
          history: newHistory,
          waitingRuns: newWaiting,
          ...computeCompat(newRuns, newWaiting),
        }
      })
      get().addLog('warn', '⏹ 工作流已取消')
    } else {
      // 取消全部
      for (const [id, ctx] of activeContexts) {
        ctx.cancelled = true
        const resolve = continueResolveRefs.get(id)
        if (resolve) { resolve(); continueResolveRefs.delete(id) }
      }
      // 取消全部（保存 context data 以便断点恢复）
      set(s => {
        const cancelledRuns = s.activeRuns.map(r => {
          const ctxData = activeContexts.get(r.id)?.data
          return { ...r, status: 'failed' as const, completedAt: new Date().toISOString(), contextData: ctxData }
        })
        const newHistory = [...cancelledRuns, ...s.history].slice(0, 50)
        // 保存历史到 localStorage
        saveHistory(newHistory)
        return {
          activeRuns: [],
          waitingRuns: {},
          history: newHistory,
          currentRun: null,
          waitingForConfirm: false,
          waitingAfterStepIndex: -1,
        }
      })
      get().addLog('warn', '⏹ 所有工作流已取消')
    }
  },

  removeFromHistory: (runId) => {
    // 如果工作流还在运行，先取消它
    const ctx = activeContexts.get(runId)
    if (ctx) {
      ctx.cancelled = true
    }
    // 如果在步进等待，解除 Promise
    const resolve = continueResolveRefs.get(runId)
    if (resolve) {
      resolve()
      continueResolveRefs.delete(runId)
    }
    set((s) => {
      const newHistory = s.history.filter(r => r.id !== runId)
      // 如果在活跃列表中也要移除
      const newRuns = s.activeRuns.filter(r => r.id !== runId)
      const newWaiting = { ...s.waitingRuns }
      delete newWaiting[runId]
      saveHistory(newHistory)
      return { 
        history: newHistory,
        activeRuns: newRuns,
        waitingRuns: newWaiting,
        ...computeCompat(newRuns, newWaiting),
      }
    })
    get().addLog('warn', '⏹ 已取消工作流')
  },

  addLog: (level, message) => {
      const entry = { time: new Date().toLocaleTimeString('zh-CN'), level, message }
      set((s) => ({
        globalLogs: [...s.globalLogs, entry].slice(-500), // 保留最近 500 条
      }))
    },

    clearLogs: () => set({ globalLogs: [] }),
  }))

// ===== 工具函数（按 runId 操作） =====

/** 更新指定工作流的运行状态 */
function updateRunById(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  runId: string,
  updates: Partial<WorkflowRun>
) {
  set((s) => {
    const newRuns = s.activeRuns.map(r =>
      r.id === runId ? { ...r, ...updates } : r
    )
    return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
  })
}

/** 更新指定工作流的指定步骤 */
function updateStepById(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  runId: string,
  stepIndex: number,
  updates: Partial<WorkflowStep>
) {
  set((s) => {
    const newRuns = s.activeRuns.map(r => {
      if (r.id !== runId) return r
      const steps = [...r.steps]
      steps[stepIndex] = { ...steps[stepIndex], ...updates }
      return { ...r, steps }
    })
    return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
  })
}

/** 追加指定工作流的指定步骤日志 */
function appendStepLogById(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  runId: string,
  stepIndex: number,
  message: string
) {
  set((s) => {
    const newRuns = s.activeRuns.map(r => {
      if (r.id !== runId) return r
      const steps = [...r.steps]
      steps[stepIndex] = {
        ...steps[stepIndex],
        logs: [...steps[stepIndex].logs, `[${new Date().toLocaleTimeString('zh-CN')}] ${message}`],
      }
      return { ...r, steps }
    })
    return { activeRuns: newRuns, ...computeCompat(newRuns, s.waitingRuns) }
  })
}
