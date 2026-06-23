const RESOURCE_CREDENTIAL_401_PATH_PREFIXES = [
  '/pan115/',
]

const normalizeRequestPath = (rawUrl) => {
  const value = String(rawUrl || '').trim()
  if (!value) return ''

  try {
    const parsed = new URL(value, 'http://localhost')
    const path = parsed.pathname || ''
    return path.startsWith('/api/') ? path.slice(4) : path
  } catch {
    const path = value.split('?')[0].split('#')[0]
    if (path.startsWith('/api/')) return path.slice(4)
    return path.startsWith('/') ? path : `/${path}`
  }
}

const isAuthEndpoint = (path) => (
  path === '/auth/login'
  || path === '/auth/logout'
  || path === '/auth/session'
)

const isResourceCredentialEndpoint = (path) => (
  RESOURCE_CREDENTIAL_401_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
)

export const shouldRedirectToLoginForUnauthorized = (error) => {
  if (Number(error?.response?.status || 0) !== 401) return false

  const path = normalizeRequestPath(error?.config?.url)
  if (isAuthEndpoint(path)) return false

  const rawDetail = error?.response?.data?.detail
  if (rawDetail && typeof rawDetail === 'object') return false

  if (isResourceCredentialEndpoint(path)) return false

  return true
}
