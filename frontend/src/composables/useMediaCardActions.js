import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { searchApi, subscriptionApi } from '@/api'
import { createExploreLibraryBadgeSyncer } from '@/utils/exploreLibraryBadgeSync'

export const toValidTmdbId = (rawId) => {
  const id = Number(rawId)
  if (!Number.isFinite(id) || id <= 0) return null
  return Math.trunc(id)
}

export const buildSubscribedKey = (mediaType, tmdbId) => {
  const type = mediaType === 'tv' ? 'tv' : (mediaType === 'movie' ? 'movie' : '')
  const id = toValidTmdbId(tmdbId)
  if (!type || !id) return ''
  return `${type}:${id}`
}

const normalizeMediaType = (rawType) => {
  return String(rawType || '').toLowerCase() === 'tv' ? 'tv' : 'movie'
}

const withTitleHint = (item, message) => {
  const title = String(item?.title || item?.name || '').trim()
  return title ? `${title}：${message}` : message
}

import { buildTmdbSavePayload } from '@/utils/exploreQueuePayload'

const buildQueueItemKey = (item) => {
  const mediaType = normalizeMediaType(item?.media_type)
  const tmdbId = toValidTmdbId(item?.tmdb_id)
  if (tmdbId) return `tmdb:${mediaType}:${tmdbId}`
  return ''
}

const buildQueueItemKeyFromTask = (task) => {
  const itemKey = String(task?.item_key || '').trim()
  if (itemKey) return itemKey
  const mediaType = normalizeMediaType(task?.media_type)
  const tmdbId = toValidTmdbId(task?.tmdb_id)
  if (tmdbId) return `tmdb:${mediaType}:${tmdbId}`
  return ''
}

/**
 * 影视卡片订阅与转存操作（演职员作品、关注动态等场景复用）。
 */
