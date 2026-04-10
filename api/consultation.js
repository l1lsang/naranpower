import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { google } from 'googleapis'
import { createDecipheriv, createHash } from 'node:crypto'

const LIMITS = {
  name: 60,
  phone: 40,
  details: 4000,
  source: 80,
  pagePath: 300,
  landingPath: 300,
  landingToken: 600,
  landingKeyword: 120,
  queryString: 800,
  userAgent: 500,
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

const decodePowerlinkKeyword = (token) => {
  const normalizedToken = toTrimmedString(token)
  const secret = toTrimmedString(process.env.POWERLINK_URL_SECRET)

  if (!normalizedToken || !secret) {
    return ''
  }

  try {
    const payloadBuffer = Buffer.from(normalizedToken, 'base64url')

    if (payloadBuffer.length <= 28) {
      return ''
    }

    const iv = payloadBuffer.subarray(0, 12)
    const authTag = payloadBuffer.subarray(12, 28)
    const encrypted = payloadBuffer.subarray(28)
    const key = createHash('sha256').update(secret).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, iv)

    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8').trim()
    return decrypted.slice(0, LIMITS.landingKeyword)
  } catch (error) {
    return ''
  }
}

const validateConsultationPayload = (payload) => {
  const name = toTrimmedString(payload.name)
  const phone = toTrimmedString(payload.phone)
  const details = toTrimmedString(payload.details)
  const source = toTrimmedString(payload.source) || 'website-quick-form'
  const pagePath = toTrimmedString(payload.pagePath) || '#/'
  const landingPath = toTrimmedString(payload.landingPath) || '/'
  const landingToken = toTrimmedString(payload.landingToken)
  const queryString = toTrimmedString(payload.queryString)
  const userAgent = toTrimmedString(payload.userAgent)
  const landingKeyword = decodePowerlinkKeyword(landingToken)

  if (!name || !phone || !details) {
    throw new HttpError(400, '이름, 연락처, 피해 내용을 모두 입력해주세요.')
  }

  if (name.length > LIMITS.name) {
    throw new HttpError(400, `이름은 ${LIMITS.name}자 이하로 입력해주세요.`)
  }

  if (phone.length > LIMITS.phone) {
    throw new HttpError(400, `연락처는 ${LIMITS.phone}자 이하로 입력해주세요.`)
  }

  if (details.length > LIMITS.details) {
    throw new HttpError(400, `피해 내용은 ${LIMITS.details}자 이하로 입력해주세요.`)
  }

  if (source.length > LIMITS.source) {
    throw new HttpError(400, '접수 출처(source) 길이가 너무 깁니다.')
  }

  if (pagePath.length > LIMITS.pagePath) {
    throw new HttpError(400, '경로(pagePath) 길이가 너무 깁니다.')
  }

  if (landingPath.length > LIMITS.landingPath) {
    throw new HttpError(400, '랜딩 경로(landingPath) 길이가 너무 깁니다.')
  }

  if (landingToken.length > LIMITS.landingToken) {
    throw new HttpError(400, '랜딩 토큰(landingToken) 길이가 너무 깁니다.')
  }

  if (queryString.length > LIMITS.queryString) {
    throw new HttpError(400, '쿼리 문자열(queryString) 길이가 너무 깁니다.')
  }

  if (userAgent.length > LIMITS.userAgent) {
    throw new HttpError(400, '사용자 정보(userAgent) 길이가 너무 깁니다.')
  }

  return {
    name,
    phone,
    details,
    source,
    pagePath,
    landingPath,
    landingToken,
    landingKeyword,
    queryString,
    userAgent,
  }
}

const buildTelegramMessage = (request) => {
  const details = request.details.length > 1500 ? `${request.details.slice(0, 1500)}...` : request.details
  const landingToken =
    request.landingToken.length > 160
      ? `${request.landingToken.slice(0, 160)}...`
      : request.landingToken

  return [
    '[빠른상담 신규 접수]',
    `ID: ${request.requestId}`,
    `접수시각(KST): ${request.createdAtKst}`,
    `이름: ${request.name}`,
    `연락처: ${request.phone}`,
    `출처: ${request.source}`,
    `랜딩경로: ${request.landingPath}`,
    `토큰: ${landingToken || '-'}`,
    `키워드(복호화): ${request.landingKeyword || '-'}`,
    `해시경로: ${request.pagePath}`,
    `쿼리: ${request.queryString || '-'}`,
    '',
    '피해 내용',
    details,
  ].join('\n')
}

