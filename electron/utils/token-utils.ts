/**
 * Token 估算工具
 * 由于流式 API 通常不返回 token 使用量，需要通过字符数估算
 * 
 * 根据官方说明：
 * - 1 个英文字符 ≈ 0.3 个 token
 * - 1 个中文字符 ≈ 0.6 个 token
 */

/**
 * 估算字符串的 token 数量
 * @param text 要估算的文本
 * @returns 估算的 token 数量
 */
export function estimateTokens(text: string): number {
  if (!text || !text.trim()) return 0
  
  // 统计中文字符数（包括中文标点）
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  // 统计非中文字符数（英文、数字、标点等）
  const otherChars = text.length - chineseChars
  
  // 使用官方推荐的换算比例估算 token 数
  // 1 个中文字符 ≈ 0.6 个 token
  // 1 个英文字符 ≈ 0.3 个 token
  const chineseTokens = Math.round(chineseChars * 0.6)
  const otherTokens = Math.round(otherChars * 0.3)
  
  // 返回估算的总 token 数，最少为 1
  return Math.max(1, chineseTokens + otherTokens)
}

/**
 * 估算消息数组的总 token 数
 * @param messages 消息数组
 * @returns 估算的总 token 数量
 */
export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  
  for (const msg of messages) {
    // 每个消息的基础开销（角色标签等）
    total += 4
    // 角色名的 token 数
    total += estimateTokens(msg.role)
    // 内容的 token 数
    total += estimateTokens(msg.content)
  }
  
  // 响应的基础开销
  total += 3
  
  return total
}