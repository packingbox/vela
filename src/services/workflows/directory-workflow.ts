import type { WorkflowDefinition } from '../../stores/workflow-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { stripThinkingTags } from './workflow-utils'

// ==========================================
// 1. 结构与类型导出
// ==========================================

export type ChapterBlueprint = BlueprintData

export interface ParseBlueprintsResult {
  success: boolean
  blueprints: ChapterBlueprint[]
  error?: {
    message: string
    rawContent: string
    problemArea?: string
  }
  partialSuccess?: boolean
}

const EMPTY_BLUEPRINT: ChapterBlueprint = {
  chapterNumber: 0,
  title: '',
  role: '发展',
  purpose: '',
  keyEvents: '',
  characters: [],
  suspenseHook: '',
  userGuidance: '',
  notes: '',
  notesUpdatedAt: '',
}

export interface DirectoryWorkflowParams {
  mode: 'full' | 'append' | 'fill'
  startChapter?: number
  count?: number
  pacingGuidance?: string
}

// ==========================================
// 2. JSON 修复工具函数
// ==========================================

interface RepairResult {
  success: boolean
  repairedJson?: string
  error?: string
  repairedCount: number
}

function repairJSON(jsonStr: string): RepairResult {
  let repairedCount = 0
  let fixedJson = jsonStr

  try {
    JSON.parse(fixedJson)
    return { success: true, repairedJson: fixedJson, repairedCount: 0 }
  } catch {
    // 继续修复
  }

  // 修复1: 开头缺少引号的问题（如 "{ blueprints": [...]" -> "{\"blueprints\": [...]}"）
  const originalLength = fixedJson.length
  fixedJson = fixedJson.replace(/^\{\s*(\w+)\s*:/, '{"$1":')
  if (fixedJson.length !== originalLength) repairedCount++

  // 修复2: 单引号替换为双引号
  fixedJson = fixedJson.replace(/'([^']+)'/g, '"$1"')

  // 修复3: 未加引号的属性名
  const beforeFix = fixedJson
  fixedJson = fixedJson.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
  if (fixedJson !== beforeFix) repairedCount++

  // 修复4: 多余逗号
  fixedJson = fixedJson.replace(/,(\s*[}\]])/g, '$1')

  // 修复5: 中文冒号
  fixedJson = fixedJson.replace(/："/g, ':"')

  // 修复6: 处理属性名被截断的情况（如 "p": 应该是 "purpose":）
  const truncatedProps: Record<string, string> = {
    'p': 'purpose',
    't': 'title',
    'c': 'characters',
    'ch': 'chapter',
    'cn': 'chapterNumber',
    'k': 'keyEvents',
    'ke': 'keyEvents',
    's': 'suspenseHook',
    'su': 'suspenseHook',
    'r': 'role',
    'pr': 'purpose',
    'char': 'characters',
    'print': 'blueprints',
    'prints': 'blueprints',
    'blueprint': 'blueprints',
  }
  for (const [short, full] of Object.entries(truncatedProps)) {
    const regex = new RegExp(`"${short}"\\s*:`, 'g')
    const replaced = fixedJson.replace(regex, `"${full}":`)
    if (replaced !== fixedJson) {
      repairedCount++
      fixedJson = replaced
    }
  }

  // 修复7: 修复未闭合的字符串
  const lastQuote = fixedJson.lastIndexOf('"')
  const lastBrace = fixedJson.lastIndexOf('}')
  const lastBracket = fixedJson.lastIndexOf(']')
  const maxEnd = Math.max(lastBrace, lastBracket)
  if (lastQuote > maxEnd && maxEnd > 0) {
    fixedJson = fixedJson.substring(0, lastQuote + 1)
    if (!fixedJson.trim().endsWith('"}') && !fixedJson.trim().endsWith('"]')) {
      fixedJson = fixedJson + '"'
    }
  }

  // 修复8: 修复缺少开头引号的属性（如 characters": [...] -> "characters": [...]）
  fixedJson = fixedJson.replace(/([{,]\s*)([a-zA-Z_]\w+)"\s*:/g, '$1"$2":')

  // 修复9: 修复缺失属性名的情况（如 "": "value" -> "title": "value"）
  // 当我们看到空属性名时，根据上下文猜测可能的属性名
  const lines = fixedJson.split('\n')
  let expectedField = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('"chapterNumber"')) {
      expectedField = 'title'
    } else if (line.includes('"title"')) {
      expectedField = 'purpose'
    } else if (line.includes('"purpose"')) {
      expectedField = 'characters'
    } else if (line.includes('"characters"')) {
      expectedField = 'keyEvents'
    } else if (line.includes('"keyEvents"')) {
      expectedField = 'suspenseHook'
    } else if (line.includes('"suspenseHook"')) {
      expectedField = 'role'
    }
    
    // 修复空属性名
    if (line.includes(`"":`) && expectedField) {
      lines[i] = line.replace(/"":/, `"${expectedField}":`)
    }
  }
  fixedJson = lines.join('\n')

  try {
    JSON.parse(fixedJson)
    return { success: true, repairedJson: fixedJson, repairedCount }
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      repairedCount
    }
  }
}

