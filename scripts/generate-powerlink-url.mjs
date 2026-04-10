import { createCipheriv, createHash, randomBytes } from 'node:crypto'

const normalizePrefix = (prefix) => {
  const trimmed = (prefix ?? '').trim()

  if (!trimmed) {
    return '/p/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const ensureBaseUrl = (rawBaseUrl) => {
  const trimmed = (rawBaseUrl ?? '').trim()

  if (!trimmed) {
    return ''
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

const [keywordArg, baseUrlArg] = process.argv.slice(2)
const keyword = (keywordArg ?? '').trim()
const secret = (process.env.POWERLINK_URL_SECRET ?? '').trim()

if (!keyword) {
  console.error('사용법: npm run powerlink:url -- "키워드" "https://도메인"')
  process.exit(1)
}

if (!secret) {
  console.error('POWERLINK_URL_SECRET 환경변수를 먼저 설정해주세요.')
  process.exit(1)
}

const key = createHash('sha256').update(secret).digest()
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(keyword, 'utf8'), cipher.final()])
const authTag = cipher.getAuthTag()
const token = Buffer.concat([iv, authTag, encrypted]).toString('base64url')

const prefix = normalizePrefix(process.env.POWERLINK_PATH_PREFIX ?? '/p/')
const relativePath = `${prefix}${token}`
const baseUrl = ensureBaseUrl(baseUrlArg ?? process.env.POWERLINK_BASE_URL)
const url = baseUrl ? new URL(relativePath.replace(/^\//, ''), baseUrl).toString() : relativePath

console.log(`keyword: ${keyword}`)
console.log(`token: ${token}`)
console.log(`url: ${url}`)
