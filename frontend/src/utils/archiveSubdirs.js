/** 归档二级目录配置：前后端共用的归一化与序列化逻辑 */

export const DEFAULT_ARCHIVE_SUBDIRS = {
  movie_root: '电影',
  tv_root: '剧集',
  movie_categories: [
    { id: 'cn', name: '华语电影', enabled: true, match_countries: ['CN', 'HK', 'TW', 'SG'] },
    { id: 'jk', name: '日韩电影', enabled: true, match_countries: ['JP', 'KR', 'KP'] },
    { id: 'foreign', name: '外语电影', enabled: true, is_fallback: true }
  ],
  tv_categories: [
    { id: 'doc', name: '纪录片', enabled: true, match_genre_ids: [99] },
    { id: 'anime', name: '动漫', enabled: true, match_genre_ids: [16] },
    { id: 'variety', name: '综艺', enabled: true, match_genre_ids: [10764, 10767, 10763] },
    { id: 'cn', name: '国产剧', enabled: true, match_countries: ['CN', 'HK', 'TW', 'SG'] },
    { id: 'jk', name: '日韩剧', enabled: true, match_countries: ['JP', 'KR', 'KP'] },
    { id: 'us_gb', name: '美英剧', enabled: true, match_countries: ['US', 'GB'] },
    { id: 'default', name: '美英剧', enabled: true, is_fallback: true }
  ]
}

export const FALLBACK_SUBDIR_OPTIONS = {
  country_groups: [
    {
      label: '华语地区',
      countries: [
        { code: 'CN', name: '中国大陆' },
        { code: 'HK', name: '中国香港' },
        { code: 'TW', name: '中国台湾' },
        { code: 'SG', name: '新加坡' }
      ]
    },
    {
      label: '日韩',
      countries: [
        { code: 'JP', name: '日本' },
        { code: 'KR', name: '韩国' }
      ]
    },
    {
      label: '欧美',
      countries: [
        { code: 'US', name: '美国' },
        { code: 'GB', name: '英国' }
      ]
    }
  ],
  tv_genres: [
    { id: 16, name: '动画' },
    { id: 99, name: '纪录片' },
    { id: 10764, name: '真人秀' }
  ],
  movie_match_types: [
    { value: 'country', label: '按国家/地区' },
    { value: 'fallback', label: '兜底（其余未匹配）' }
  ],
  tv_match_types: [
    { value: 'country', label: '按国家/地区' },
    { value: 'genre', label: '按 TMDB 剧集类型' },
    { value: 'fallback', label: '兜底（其余未匹配）' }
  ]
}

const cloneDefaultArchiveSubdirs = () => JSON.parse(JSON.stringify(DEFAULT_ARCHIVE_SUBDIRS))

export const inferSubdirMatchType = (item, mediaType) => {
  if (item?.is_fallback) return 'fallback'
  if (mediaType === 'tv' && Array.isArray(item?.match_genre_ids) && item.match_genre_ids.length) {
    return 'genre'
  }
  if (Array.isArray(item?.match_countries) && item.match_countries.length) {
    return 'country'
  }
  return mediaType === 'tv' ? 'country' : 'country'
}

const normalizeCategoryRow = (item, index, mediaType) => {
  const matchCountries = Array.isArray(item.match_countries) ? [...item.match_countries] : []
  const matchGenreIds = Array.isArray(item.match_genre_ids)
    ? item.match_genre_ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
    : []
  const row = {
    id: item.id || `custom_${index + 1}`,
    name: item.name || '未分类',
    enabled: item.enabled !== false,
    is_fallback: !!item.is_fallback,
    match_countries: matchCountries,
    match_genre_ids: matchGenreIds
  }
  row.match_type = inferSubdirMatchType(row, mediaType)
  if (row.match_type === 'fallback') {
    row.is_fallback = true
    row.match_countries = []
    row.match_genre_ids = []
  }
  return row
}

const normalizeSubdirCategories = (items = [], fallbackItems = [], mediaType = 'movie') => {
  const fallback = Array.isArray(fallbackItems) && fallbackItems.length ? fallbackItems : []
  const source = Array.isArray(items) && items.length ? items : fallback
  return source.map((item, index) => normalizeCategoryRow(item, index, mediaType))
}

export const applyArchiveSubdirs = (raw) => {
  const defaults = cloneDefaultArchiveSubdirs()
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    movie_root: source.movie_root || defaults.movie_root,
    tv_root: source.tv_root || defaults.tv_root,
    movie_categories: normalizeSubdirCategories(
      source.movie_categories,
      defaults.movie_categories,
      'movie'
    ),
    tv_categories: normalizeSubdirCategories(
      source.tv_categories,
      defaults.tv_categories,
      'tv'
    )
  }
}

