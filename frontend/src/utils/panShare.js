/** 清洗 115 提取码，仅保留 4 位字母数字 */
export const sanitizeReceiveCode = (value) => {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9]/g, '')
  const match = cleaned.match(/[A-Za-z0-9]{4}/)
  return match ? match[0] : ''
}

/** 从文本中提取并规范化 115 分享链接 */
export const sanitizePanShareUrl = (shareUrl) => {
  let raw = String(shareUrl || '').trim()
  if (!raw) return ''

  const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i)
  if (urlMatch) {
    raw = urlMatch[0]
  }

  try {
    const url = new URL(raw)
    for (const key of ['password', 'pwd', 'receive_code']) {
      const current = url.searchParams.get(key)
      if (!current) continue
      const cleaned = sanitizeReceiveCode(current)
      if (cleaned) {
        url.searchParams.set(key, cleaned)
      } else {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return raw.replace(/[^\x20-\x7E\u4e00-\u9fff/?=&:%._-]/g, '').trim()
  }
}

export const parseReceiveCodeFromShareLink = (shareLink) => {
  const rawLink = sanitizePanShareUrl(shareLink)
  if (!rawLink) return ''

  const shortMatch = rawLink.match(/^[A-Za-z0-9]+-([A-Za-z0-9]{4})$/)
  if (shortMatch) return sanitizeReceiveCode(shortMatch[1])

  const queryMatch = rawLink.match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i)
  if (queryMatch) {
    try {
      return sanitizeReceiveCode(decodeURIComponent(queryMatch[1]))
    } catch {
      return sanitizeReceiveCode(queryMatch[1])
    }
  }

  const textMatch = rawLink.match(/(?:提取码|提取碼|密码|密碼|password|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4})/i)
  if (textMatch) return sanitizeReceiveCode(textMatch[1])

  return ''
}

export const resolvePanShareLink = (row) => (
  sanitizePanShareUrl(String(row?.share_link || row?.share_url || row?.pan115_share_link || '').trim())
)

/** 构建选集/转存请求使用的分享链接与提取码 */
export const buildPanShareRequest = (row, shareLink = '') => {
  const shareUrl = sanitizePanShareUrl(shareLink || resolvePanShareLink(row))
  const linkCode = parseReceiveCodeFromShareLink(shareUrl)
  const rowCode = sanitizeReceiveCode(row?.access_code || row?.hdhive_access_code || '')
  const receiveCode = linkCode || rowCode
  return { shareUrl, receiveCode }
}

/** 从 HDHive 解锁响应或资源行数据拼装完整分享链接 */
export const buildShareLinkFromUnlockPayload = (payload = {}, row = {}) => {
  let shareLink = sanitizePanShareUrl(payload?.share_link || payload?.full_url || '')
  if (shareLink) return shareLink

  const resourceUrl = sanitizePanShareUrl(
    payload?.resource_url || row?.hdhive_resource_url || row?.hdhive_media_url || '',
  )
  const accessCode = sanitizeReceiveCode(
    payload?.access_code || row?.access_code || row?.hdhive_access_code || '',
  )
  if (resourceUrl && accessCode) {
    const joiner = resourceUrl.includes('?') ? '&' : '?'
    return sanitizePanShareUrl(`${resourceUrl}${joiner}password=${encodeURIComponent(accessCode)}`)
  }
  return resourceUrl
}
