/** 归档命名格式：前后端共用的归一化、预览与序列化 */

export const DEFAULT_ARCHIVE_NAMING = {
  movie_file: '{title} ({year}){ext}',
  tv_file: '{title} ({year}) - S{season2}E{episode2}{ext}',
  movie_folder: '{title} ({year})',
  tv_folder: '{title} ({year})',
  tv_season_folder: '第{season}季'
}

export const NAMING_TEMPLATE_META = [
  { key: 'movie_file', label: '电影文件名' },
  { key: 'tv_file', label: '剧集文件名' },
  { key: 'movie_folder', label: '电影文件夹' },
  { key: 'tv_folder', label: '剧集文件夹' },
  { key: 'tv_season_folder', label: '剧集季文件夹' }
]

export const NAMING_VARIABLES = [
  { key: 'title', label: '标题', example: '黑客帝国', group: '基础' },
  { key: 'year', label: '年份', example: '1999', group: '基础' },
  { key: 'season', label: '季（数字）', example: '1', group: '基础' },
  { key: 'season2', label: '季（两位）', example: '01', group: '基础' },
  { key: 'episode', label: '集（数字）', example: '2', group: '基础' },
  { key: 'episode2', label: '集（两位）', example: '02', group: '基础' },
  { key: 'ext', label: '扩展名', example: '.mkv', group: '基础' },
  { key: 'tmdb_id', label: 'TMDB ID', example: '603', group: '元数据' },
  { key: 'media_type', label: '类型', example: 'movie', group: '元数据' },
  { key: 'category', label: '归档分类', example: '华语电影', group: '元数据' },
  { key: 'resolution', label: '分辨率', example: '4K', group: '画质' },
  { key: 'hdr', label: 'HDR/动态范围', example: 'HDR10', group: '画质' },
  { key: 'source', label: '片源', example: 'WEB-DL', group: '画质' },
  { key: 'codec', label: '视频编码', example: 'HEVC', group: '画质' },
  { key: 'audio', label: '音频', example: 'Atmos', group: '画质' },
  { key: 'format', label: '常用画质组合', example: '4K HDR HEVC', group: '画质' },
  { key: 'formats', label: '全部画质标签', example: '4K.HDR.HEVC.WEB-DL', group: '画质' }
]

export const NAMING_VARIABLE_GROUPS = [
  {
    key: 'basic',
    label: '基础信息',
    variables: ['title', 'year', 'season', 'season2', 'episode', 'episode2', 'ext']
  },
  {
    key: 'meta',
    label: 'TMDB / 分类',
    variables: ['tmdb_id', 'media_type', 'category']
  },
  {
    key: 'quality',
    label: '画质 / 格式',
    variables: ['resolution', 'hdr', 'source', 'codec', 'audio', 'format', 'formats']
  }
]

export const NAMING_PREVIEW_SAMPLE = {
  title: '黑客帝国',
  year: '1999',
  season: 1,
  episode: 2,
  ext: '.mkv',
  tmdb_id: '603',
  media_type: 'movie',
  category: '华语电影',
  source_filename: 'The.Matrix.1999.2160p.HDR10.HEVC.WEB-DL.Atmos.mkv'
}

const HDR_LABELS = ['Dolby Vision', 'HDR10+', 'HDR10', 'HDR', 'SDR']
const SOURCE_LABELS = ['REMUX', 'BluRay', 'WEB-DL']
const CODEC_LABELS = ['HEVC', 'H.264', 'AV1']
const AUDIO_LABELS = ['Atmos', 'DTS-HD', 'TrueHD', 'DTS', 'AAC', 'FLAC']

const RESOLUTION_PATTERNS = [
  ['4K', /\b(?:4K|2160[pPiI]|UHD)\b/i],
  ['1080p', /\b(?:1080[pPiI]|FHD|Full\s*HD)\b/i],
  ['720p', /\b720[pPiI]\b/i],
  ['480p', /\b480[pPiI]\b/i]
]

const FORMAT_PATTERNS = [
  ['Dolby Vision', /\b(?:Dolby\s*Vision|DoVi|DV)\b/i],
  ['HDR10+', /\bHDR10\+/i],
  ['HDR10', /\bHDR10\b/i],
  ['HDR', /\bHDR\b/i],
  ['SDR', /\bSDR\b/i],
  ['REMUX', /\bREMUX\b/i],
  ['BluRay', /\b(?:Blu[\-\s]?Ray|BDRip|BDRemux|BD)\b/i],
  ['WEB-DL', /\b(?:WEB[\-\s]?DL|WEBDL|WEBRip|WEB)\b/i],
  ['HEVC', /\b(?:HEVC|[Hh]\.?265|x265)\b/],
  ['H.264', /\b(?:AVC|[Hh]\.?264|x264)\b/],
  ['AV1', /\bAV1\b/i],
  ['Atmos', /\bAtmos\b/i],
  ['DTS-HD', /\bDTS[\-\s]?HD(?:\s*MA)?\b/i],
  ['TrueHD', /\bTrueHD\b/i],
  ['DTS', /\bDTS\b/i],
  ['AAC', /\bAAC\b/i],
  ['FLAC', /\bFLAC\b/i]
]

