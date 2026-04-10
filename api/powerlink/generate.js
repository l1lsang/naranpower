import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'

const LIMITS = {
  keyword: 120,
  baseUrl: 320,
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '')

const parseJsonEnv = (key) => {
  const rawValue = process.env[key]

  if (!rawValue || !rawValue.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)

    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
    }

    return parsed
  } catch (error) {
    throw new Error(`${key} 환경변수가 JSON 형식이 아닙니다.`)
  }
}

const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0]
  }

  const serviceAccount =
    parseJsonEnv('FIREBASE_SERVICE_ACCOUNT_JSON') ??
    parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')

  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 설정해주세요.')
  }

  return initializeApp({
    credential: cert(serviceAccount),
  })
}

const toRequestBody = (requestBody) => {
  if (!requestBody) {
    return {}
  }

  if (typeof requestBody === 'string') {
    try {
      return JSON.parse(requestBody)
    } catch (error) {
      throw new HttpError(400, '요청 본문(JSON) 형식이 올바르지 않습니다.')
    }
  }

  if (typeof requestBody !== 'object') {
    throw new HttpError(400, '요청 본문 형식이 올바르지 않습니다.')
  }

  return requestBody
}

const normalizePrefix = (prefix) => {
  const trimmed = toTrimmedString(prefix)

  if (!trimmed) {
    return '/p/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const ensureBaseUrl = (rawBaseUrl) => {
  const trimmed = toTrimmedString(rawBaseUrl)

  if (!trimmed) {
    return ''
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

const readBearerToken = (req) => {
  const authorization = toTrimmedString(req.headers.authorization)

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return ''
  }

  return authorization.slice(7).trim()
}

const assertAdminRequester = async (req, app) => {
  const idToken = readBearerToken(req)

  if (!idToken) {
    throw new HttpError(401, '관리자 인증 토큰이 필요합니다.')
  }

  let decodedToken

  try {
    decodedToken = await getAuth(app).verifyIdToken(idToken)
  } catch (error) {
    throw new HttpError(401, '관리자 인증 토큰이 유효하지 않습니다.')
  }

  const adminDoc = await getFirestore(app).collection('adminUsers').doc(decodedToken.uid).get()

  const isAdmin =
    adminDoc.exists && (adminDoc.data()?.isAdmin === true || adminDoc.data()?.isStaff === true)

  if (!isAdmin) {
    throw new HttpError(403, '관리자 권한이 없습니다.')
  }

  return {
    uid: decodedToken.uid,
    email: decodedToken.email ?? '',
  }
}

const createPowerlinkToken = (keyword, secret) => {
  const key = createHash('sha256').update(secret).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(keyword, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}

export default async function handler(req, res) {
  const allowedOrigin = toTrimmedString(process.env.CORS_ALLOW_ORIGIN) || '*'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      message: 'POST 요청만 허용됩니다.',
    })
  }

  try {
    const app = getFirebaseApp()
    const requester = await assertAdminRequester(req, app)
    const body = toRequestBody(req.body)

    const keyword = toTrimmedString(body.keyword)
    const providedBaseUrl = toTrimmedString(body.baseUrl)
    const secret = toTrimmedString(process.env.POWERLINK_URL_SECRET)

    if (!secret) {
      throw new HttpError(500, 'POWERLINK_URL_SECRET 환경변수를 설정해주세요.')
    }

    if (!keyword) {
      throw new HttpError(400, '키워드를 입력해주세요.')
    }

    if (keyword.length > LIMITS.keyword) {
      throw new HttpError(400, `키워드는 ${LIMITS.keyword}자 이하로 입력해주세요.`)
    }

    if (providedBaseUrl.length > LIMITS.baseUrl) {
      throw new HttpError(400, 'baseUrl 길이가 너무 깁니다.')
    }

    const prefix = normalizePrefix(process.env.POWERLINK_PATH_PREFIX ?? '/p/')
    const token = createPowerlinkToken(keyword, secret)
    const path = `${prefix}${token}`
    const resolvedBaseUrl = ensureBaseUrl(providedBaseUrl || process.env.POWERLINK_BASE_URL)
    const url = resolvedBaseUrl
      ? new URL(path.replace(/^\//, ''), resolvedBaseUrl).toString()
      : path

    return res.status(200).json({
      ok: true,
      keyword,
      token,
      path,
      url,
      generatedBy: requester.uid,
    })
  } catch (error) {
    console.error('[api/powerlink/generate] error', error)

    if (error instanceof HttpError) {
      return res.status(error.status).json({
        ok: false,
        message: error.message,
      })
    }

    return res.status(500).json({
      ok: false,
      message: '파워링크 URL 생성 중 오류가 발생했습니다.',
    })
  }
}
