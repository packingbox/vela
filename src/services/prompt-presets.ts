/**
 * Prompt 预设包
 *
 * 预定义的提示词模板方案，应用后自动覆盖项目级 Prompt 模板
 * 支持内置预设和用户自定义预设
 */
import { BUILTIN_PROMPTS, EDITABLE_PROMPT_KEYS } from './prompt-templates'

export interface PromptPreset {
  id: string
  name: string
  emoji: string
  description: string
  isBuiltIn: boolean
  overrides: Record<string, string>
}

const BUILTIN_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: 'default',
    name: '默认模板',
    emoji: '📝',
    description: 'Vela 内置默认提示词模板，适用于各类小说创作',
    isBuiltIn: true,
    overrides: {},
  },
  {
    id: 'male-hot-blood',
    name: '男频热血',
    emoji: '🔥',
    description: '专为男频爽文设计，强调打脸装逼、升级节奏、逆袭崛起的燃向模板',
    isBuiltIn: true,
    overrides: buildMaleHotBloodOverrides(),
  },
  {
    id: 'female-romance',
    name: '女频言情',
    emoji: '💕',
    description: '专为女频言情设计，强调情感细腻、暧昧甜蜜、双向奔赴的甜宠模板',
    isBuiltIn: true,
    overrides: buildFemaleRomanceOverrides(),
  },
  {
    id: 'ancient-xianxia',
    name: '古风仙侠',
    emoji: '⚔️',
    description: '专为仙侠小说设计，古韵悠长、修仙问道、仙凡羁绊',
    isBuiltIn: true,
    overrides: buildAncientXianxiaOverrides(),
  },
  {
    id: 'suspense-mystery',
    name: '悬疑推理',
    emoji: '🔍',
    description: '专为悬疑推理设计，层层反转、逻辑缜密、智商在线',
    isBuiltIn: true,
    overrides: buildSuspenseMysteryOverrides(),
  },
]

function buildMaleHotBloodOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {}

  const synopsis = BUILTIN_PROMPTS.find(p => p.key === 'synopsis')
  if (synopsis) {
    overrides['synopsis'] = synopsis.content.replace(
      /【写作风格指导】[\s\S]*?$/,
      `【写作风格指导】
- 节奏明快，每章至少一个爽点或反转
- 战斗场面要热血震撼，不吝笔墨描写
- 对话干脆利落，主角金句频出
- 每章结尾留悬念/钩子，引导翻页
- 修炼体系层次分明，实力对比清晰
- 装逼打脸情节要合理铺垫，爽感自然
- 适当使用"震惊体"烘托氛围，但不要过度
- 主角必须强出场，弱者姿态只是逆袭前的短暂铺垫`
    )
  }

  const firstChapter = BUILTIN_PROMPTS.find(p => p.key === 'first_chapter_draft')
  if (firstChapter) {
    overrides['first_chapter_draft'] = firstChapter.content.replace(
      /【文风要求（如有，请严格遵循）】[\s\S]*?$/,
      `【文风要求（如有，请严格遵循）】
- 男频爽文风格：节奏快、爽点多、信息密度高
- 开篇必须直接切入剧情，拒绝冗长铺垫
- 第一章就要让主角展露潜力或金手指，给读者"期待感"
- 适当使用打脸情节，但要铺垫自然，不要太突兀
- 对话要干脆有力，避免废话和无效对话`
    )
  }

  return overrides
}

function buildFemaleRomanceOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {}

  const synopsis = BUILTIN_PROMPTS.find(p => p.key === 'synopsis')
  if (synopsis) {
    overrides['synopsis'] = synopsis.content.replace(
      /【写作风格指导】[\s\S]*?$/,
      `【写作风格指导】
- 感情线为主线，事业线为辅
- 男女主互动要有化学反应，暧昧甜蜜
- 心理描写细腻丰富，内心独白有代入感
- 适度制造误会和虐心桥段，但要及时给糖
- 配角立体有趣，不纯粹工具人
- 情感递进自然，每一步心动都有铺垫
- 日常片段温馨有趣，生活气息浓厚
- 避免过于功利或冷血的男主设定`
    )
  }

  const firstChapter = BUILTIN_PROMPTS.find(p => p.key === 'first_chapter_draft')
  if (firstChapter) {
    overrides['first_chapter_draft'] = firstChapter.content.replace(
      /【文风要求（如有，请严格遵循）】[\s\S]*?$/,
      `【文风要求（如有，请严格遵循）】
- 女频甜宠风格：情感细腻、氛围温馨、代入感强
- 开篇可以稍作背景铺垫，但不要拖沓
- 第一章就要有令读者心动的互动或心动瞬间
- 注重环境氛围和心理描写，营造心动感
- 避免过度狗血或无趣的误会桥段`
    )
  }

  return overrides
}

function buildAncientXianxiaOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {}

  const synopsis = BUILTIN_PROMPTS.find(p => p.key === 'synopsis')
  if (synopsis) {
    overrides['synopsis'] = synopsis.content.replace(
      /【写作风格指导】[\s\S]*?$/,
      `【写作风格指导】
- 文风古朴典雅，适当使用文言句式
- 场景描写要有水墨画意境
- 修仙体系严谨，功法/丹药/法器要有逻辑
- 人物对话带有古风韵味但不晦涩
- 道心、因果、轮回等概念贯穿始终
- 战斗场面超凡脱俗，仙术华丽
- 师徒/同门/道侣关系要细腻真实
- 境界划分清晰，修炼进度有层次感`
    )
  }

  const firstChapter = BUILTIN_PROMPTS.find(p => p.key === 'first_chapter_draft')
  if (firstChapter) {
    overrides['first_chapter_draft'] = firstChapter.content.replace(
      /【文风要求（如有，请严格遵循）】[\s\S]*?$/,
      `【文风要求（如有，请严格遵循）】
- 古风仙侠风格：古韵悠长、意境深远、仙气飘飘
- 环境描写要有水墨山水画的意境感
- 修仙术语使用得当，不过度堆砌
- 战斗描写超凡脱俗，不落俗套
- 注重修道之心、因果缘分等精神层面的刻画`
    )
  }

  return overrides
}

function buildSuspenseMysteryOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {}

  const synopsis = BUILTIN_PROMPTS.find(p => p.key === 'synopsis')
  if (synopsis) {
    overrides['synopsis'] = synopsis.content.replace(
      /【写作风格指导】[\s\S]*?$/,
      `【写作风格指导】
- 每章制造至少一个悬念或线索
- 伏笔埋设要隐蔽自然，回收要令人恍然大悟
- 推理过程逻辑严密，不要出现逻辑硬伤
- 氛围描写注重营造紧张感和压迫感
- 真凶/真相不要太早暴露，层层剥茧
- 红鲱鱼（误导线索）适度使用
- 主角智商在线，推理有说服力
- 结局要能给读者"原来如此"的满足感`
    )
  }

  const firstChapter = BUILTIN_PROMPTS.find(p => p.key === 'first_chapter_draft')
  if (firstChapter) {
    overrides['first_chapter_draft'] = firstChapter.content.replace(
      /【文风要求（如有，请严格遵循）】[\s\S]*?$/,
      `【文风要求（如有，请严格遵循）】
- 悬疑推理风格：逻辑缜密、氛围紧张、悬念迭起
- 开篇就要抛出悬念或谜团，吸引读者追读
- 信息揭露要循序渐进，不要一次性全部给出
- 注重场景氛围和细节描写的悬疑感
- 避免过于直白的线索，保持悬念张力`
    )
  }

  return overrides
}

let customPresets: PromptPreset[] = []
let presetsLoaded = false

export async function loadCustomPresets(): Promise<void> {
  if (presetsLoaded) return
  presetsLoaded = true
}

export function getAllPresets(): PromptPreset[] {
  return [...BUILTIN_PROMPT_PRESETS, ...customPresets]
}

export function getPresetById(id: string): PromptPreset | undefined {
  return getAllPresets().find(p => p.id === id)
}

export function getEditablePromptKeys(): string[] {
  return EDITABLE_PROMPT_KEYS
}

export async function saveCustomPreset(preset: PromptPreset): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const dirPath = `${velaHome}/prompt-presets`
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) await ipc.invoke('fs:mkdir', dirPath)
    const filePath = `${dirPath}/${preset.id}.json`
    await ipc.invoke('fs:write-file', filePath, JSON.stringify(preset, null, 2))

    const existingIndex = customPresets.findIndex(p => p.id === preset.id)
    if (existingIndex >= 0) {
      customPresets[existingIndex] = preset
    } else {
      customPresets.push(preset)
    }
    return true
  } catch {
    return false
  }
}

export async function deleteCustomPreset(id: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const filePath = `${velaHome}/prompt-presets/${id}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    customPresets = customPresets.filter(p => p.id !== id)
    return true
  } catch {
    return false
  }
}

export function generatePresetId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}