const INVALID_TEMPLATE_CHARS = /[\\/:*?"<>|]/

const pickFirstLabel = (labels, candidates) => {
  for (const label of labels) {
    if (candidates.includes(label)) return label
  }
  return ''
}

export const extractNamingMediaTags = (sourceFilename = '') => {
  const text = String(sourceFilename || '').trim()
  if (!text) {
    return {
      resolution: '',
      hdr: '',
      source: '',
      codec: '',
      audio: '',
      format: '',
      formats: ''
    }
  }

  let resolution = ''
  for (const [label, pattern] of RESOLUTION_PATTERNS) {
    if (pattern.test(text)) {
      resolution = label
      break
    }
  }

  const formats = []
  const seen = new Set()
  for (const [label, pattern] of FORMAT_PATTERNS) {
    if (seen.has(label)) continue
    if (pattern.test(text)) {
      formats.push(label)
      seen.add(label)
      if (label === 'HDR10+' || label === 'HDR10') seen.add('HDR')
      if (label === 'DTS-HD') seen.add('DTS')
    }
  }

  const hdr = pickFirstLabel(HDR_LABELS, formats)
  const source = pickFirstLabel(SOURCE_LABELS, formats)
  const codec = pickFirstLabel(CODEC_LABELS, formats)
  const audio = pickFirstLabel(AUDIO_LABELS, formats)
  const format = [resolution, hdr, codec].filter(Boolean).join(' ')

  const allParts = []
  const allSeen = new Set()
  for (const part of [resolution, ...formats]) {
    if (!part || allSeen.has(part)) continue
    allParts.push(part)
    allSeen.add(part)
  }

  return {
    resolution,
    hdr,
    source,
    codec,
    audio,
    format,
    formats: allParts.join('.')
  }
}

const cleanupRenderedName = (text) => {
  let cleaned = String(text || '')
  cleaned = cleaned.replace(/\s*\(\s*\)/g, '')
  cleaned = cleaned.replace(/\s{2,}/g, ' ')
  cleaned = cleaned.replace(/\s+-\s+-/g, ' - ')
  cleaned = cleaned.replace(/\.{2,}/g, '.')
  cleaned = cleaned.replace(/\s+\./g, '.')
  return cleaned.trim().replace(/^[\s\-.]+|[\s\-.]+$/g, '')
}

export const buildNamingContext = ({
  title = '',
  year = '',
  season = 1,
  episode = 1,
  ext = '',
  tmdb_id = '',
  media_type = '',
  category = '',
  source_filename = ''
} = {}) => {
  const seasonNum = Math.max(1, Number(season) || 1)
  const episodeNum = Math.max(1, Number(episode) || 1)
  let safeExt = String(ext || '')
  if (safeExt && !safeExt.startsWith('.')) {
    safeExt = `.${safeExt.replace(/^\./, '')}`
  }
  const mediaTags = extractNamingMediaTags(source_filename)
  const mediaTypeText = String(media_type || '').trim().toLowerCase()
  return {
    title: String(title || '').trim(),
    year: String(year || '').trim(),
    season: String(seasonNum),
    season2: String(seasonNum).padStart(2, '0'),
    episode: String(episodeNum),
    episode2: String(episodeNum).padStart(2, '0'),
    ext: safeExt,
    tmdb_id: String(tmdb_id || '').trim(),
    media_type: mediaTypeText === 'movie' || mediaTypeText === 'tv' ? mediaTypeText : '',
    category: String(category || '').trim(),
    ...mediaTags
  }
}

export const renderArchiveTemplate = (template, context = {}) => {
  let result = String(template || '')
  Object.entries(context).forEach(([key, value]) => {
    result = result.split(`{${key}}`).join(String(value ?? ''))
  })
  return cleanupRenderedName(result)
}

export const applyArchiveNaming = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {}
  const result = {}
  for (const { key } of NAMING_TEMPLATE_META) {
    const value = String(source[key] ?? DEFAULT_ARCHIVE_NAMING[key] ?? '').trim()
    result[key] = value || DEFAULT_ARCHIVE_NAMING[key]
  }
  return result
}

export const buildArchiveNamingPayload = (naming) => applyArchiveNaming(naming)

export const validateArchiveNaming = (naming) => {
  const normalized = applyArchiveNaming(naming)
  for (const { key, label } of NAMING_TEMPLATE_META) {
    const value = normalized[key]
    if (!value) {
      return `「${label}」不能为空`
    }
    if (INVALID_TEMPLATE_CHARS.test(value)) {
      return `「${label}」包含非法字符 \\ / : * ? " < > |`
    }
    if (value.length > 200) {
      return `「${label}」过长（最多 200 字符）`
    }
  }
  return ''
}

export const previewArchiveNaming = (naming, templateKey, sample = NAMING_PREVIEW_SAMPLE) => {
  const normalized = applyArchiveNaming(naming)
  const context = buildNamingContext({
    title: sample.title || '黑客帝国',
    year: sample.year || '1999',
    season: sample.season ?? 1,
    episode: sample.episode ?? 2,
    ext: sample.ext || '.mkv',
    tmdb_id: sample.tmdb_id || '603',
    media_type: sample.media_type || 'movie',
    category: sample.category || '华语电影',
    source_filename: sample.source_filename || NAMING_PREVIEW_SAMPLE.source_filename
  })
  const rendered = renderArchiveTemplate(normalized[templateKey], context)
  if (rendered) return rendered
  if (templateKey.endsWith('_file')) {
    return `${context.title || '未命名'}${context.ext}`
  }
  return context.title || '未命名'
}

export const buildNamingVariableGroups = (options) => {
  if (Array.isArray(options?.variable_groups) && options.variable_groups.length) {
    return options.variable_groups
  }
  const variableMap = Object.fromEntries(NAMING_VARIABLES.map((item) => [item.key, item]))
  return NAMING_VARIABLE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    variables: group.variables.map((key) => variableMap[key]).filter(Boolean)
  }))
}