function truncateAndExtract(content: string): { array: unknown[] | null, problemArea: string } {
  const firstBracket = content.indexOf('[')
  const lastBracket = content.lastIndexOf(']')

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return { array: null, problemArea: '未找到 JSON 数组边界 [ ... ]' }
  }

  const arrayStr = content.substring(firstBracket, lastBracket + 1)

  let fixedArray = arrayStr
  fixedArray = fixedArray.replace(/'([^']+)'/g, '"$1"')
  fixedArray = fixedArray.replace(/,(\s*[}\]])/g, '$1')

  try {
    const parsed = JSON.parse(fixedArray)
    if (Array.isArray(parsed)) {
      return { array: parsed, problemArea: '' }
    }
  } catch {
    // 尝试逐个提取数组元素（改进版）
    const elements: unknown[] = []
    let depth = 0
    let currentElement = ''
    let inString = false
    let escaped = false
    let parsingError = false

    for (let i = 1; i < fixedArray.length - 1; i++) {
      const char = fixedArray[i]

      if (escaped) {
        currentElement += char
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        currentElement += char
        continue
      }

      if (char === '"') {
        inString = !inString
        currentElement += char
        continue
      }

      if (inString) {
        currentElement += char
        continue
      }

      if (char === '{') {
        depth++
        currentElement += char
      } else if (char === '}') {
        depth--
        currentElement += char
      } else if (char === '[') {
        depth++
        currentElement += char
      } else if (char === ']') {
        depth--
        currentElement += char
      } else if (char === ',') {
        // 遇到逗号且深度为0，表示当前元素结束
        if (depth === 0 && currentElement.trim()) {
          try {
            const element = JSON.parse(currentElement.trim())
            elements.push(element)
            parsingError = false
          } catch (e) {
            // 如果单个元素解析失败，尝试修复后再解析
            const fixedElement = fixSingleElement(currentElement.trim())
            try {
              const element = JSON.parse(fixedElement)
              elements.push(element)
              parsingError = false
            } catch {
              parsingError = true
              console.log(`[truncateAndExtract] 元素解析失败: ${currentElement.trim().substring(0, 50)}...`)
            }
          }
          currentElement = ''
          continue
        }
        currentElement += char
      } else {
        currentElement += char
      }
    }

    // 处理最后一个元素
    if (currentElement.trim()) {
      try {
        const element = JSON.parse(currentElement.trim())
        elements.push(element)
      } catch (e) {
        const fixedElement = fixSingleElement(currentElement.trim())
        try {
          const element = JSON.parse(fixedElement)
          elements.push(element)
        } catch {
          console.log(`[truncateAndExtract] 最后一个元素解析失败: ${currentElement.trim().substring(0, 50)}...`)
        }
      }
    }

    if (elements.length > 0) {
      return { 
        array: elements, 
        problemArea: parsingError ? '部分元素提取成功，但存在格式问题' : '' 
      }
    }
  }

  return { array: null, problemArea: `无法解析数组内容，JSON 格式严重损坏` }
}