export function useMediaCardActions(options = {}) {
  const pollSaveQueue = options.pollSaveQueue !== false
  const getItems = typeof options.getItems === 'function' ? options.getItems : null

  const subscribedIdMap = ref(new Map())
  const embyStatusMap = ref(new Map())
  const feiniuStatusMap = ref(new Map())
  const queueActiveSaveKeys = ref(new Set())
  let queuePollTimer = null
  let queuePolling = false
  let libraryBadgeSyncer = null

  const markLibraryOnItem = (item) => {
    if (!item || typeof item !== 'object') return
    const key = buildSubscribedKey(item.media_type, item.tmdb_id)
    const inEmby = Boolean(key) && Boolean(embyStatusMap.value.get(key)?.exists_in_emby)
    const inFeiniu = Boolean(key) && Boolean(feiniuStatusMap.value.get(key)?.exists_in_feiniu)
    item.isInEmby = inEmby
    item.isInFeiniu = inFeiniu
    item.isInMediaLibrary = inEmby || inFeiniu
  }

  const applyItemState = (item) => {
    if (!item || typeof item !== 'object') return
    const key = buildSubscribedKey(item.media_type, item.tmdb_id)
    item.isSubscribed = Boolean(key) && subscribedIdMap.value.has(key)
    item.subscribing = Boolean(item.subscribing)
    const itemKey = buildQueueItemKey(item)
    item.saving = Boolean(itemKey) && queueActiveSaveKeys.value.has(itemKey)
    markLibraryOnItem(item)
  }

  const applyItemStates = (items) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      applyItemState(item)
    }
  }

  const applyItemStatesForKeys = (keys = new Set()) => {
    const rows = getItems?.() ?? []
    for (const item of rows) {
      const key = buildSubscribedKey(item.media_type, item.tmdb_id)
      if (!key || keys.has(key)) {
        applyItemState(item)
      }
    }
  }

  const mergeEmbyStatusMap = (rawMap = {}) => {
    if (!rawMap || typeof rawMap !== 'object') return
    const nextMap = new Map(embyStatusMap.value)
    const touched = new Set()
    for (const [key, value] of Object.entries(rawMap)) {
      nextMap.set(key, value || {})
      touched.add(key)
    }
    embyStatusMap.value = nextMap
    applyItemStatesForKeys(touched)
  }

  const mergeFeiniuStatusMap = (rawMap = {}) => {
    if (!rawMap || typeof rawMap !== 'object') return
    const nextMap = new Map(feiniuStatusMap.value)
    const touched = new Set()
    for (const [key, value] of Object.entries(rawMap)) {
      nextMap.set(key, value || {})
      touched.add(key)
    }
    feiniuStatusMap.value = nextMap
    applyItemStatesForKeys(touched)
  }

  libraryBadgeSyncer = createExploreLibraryBadgeSyncer({
    getEmbyStatusMap: () => embyStatusMap.value,
    getFeiniuStatusMap: () => feiniuStatusMap.value,
    mergeEmbyStatusMap,
    mergeFeiniuStatusMap
  })

  const scheduleLibraryBadgeSync = (items) => {
    const rows = items ?? getItems?.() ?? []
    libraryBadgeSyncer?.schedule(rows)
  }

  const applySubscribedFlag = (item) => {
    applyItemState(item)
  }

  const applySubscribedFlags = (items) => {
    applyItemStates(items)
  }

  const refreshSubscribedMap = async () => {
    try {
      const { data } = await subscriptionApi.listForStatus()
      const items = Array.isArray(data) ? data : (data.items || [])
      const nextMap = new Map()

      for (const sub of items) {
        const key = buildSubscribedKey(sub.media_type, sub.tmdb_id)
        const id = Number(sub.id || 0)
        if (key && id > 0) nextMap.set(key, id)
      }

      subscribedIdMap.value = nextMap
    } catch {
      // ignore subscription sync errors
    }
  }

  const syncItemStates = (items) => {
    const rows = items ?? getItems?.() ?? []
    applyItemStates(rows)
    scheduleLibraryBadgeSync(rows)
  }

  const applyQueueTaskSnapshot = (tasks = []) => {
    const nextSave = new Set()
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      const itemKey = buildQueueItemKeyFromTask(task)
      if (itemKey && task.queue_type === 'save') {
        nextSave.add(itemKey)
      }
    }
    queueActiveSaveKeys.value = nextSave
    syncItemStates()
  }

  const fetchQueueActiveTasks = async () => {
    if (queuePolling) return
    queuePolling = true
    try {
      const { data } = await searchApi.getExploreActiveQueueTasks('save')
      applyQueueTaskSnapshot(Array.isArray(data) ? data : [])
    } catch {
      // ignore queue sync errors
    } finally {
      queuePolling = false
    }
  }

  const markQueueTaskActive = (task) => {
    if (!task || typeof task !== 'object') return
    const itemKey = buildQueueItemKeyFromTask(task)
    if (!itemKey) return
    queueActiveSaveKeys.value = new Set([...queueActiveSaveKeys.value, itemKey])
    syncItemStates()
  }

  const startQueuePolling = () => {
    if (!pollSaveQueue) return
    fetchQueueActiveTasks()
    if (!queuePollTimer) {
      queuePollTimer = window.setInterval(fetchQueueActiveTasks, 1800)
    }
  }

  const stopQueuePolling = () => {
    if (queuePollTimer) {
      clearInterval(queuePollTimer)
      queuePollTimer = null
    }
  }

  const handleSubscribe = async (item) => {
    if (!item) return
    const mediaType = normalizeMediaType(item.media_type)
    const tmdbId = toValidTmdbId(item.tmdb_id)
    if (!tmdbId) {
      ElMessage.warning(withTitleHint(item, '缺少 TMDB 标识，无法操作订阅'))
      return
    }

    item.subscribing = true
    try {
      const yearRaw = item?.year || item?.release_date || item?.first_air_date || item?.credit_date || ''
      const year = String(yearRaw).trim().slice(0, 4) || null
      const { data } = await subscriptionApi.toggle({
        tmdb_id: tmdbId,
        title: String(item.title || item.name || '').trim(),
        media_type: mediaType,
        poster_path: String(item.poster_path || '').trim() || null,
        overview: String(item.overview || '').trim() || null,
        year,
        rating: item.rating ?? item.vote_average ?? null
      })
      const message = String(data?.message || '').trim()
      if (data?.subscribed) {
        item.isSubscribed = true
        ElMessage.success(withTitleHint(item, message || '订阅成功'))
      } else {
        item.isSubscribed = false
        ElMessage.info(withTitleHint(item, message || '已取消订阅'))
      }
      await refreshSubscribedMap()
      applySubscribedFlag(item)
    } catch (error) {
      ElMessage.error(error.response?.data?.detail || error.message || '操作失败')
    } finally {
      item.subscribing = false
    }
  }

  const handleSave = async (item) => {
    if (!item) return
    const payload = buildTmdbSavePayload(item)
    if (!payload.tmdb_id) {
      ElMessage.warning(withTitleHint(item, '缺少 TMDB 标识，无法加入转存队列'))
      return
    }
    item.saving = true
    try {
      const { data } = await searchApi.enqueueExploreSaveTask(payload)
      markQueueTaskActive(data)
      const message = String(data?.message || '').trim()
      if (message.includes('已在转存队列')) {
        ElMessage.info(withTitleHint(item, message))
      } else {
        ElMessage.success(withTitleHint(item, message || '已加入转存队列'))
      }
    } catch (error) {
      item.saving = false
      const reason = error.response?.data?.detail || error.message || '加入转存队列失败'
      ElMessage.error(withTitleHint(item, reason))
    }
  }

  onMounted(() => {
    startQueuePolling()
  })

  onBeforeUnmount(() => {
    stopQueuePolling()
    libraryBadgeSyncer?.dispose()
    libraryBadgeSyncer = null
  })

  return {
    refreshSubscribedMap,
    applySubscribedFlag,
    applySubscribedFlags,
    syncItemStates,
    scheduleLibraryBadgeSync,
    fetchQueueActiveTasks,
    handleSubscribe,
    handleSave
  }
}
