import { TMDB_DEFAULT_IMAGE_BASE_URL } from '@/utils/tmdb'

/** 演职员头像常用尺寸 */
export const TMDB_PROFILE_IMAGE_SIZE = 'w185'

/**
 * 从条目对象解析 TMDB 演职员头像路径（人物搜索结果用 profile_path，影视用 poster_path）。
 */
export const resolveTmdbProfilePath = (item) => {
  if (!item || typeof item !== 'object') return ''
  const profilePath = String(item.profile_path || '').trim()
  if (profilePath) return profilePath
  if (item.media_type === 'person') {
    return String(item.poster_path || '').trim()
  }
  return ''
}

/**
 * 构建 TMDB 演职员头像 URL。
 */
export const getTmdbProfileUrl = (profilePath, size = TMDB_PROFILE_IMAGE_SIZE) => {
  const raw = String(profilePath || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('//')) {
    return raw
  }
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  const base = TMDB_DEFAULT_IMAGE_BASE_URL.replace(/\/w\d+$/, '')
  return `${base}/${size}${normalized}`
}

export const getDepartmentLabel = (department) => {
  const key = String(department || '').trim()
  const labels = {
    Acting: '演员',
    Directing: '导演',
    Writing: '编剧',
    Production: '制片',
    Camera: '摄影',
    Editing: '剪辑',
    Sound: '音效',
    Art: '美术',
    Costume: '服装',
    'Costume & Make-Up': '妆造'
  }
  return labels[key] || key || '演职员'
}