// 尝试修复单个JSON对象元素
function fixSingleElement(elementStr: string): string {
  let fixed = elementStr
  
  // 修复空属性名
  const fieldOrder = ['chapterNumber', 'title', 'purpose', 'characters', 'keyEvents', 'suspenseHook', 'role']
  let expectedIdx = 0
  
  const lines = fixed.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 如果找到已知属性，更新期望的下一个属性
    for (let j = 0; j < fieldOrder.length; j++) {
      if (line.includes(`"${fieldOrder[j]}"`)) {
        expectedIdx = j + 1
        break
      }
    }
    // 修复空属性名
    if (line.includes('"":') && expectedIdx < fieldOrder.length) {
      lines[i] = line.replace(/"":/, `"${fieldOrder[expectedIdx]}":`)
      expectedIdx++
    }
  }
  fixed = lines.join('\n')
  
  // 修复缺少引号的属性名
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w+)\s*:/g, '$1"$2":')
  
  // 修复单引号
  fixed = fixed.replace(/'([^']+)'/g, '"$1"')
  
  // 修复多余逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1')
  
  return fixed
}

// ==========================================
// 3. 解析函数
// ==========================================

export function parseTextBlueprints(content: string, startNum: number, endNum: number): ChapterBlueprint[] {
  const result = parseAndValidateBlueprints(content, startNum, endNum)
  return result.blueprints
}

