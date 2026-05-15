/**
 * 解析详情页返回路径，仅允许站内相对路径。
 */
export const resolveInternalBackPath = (rawFrom) => {
  const from = String(rawFrom || '').trim()
  if (!from.startsWith('/') || from.startsWith('//')) {
    return null
  }
  return from
}

/**
 * 详情页返回：优先使用 from 参数，否则浏览器后退，最后回探索首页。
 */
export const navigateBackFromDetail = (router, route, fallback = '/explore/douban') => {
  const from = resolveInternalBackPath(route.query?.from)
  if (from) {
    router.push(from)
    return
  }
  if (window.history.length > 1) {
    router.back()
    return
  }
  router.push(fallback)
}