const toErrorMessage = (error) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return '알 수 없는 오류가 발생했습니다.'
}

const sendTelegramAlert = async (request) => {
  const botToken = toTrimmedString(process.env.TELEGRAM_BOT_TOKEN)
  const chatId = toTrimmedString(process.env.TELEGRAM_CHAT_ID)

  if (!botToken || !chatId) {
    return {
      success: false,
      skipped: true,
      message: 'TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 없어 전송을 건너뜁니다.',
    }
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramMessage(request),
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const responseText = await response.text()
    throw new Error(`텔레그램 전송 실패: ${response.status} ${responseText}`)
  }

  return {
    success: true,
    skipped: false,
    message: '텔레그램 전송 완료',
  }
}

const appendGoogleSheet = async (request) => {
  const spreadsheetId = toTrimmedString(process.env.GOOGLE_SHEET_ID)
  const sheetName = toTrimmedString(process.env.GOOGLE_SHEET_NAME) || 'Sheet1'
  const serviceAccount = parseJsonEnv('GOOGLE_SERVICE_ACCOUNT_JSON')

  if (!spreadsheetId || !serviceAccount) {
    return {
      success: false,
      skipped: true,
      message: 'GOOGLE_SHEET_ID 또는 GOOGLE_SERVICE_ACCOUNT_JSON이 없어 전송을 건너뜁니다.',
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const sheets = google.sheets({
    version: 'v4',
    auth,
  })

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:L`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          request.createdAtKst,
          request.requestId,
          request.name,
          request.phone,
          request.details,
          request.source,
          request.landingPath,
          request.landingToken,
          request.landingKeyword,
          request.pagePath,
          request.queryString,
          request.userAgent,
          'stored-via-vercel-api',
        ],
      ],
    },
  })

  return {
    success: true,
    skipped: false,
    message: 'Google Sheets 전송 완료',
  }
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

export default async function handler(req, res) {
  const allowedOrigin = toTrimmedString(process.env.CORS_ALLOW_ORIGIN) || '*'
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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
    const db = getFirestore(app)
    const body = toRequestBody(req.body)
    const payload = validateConsultationPayload(body)
    const createdAt = new Date()
    const createdAtKst = createdAt.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour12: false,
    })

    const docRef = await db.collection('consultationRequests').add({
      name: payload.name,
      phone: payload.phone,
      details: payload.details,
      source: payload.source,
      pagePath: payload.pagePath,
      landingPath: payload.landingPath,
      landingToken: payload.landingToken,
      landingKeyword: payload.landingKeyword,
      queryString: payload.queryString,
      userAgent: payload.userAgent,
      createdAt: FieldValue.serverTimestamp(),
      createdAtClient: createdAt.toISOString(),
      status: 'received',
    })

    const request = {
      ...payload,
      requestId: docRef.id,
      createdAtKst,
    }

    const [sheetOutcome, telegramOutcome] = await Promise.allSettled([
      appendGoogleSheet(request),
      sendTelegramAlert(request),
    ])

    const sheetResult =
      sheetOutcome.status === 'fulfilled'
        ? sheetOutcome.value
        : {
            success: false,
            skipped: false,
            message: toErrorMessage(sheetOutcome.reason),
          }

    const telegramResult =
      telegramOutcome.status === 'fulfilled'
        ? telegramOutcome.value
        : {
            success: false,
            skipped: false,
            message: toErrorMessage(telegramOutcome.reason),
          }

    await docRef.set(
      {
        delivery: {
          googleSheets: sheetResult,
          telegram: telegramResult,
          syncedAt: FieldValue.serverTimestamp(),
          allSucceeded: sheetResult.success && telegramResult.success,
        },
      },
      { merge: true },
    )

    return res.status(200).json({
      ok: true,
      id: docRef.id,
      forwarded: {
        googleSheets: sheetResult.success,
        telegram: telegramResult.success,
      },
    })
  } catch (error) {
    console.error('[api/consultation] error', error)

    if (error instanceof HttpError) {
      return res.status(error.status).json({
        ok: false,
        message: error.message,
      })
    }

    return res.status(500).json({
      ok: false,
      message: '상담 접수 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    })
  }
}