export function parseAndValidateBlueprints(content: string, startNum: number, endNum: number): ParseBlueprintsResult {
  console.log(`[parseAndValidateBlueprints] 开始解析，查找第 ${startNum}-${endNum} 章`)
  console.log(`[parseAndValidateBlueprints] 原始内容长度: ${content.length} 字符`)

  const cleanContent = stripThinkingTags(content)
  console.log(`[parseAndValidateBlueprints] 去除思考标签后长度: ${cleanContent.length} 字符`)

  let jsonStr = cleanContent.replace(/```json?\n?/gi, '').replace(/```\n?/g, '').trim()

  if (!jsonStr || jsonStr.length === 0) {
    return {
      success: false,
      blueprints: [],
      error: {
        message: 'LLM 返回内容为空',
        rawContent: content
      }
    }
  }

  console.log(`[parseAndValidateBlueprints] 内容预览: ${jsonStr.substring(0, 500)}...`)

  let parsed: unknown = null
  let parseStrategy = 'none'

  // 策略1: 直接解析
  try {
    parsed = JSON.parse(jsonStr)
    parseStrategy = 'direct'
    console.log('[parseAndValidateBlueprints] 策略1成功: 直接解析')
  } catch (e) {
    console.log(`[parseAndValidateBlueprints] 策略1失败: ${(e as Error).message}`)
  }

  // 策略2: 提取数组格式 [...]
  if (!parsed) {
    try {
      const { array, problemArea } = truncateAndExtract(jsonStr)
      if (array) {
        parsed = array
        parseStrategy = 'extract_array'
        console.log('[parseAndValidateBlueprints] 策略2成功: 截断提取数组')
      } else if (problemArea) {
        console.log(`[parseAndValidateBlueprints] 策略2失败: ${problemArea}`)
      }
    } catch (e) {
      console.log(`[parseAndValidateBlueprints] 策略2失败: ${(e as Error).message}`)
    }
  }

  // 策略3: 提取对象格式
  if (!parsed) {
    try {
      const firstBrace = jsonStr.indexOf('{')
      const lastBrace = jsonStr.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const objStr = jsonStr.substring(firstBrace, lastBrace + 1)
        parsed = JSON.parse(objStr)
        parseStrategy = 'extract_object'
        console.log('[parseAndValidateBlueprints] 策略3成功: 提取对象')
      }
    } catch (e) {
      console.log(`[parseAndValidateBlueprints] 策略3失败: ${(e as Error).message}`)
    }
  }

  // 策略4: 修复后解析
  if (!parsed) {
    const repairResult = repairJSON(jsonStr)
    if (repairResult.success && repairResult.repairedJson) {
      try {
        parsed = JSON.parse(repairResult.repairedJson)
        parseStrategy = `fixed_json(${repairResult.repairedCount}处修复)`
        console.log(`[parseAndValidateBlueprints] 策略4成功: 修复后解析，修复了${repairResult.repairedCount}处问题`)
      } catch (e) {
        console.log(`[parseAndValidateBlueprints] 策略4失败: 修复后仍无法解析 - ${(e as Error).message}`)
      }
    } else {
      console.log(`[parseAndValidateBlueprints] 策略4失败: ${repairResult.error}`)
    }
  }

  // 策略5: 最后尝试 - 查找并提取可能的 blueprints 数组
  if (!parsed) {
    try {
      const blueprintsMatch = jsonStr.match(/"blueprints"\s*:\s*\[([\s\S]*)\]/)
      if (blueprintsMatch) {
        const arrayContent = '[' + blueprintsMatch[1] + ']'
        const { array } = truncateAndExtract(arrayContent)
        if (array) {
          parsed = array
          parseStrategy = 'extract_blueprints_key'
          console.log('[parseAndValidateBlueprints] 策略5成功: 提取 blueprints 键值')
        }
      }
    } catch (e) {
      console.log(`[parseAndValidateBlueprints] 策略5失败: ${(e as Error).message}`)
    }
  }

  // 所有策略都失败
  if (!parsed) {
    const errorMsg = '无法解析 JSON 格式：所有解析策略均失败'
    console.error(`[parseAndValidateBlueprints] ${errorMsg}`)

    saveDebugLog(startNum, endNum, content, jsonStr, errorMsg)

    return {
      success: false,
      blueprints: [],
      error: {
        message: errorMsg,
        rawContent: content.substring(0, 2000)
      }
    }
  }

  console.log(`[parseAndValidateBlueprints] 使用策略: ${parseStrategy}`)

  // 提取 blueprints 数组
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    const keys = Object.keys(obj)
    console.log(`[parseAndValidateBlueprints] 解析为对象，属性: ${keys.join(', ')}`)

    if (obj.blueprints && Array.isArray(obj.blueprints)) {
      parsed = obj.blueprints
    } else if (obj.chapters && Array.isArray(obj.chapters)) {
      parsed = obj.chapters
    } else if (obj.data && Array.isArray(obj.data)) {
      parsed = obj.data
    } else if (obj.result && Array.isArray(obj.result)) {
      parsed = obj.result
    } else {
      for (const key of keys) {
        if (Array.isArray(obj[key])) {
          parsed = obj[key]
          console.log(`[parseAndValidateBlueprints] 找到数组属性: ${key}`)
          break
        }
      }
    }
  }

  // 验证解析结果是否为数组
  if (!Array.isArray(parsed)) {
    const errorMsg = `解析结果不是数组，而是: ${typeof parsed}`
    console.error(`[parseAndValidateBlueprints] ${errorMsg}`)

    return {
      success: false,
      blueprints: [],
      error: {
        message: errorMsg,
        rawContent: content.substring(0, 2000)
      }
    }
  }

  // 过滤并转换章节
  const rawArray = parsed as Record<string, unknown>[]
  console.log(`[parseAndValidateBlueprints] 原始数组长度: ${rawArray.length}`)

  const blueprints: ChapterBlueprint[] = []
  let validCount = 0
  let invalidCount = 0

  for (let i = 0; i < rawArray.length; i++) {
    const item = rawArray[i]
    const chapterNum = Number(
      item.chapterNumber ||
      item.chapter_number ||
      item.chapter ||
      item.number ||
      item['章节号'] ||
      0
    )

    if (chapterNum < startNum || chapterNum > endNum || chapterNum === 0) {
      invalidCount++
      if (chapterNum > 0) {
        console.log(`[parseAndValidateBlueprints] 跳过第 ${chapterNum} 章 (不在范围 ${startNum}-${endNum} 内)`)
      }
      continue
    }

    const title = String(
      item.title ||
      item.chapterTitle ||
      item.name ||
      item['标题'] ||
      `第${chapterNum}章`
    )

    blueprints.push({
      ...EMPTY_BLUEPRINT,
      chapterNumber: chapterNum,
      title: title,
      role: String(item.role || item.type || item.chapterRole || item['角色'] || '发展'),
      purpose: String(item.purpose || item.description || item.chapterPurpose || item['目的'] || item['本章目标'] || ''),
      keyEvents: String(item.keyEvents || item.key_events || item.events || item.chapterEvents || item['关键事件'] || item['主要情节'] || ''),
      characters: Array.isArray(item.characters) ? item.characters : Array.isArray(item['人物']) ? item['人物'] as string[] : [],
      suspenseHook: String(item.suspenseHook || item.suspense_hook || item.hook || item['悬念'] || item['钩子'] || ''),
      userGuidance: '',
    })
    validCount++
  }

  const distinctMap = new Map<number, ChapterBlueprint>()
  for (const bp of blueprints) {
    if (!distinctMap.has(bp.chapterNumber)) {
      distinctMap.set(bp.chapterNumber, bp)
    }
  }
  const finalResult = Array.from(distinctMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)

  console.log(`[parseAndValidateBlueprints] 最终结果: ${finalResult.length} 章 (有效: ${validCount}, 无效: ${invalidCount})`)

  if (finalResult.length === 0) {
    const errorMsg = `未能提取到有效章节。LLM 可能返回了错误的章节号或格式不正确的 JSON。\n期望章节范围: ${startNum}-${endNum}`
    console.error(`[parseAndValidateBlueprints] ${errorMsg}`)

    return {
      success: false,
      blueprints: [],
      partialSuccess: false,
      error: {
        message: errorMsg,
        rawContent: content.substring(0, 2000),
        problemArea: `提取了 0/${rawArray.length} 个有效章节`
      }
    }
  }

  if (finalResult.length < rawArray.length) {
    console.log(`[parseAndValidateBlueprints] 部分成功: ${finalResult.length}/${rawArray.length} 章`)
    return {
      success: true,
      blueprints: finalResult,
      partialSuccess: true,
      error: {
        message: `成功提取 ${finalResult.length} 章，但 LLM 返回的总共 ${rawArray.length} 个对象中有 ${rawArray.length - finalResult.length} 个不在目标范围内`,
        rawContent: content.substring(0, 500)
      }
    }
  }

  return {
    success: true,
    blueprints: finalResult
  }
}