export const applySubdirMatchTypeChange = (row, matchType, mediaType) => {
  row.match_type = matchType
  if (matchType === 'fallback') {
    row.is_fallback = true
    row.match_countries = []
    row.match_genre_ids = []
    return
  }
  row.is_fallback = false
  if (matchType === 'country') {
    row.match_genre_ids = []
    if (!Array.isArray(row.match_countries)) row.match_countries = []
  } else if (matchType === 'genre' && mediaType === 'tv') {
    row.match_countries = []
    if (!Array.isArray(row.match_genre_ids)) row.match_genre_ids = []
  }
}

export const createSubdirCategoryRow = (mediaType, index) => ({
  id: `custom_${index}`,
  name: `自定义分类${index}`,
  enabled: true,
  match_type: 'country',
  is_fallback: false,
  match_countries: [],
  match_genre_ids: []
})

const categoryToPayload = (item, mediaType) => {
  const row = {
    id: item.id,
    name: String(item.name || '').trim(),
    enabled: item.enabled !== false
  }
  const matchType = item.match_type || inferSubdirMatchType(item, mediaType)
  if (matchType === 'fallback') {
    row.is_fallback = true
    return row
  }
  if (matchType === 'genre' && mediaType === 'tv') {
    const genreIds = (Array.isArray(item.match_genre_ids) ? item.match_genre_ids : [])
      .map((id) => Number(id))
      .filter((id) => !Number.isNaN(id))
    if (genreIds.length) row.match_genre_ids = genreIds
    return row
  }
  const countries = (Array.isArray(item.match_countries) ? item.match_countries : [])
    .map((code) => String(code || '').trim().toUpperCase())
    .filter(Boolean)
  if (countries.length) row.match_countries = countries
  return row
}

export const buildArchiveSubdirsPayload = (subdirs) => ({
  movie_root: String(subdirs.movie_root || '').trim() || '电影',
  tv_root: String(subdirs.tv_root || '').trim() || '剧集',
  movie_categories: (subdirs.movie_categories || []).map((item) => categoryToPayload(item, 'movie')),
  tv_categories: (subdirs.tv_categories || []).map((item) => categoryToPayload(item, 'tv'))
})

export const validateArchiveSubdirs = (subdirs) => {
  const checkList = (items, mediaTypeLabel, allowGenre) => {
    for (const item of items || []) {
      if (item.enabled === false) continue
      const matchType = item.match_type || 'country'
      if (matchType === 'fallback') continue
      if (matchType === 'genre' && allowGenre) {
        if (!item.match_genre_ids?.length) {
          return `「${item.name}」请至少选择一个 TMDB 剧集类型`
        }
        continue
      }
      if (!item.match_countries?.length) {
        return `「${item.name}」请至少选择一个国家/地区`
      }
    }
    return ''
  }
  const movieError = checkList(subdirs.movie_categories, '电影', false)
  if (movieError) return movieError
  const tvError = checkList(subdirs.tv_categories, '剧集', true)
  if (tvError) return tvError
  return ''
}

export const buildCountryNameMap = (countryGroups = []) => {
  const map = {}
  for (const group of countryGroups) {
    for (const country of group.countries || []) {
      map[country.code] = country.name
    }
  }
  return map
}

export const formatCountrySelection = (codes = [], nameMap = {}) => {
  if (!codes.length) return '未选择'
  return codes.map((code) => {
    const name = nameMap[code]
    return name ? `${name}（${code}）` : code
  }).join('、')
}

/** 将已保存但不在常用列表中的国家/类型补入选项，避免多选框显示异常 */
export const enrichSubdirOptions = (options, subdirs) => {
  const countryGroups = JSON.parse(JSON.stringify(options.country_groups || []))
  const tvGenres = [...(options.tv_genres || [])]
  const knownCountries = new Set()
  countryGroups.forEach((group) => {
    group.countries = group.countries || []
    group.countries.forEach((item) => knownCountries.add(item.code))
  })
  const extraCountries = []
  const allCategories = [
    ...(subdirs.movie_categories || []),
    ...(subdirs.tv_categories || [])
  ]
  for (const category of allCategories) {
    for (const code of category.match_countries || []) {
      if (knownCountries.has(code)) continue
      knownCountries.add(code)
      extraCountries.push({ code, name: code })
    }
  }
  if (extraCountries.length) {
    countryGroups.push({ label: '已配置项', countries: extraCountries })
  }

  const knownGenreIds = new Set(tvGenres.map((item) => item.id))
  for (const category of subdirs.tv_categories || []) {
    for (const rawId of category.match_genre_ids || []) {
      const id = Number(rawId)
      if (Number.isNaN(id) || knownGenreIds.has(id)) continue
      knownGenreIds.add(id)
      tvGenres.push({ id, name: `类型 ${id}` })
    }
  }

  return {
    ...options,
    country_groups: countryGroups,
    tv_genres: tvGenres
  }
}
