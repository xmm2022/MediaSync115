/** 探索页 keep-alive 路由同步代际，用于作废仍在飞行中的 replace */
let searchRouteSyncToken = 0
/** 离开探索页时的目标地址，用于抵消过期 replace 导航 */
let pendingLeaveDestination = null

export const getSearchRouteSyncToken = () => searchRouteSyncToken

export const getPendingLeaveDestination = () => pendingLeaveDestination

/** 侧栏发起新导航前调用，作废旧的 pending 恢复 */
export const prepareSidebarNavigation = () => {
  searchRouteSyncToken += 1
  pendingLeaveDestination = null
}

/** 探索页即将离开 */
export const markSearchRouteLeave = (destination) => {
  searchRouteSyncToken += 1
  pendingLeaveDestination = String(destination || '').trim() || null
}

/** 成功到达目标页或不再需要恢复 */
export const clearPendingLeaveDestination = () => {
  pendingLeaveDestination = null
}

export const restorePendingLeaveNavigation = async (router) => {
  const dest = pendingLeaveDestination
  if (!dest || !router) return false
  if (router.currentRoute.value.fullPath === dest) {
    clearPendingLeaveDestination()
    return true
  }
  const currentPath = router.currentRoute.value.path
  const stuckOnExplore = (
    currentPath.startsWith('/explore/')
    || currentPath === '/'
    || currentPath === '/search'
  )
  if (!stuckOnExplore) {
    clearPendingLeaveDestination()
    return false
  }
  try {
    await router.push(dest)
  } catch {
    // 忽略重复导航
  }
  if (router.currentRoute.value.fullPath === dest) {
    clearPendingLeaveDestination()
    return true
  }
  return false
}