function saveDebugLog(startNum: number, endNum: number, rawContent: string, cleanedContent: string, errorMsg: string): void {
  try {
    const fs = require('fs')
    const path = require('path')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const debugPath = path.join(process.cwd(), `debug_blueprint_${startNum}-${endNum}_${timestamp}.txt`)
    const debugContent = `=== 蓝图解析失败调试日志 ===
时间: ${new Date().toISOString()}
期望章节范围: ${startNum}-${endNum}

错误信息:
${errorMsg}

--- 原始内容 (前 3000 字符) ---
${rawContent.substring(0, 3000)}

--- 清洗后内容 (前 3000 字符) ---
${cleanedContent.substring(0, 3000)}

=== 结束 ===
`
    fs.writeFileSync(debugPath, debugContent, 'utf-8')
    console.log(`[parseAndValidateBlueprints] 调试日志已保存: ${debugPath}`)
  } catch (e) {
    console.error(`[parseAndValidateBlueprints] 保存调试日志失败: ${e}`)
  }
}

// ==========================================
// 4. 蓝图文件访问与工具函数
// ==========================================

export async function loadDirectoryBlueprints(): Promise<ChapterBlueprint[]> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.sort((a, b) => a.chapterNumber - b.chapterNumber)
  } catch {
    return []
  }
}

export async function saveChapterBlueprint(blueprint: ChapterBlueprint): Promise<void> {
  await ipc.invoke('db:blueprint-upsert', blueprint)
}

export async function saveAllBlueprints(blueprints: ChapterBlueprint[]): Promise<void> {
  await ipc.invoke('db:blueprint-upsert-many', blueprints)
}

export async function getBlueprintCount(): Promise<number> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.length
  } catch {
    return 0
  }
}

// ==========================================
// 5. 工作流定义映射工厂 (Command 调度层)
// ==========================================

export function createDirectoryWorkflow(params: DirectoryWorkflowParams = { mode: 'full' }): WorkflowDefinition {
  return {
    type: 'directory',
    title: params.mode === 'append' 
      ? `📋 续写章节蓝图${params.startChapter ? `（从第 ${params.startChapter} 章）` : ''}` 
      : params.mode === 'fill'
        ? '🔧 补全缺失章节蓝图'
        : '📋 生成章节蓝图（全量）',
    steps: [
      {
        name: '读取架构',
        description: `从 SQLite 加载项目架构信息`,
        executor: async (_step, context, callbacks) => {
          const project = useProjectStore.getState().currentProject
          if (!project) throw new Error('未打开项目')

          callbacks.log('读取项目架构信息...')
          const core = await ipc.invoke('db:project-core-get')
          if (!core) throw new Error('项目核心数据未初始化')

          const parts: string[] = []
          if (core.premise && core.premise.length > 50) parts.push(core.premise)
          if (core.charactersArch && core.charactersArch.length > 50) parts.push(core.charactersArch)
          if (core.worldbuilding && core.worldbuilding.length > 50) parts.push(core.worldbuilding)
          if (core.synopsis && core.synopsis.length > 50) parts.push(core.synopsis)

          if (parts.length === 0) throw new Error('项目主要架构均未生成')

          context.data.architecture = parts.join('\n\n---\n\n')
          if (params.pacingGuidance) context.data.pacingGuidance = params.pacingGuidance
          // append 和 fill 模式都需要加载已有蓝图
          if (params.mode === 'append' || params.mode === 'fill') {
            const existing = await loadDirectoryBlueprints()
            context.data.existingBlueprints = existing
            callbacks.log(`已加载 ${existing.length} 章已有蓝图`)
          }
          return `架构加载完成（${parts.length} 段）`
        },
      },
      {
        name: '生成蓝图',
        description: '基于架构文件生成全书章节蓝图',
        executor: async (_step, context, callbacks) => {
          const { GenerateDirectoryCommand } = await import('./commands/directory.command')
          const cmd = new GenerateDirectoryCommand(params)
          const blueprints = await cmd.execute({ step: _step, context, callbacks })
          return `已生成 ${blueprints.length} 章蓝图`
        },
      },
      {
        name: '保存蓝图',
        description: `将章节蓝图批量写入 SQLite 数据库`,
        executor: async (_step, context, callbacks) => {
          const project = useProjectStore.getState().currentProject
          if (!project) throw new Error('未打开项目')

          const newBlueprints = context.data.newBlueprints as ChapterBlueprint[]
          const existingBlueprints = context.data.existingBlueprints as ChapterBlueprint[]

          callbacks.log('保存蓝图到数据库...')

          let merged: ChapterBlueprint[]
          if (params.mode === 'full') {
            merged = newBlueprints
          } else {
            const existingMap = new Map(existingBlueprints.map(b => [b.chapterNumber, b]))
            for (const nb of newBlueprints) existingMap.set(nb.chapterNumber, nb)
            merged = Array.from(existingMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)
          }

          await saveAllBlueprints(merged)
          useProjectStore.getState().refreshFileTree()
          // 发出事件通知蓝图编辑器刷新
          const { globalEventBus } = await import('../../shared/event-bus')
          globalEventBus.emit('WORKFLOW_COMPLETE', { type: 'directory' })
          return '已保存蓝图'
        },
      },
    ],
    onComplete: {
      mode: 'silent',
      message: params.mode === 'append' ? '✅ 续写蓝图生成完成' : '✅ 全书章节蓝图已生成完成！',
    },
  }
}