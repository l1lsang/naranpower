import { type CSSProperties, type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import heroImg from './assets/hero.png'
import i1Img from './assets/i1.png'
import i2Img from './assets/i2.png'
import roll1Img from './assets/roll1.png'
import roll2Img from './assets/roll2.png'
import roll3Img from './assets/roll3.png'
import roll4Img from './assets/roll4.png'
import picImg from './assets/pic.png'
import icon1Img from './assets/icon1.png'
import icon2Img from './assets/icon2.png'
import icon3Img from './assets/icon3.png'
import icon4Img from './assets/icon4.png'
import ssImg from './assets/ss.png'
import logoImg from './assets/logo.png'
import kakaoIconImg from './assets/kakao.png'
import law1Img from './assets/law1.png'
import law2Img from './assets/law2.png'
import law3Img from './assets/law3.png'
import bannerImg from './assets/banner.png'
import { auth, db, isFirebaseConfigured, storage } from './firebase'
import './App.css'

type PageRoute = 'home' | 'lawyers' | 'companies'
type AuthViewMode = 'login' | 'signup'

type RollingCase = {
  id: string
  category: string
  title: string
  result: string
  image: string
}

type CompanyCase = {
  id: string
  name: string
  service: string
  description: string
  image: string
}

type PowerlinkLink = {
  id: string
  keyword: string
  token: string
  url: string
}

type LawyerProfile = {
  name: string
  role: string
  specialty: string
  headline: string[]
  history: string[]
  image: string
  imageAlt: string
  reverse?: boolean
}

const ADMIN_INVITE_CODE = (
  import.meta.env.VITE_ADMIN_INVITE_CODE ??
  import.meta.env.VITE_STAFF_INVITE_CODE ??
  ''
).trim()

const CONSULTATION_API_URL = (import.meta.env.VITE_CONSULTATION_API_URL ?? '').trim()
const POWERLINK_GENERATE_API_URL = (import.meta.env.VITE_POWERLINK_GENERATE_API_URL ?? '').trim()
const KAKAO_OPEN_CHAT_URL = 'http://pf.kakao.com/_txdqSn/chat'
const CONTACT_PHONE_NUMBER = '1551-7203'
const CONTACT_PHONE_TEL = `tel:${CONTACT_PHONE_NUMBER.replace(/[^0-9+]/g, '')}`
const HERO_TYPING_TEXT = '나란에서 해결할 수 없다면\n그\u00A0어디서도\u00A0해결할\u00A0수\u00A0없습니다.'
const HERO_STAT_ITEMS = [
  { label: '누적 상담건수', value: 36489 },
  { label: '누적 해결 건수', value: 999 },
  { label: '일 평균 상담건수', value: 146 },
] as const

const normalizePowerlinkPathPrefix = (prefix: string): string => {
  const trimmed = prefix.trim()

  if (!trimmed) {
    return '/p/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const POWERLINK_PATH_PREFIX = normalizePowerlinkPathPrefix(
  import.meta.env.VITE_POWERLINK_PATH_PREFIX ?? '/p/',
)

const getPowerlinkTokenFromPath = (pathname: string): string => {
  const normalizedPathname = pathname.trim()

  if (!normalizedPathname) {
    return ''
  }

  const safePathname = normalizedPathname.startsWith('/') ? normalizedPathname : `/${normalizedPathname}`
  const lowerPathname = safePathname.toLowerCase()
  const lowerPrefix = POWERLINK_PATH_PREFIX.toLowerCase()

  if (!lowerPathname.startsWith(lowerPrefix)) {
    return ''
  }

  const rawToken = safePathname.slice(POWERLINK_PATH_PREFIX.length).split('/')[0] ?? ''

  try {
    return decodeURIComponent(rawToken).trim()
  } catch (error) {
    return rawToken.trim()
  }
}

const ROUTE_PATHS: Record<PageRoute, string> = {
  home: '/',
  lawyers: '/lawyers',
  companies: '/companies',
}

const normalizePathname = (pathname: string): string => {
  const trimmed = pathname.trim()

  if (!trimmed) {
    return '/'
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')
  return withoutTrailingSlash || '/'
}

const resolveRoute = (pathname: string): PageRoute => {
  const cleaned = normalizePathname(pathname).toLowerCase()

  if (cleaned === ROUTE_PATHS.lawyers) {
    return 'lawyers'
  }

  if (cleaned === ROUTE_PATHS.companies) {
    return 'companies'
  }

  return 'home'
}

const resolveLegacyHashRoute = (hash: string): PageRoute | null => {
  const rawHash = hash.trim()

  if (!rawHash) {
    return null
  }

  const cleaned = rawHash.replace(/^#/, '').trim().toLowerCase()

  if (!cleaned || cleaned === '/') {
    return 'home'
  }

  if (cleaned === '/lawyers' || cleaned === 'lawyers') {
    return 'lawyers'
  }

  if (cleaned === '/companies' || cleaned === 'companies') {
    return 'companies'
  }

  return null
}

const getRoutePath = (route: PageRoute): string => ROUTE_PATHS[route]

const defaultRollingCases: RollingCase[] = [
  {
    id: 'default-1',
    category: '민사',
    title: '음주운전 상해',
    result: '집행유예',
    image: roll1Img,
  },
  {
    id: 'default-2',
    category: '음주운전',
    title: '음주측정 거부',
    result: '혐의없음',
    image: roll2Img,
  },
  {
    id: 'default-3',
    category: '형사',
    title: '1심 징역형 무면허 음주',
    result: '집행유예',
    image: roll3Img,
  },
  {
    id: 'default-4',
    category: '형사',
    title: '준강간 구속영장 청구',
    result: '영장기각',
    image: roll4Img,
  },
]

const activeScamCases = [
  {
    tag: '나란에서 진행중인 사건 1',
    title: '주식/코인 사기',
    description: '거래소 사칭, 블록딜, 비상장, 리딩방 해외선물, 공모주 사기 등',
    icon: icon1Img,
  },
  {
    tag: '나란에서 진행중인 사건 2',
    title: '부업 사기',
    description: '틱톡 영상 수수료, 영화 리뷰 여행사 티켓, 쇼핑몰 창업, 별풍선 등',
    icon: icon2Img,
  },
  {
    tag: '나란에서 진행중인 사건 3',
    title: '로또 환불 사기',
    description: '로또회사 개인정보 유출된 건을 코인으로 환급해준대며 접근',
    icon: icon3Img,
  },
  {
    tag: '나란에서 진행중인 사건 4',
    title: '각종 투자사기',
    description: '쇼핑몰 구매대행, 로맨스스캠, 미술품 투자 금 투자 등 각종 투자사기',
    icon: icon4Img,
  },
]

const reviewCards = [
  {
    lines: [
      '매우 만족스러웠습니다.',
      '전문성 높은 변호사의 친절한',
      '상담과 신속한 문제해결로',
      '안도감을 느낄 수 있었습니다.',
    ],
  },
  {
    lines: [
      '나란에서 상담받고 불안감이',
      '많이 해소되었고,',
      '서지원변호사님의 신속하고',
      '효율적인 업무처리와 친절한',
      '대응으로 문제를 해결할 수',
      '있었습니다.',
    ],
  },
  {
    lines: [
      '두렵고 걱정이 많았는데,',
      '나란법무법인의 빠른 대응과',
      '탁월한 커뮤니케이션 덕분에',
      '좋게 해결되었고, 좋은 결과를',
      '얻게 되어 감사드립니다.',
    ],
  },
]

const companyPlaceholders = Array.from({ length: 12 })

const lawyerProfiles: LawyerProfile[] = [
  {
    name: '서지원 대표변호사',
    role: '',
    specialty: '형사 부동산 전문',
    headline: ['고객의 입장에서 생각하는', '전문 변호사'],
    history: [
      '서울도봉경찰서 경미범죄 심사위원회 위원',
      '서울강북경찰서 경미범죄 심사위원회 위원',
      '경기 분당경찰서 법률상담변호사',
      '서울시 암사동 마을변호사',
      '인천 본부 세관 관세심사위원회 위원',
    ],
    image: law1Img,
    imageAlt: '서지원 대표변호사',
  },
  {
    name: '최지연 변호사',
    role: '',
    specialty: '형사 부동산 전문',
    headline: ['이혼, 재산분할, 양육권 청구 등 소송', '건설 부동산 등 민사 사건'],
    history: [
      '(前) 법률사무소 나란',
      '(現) 법무법인 나란',
      '서울도봉경찰서 경미범죄 심사위원회 위원',
      '서울강북경찰서 경미범죄 심사위원회 위원',
    ],
    image: law2Img,
    imageAlt: '최지연 변호사',
    reverse: true,
  },
  {
    name: '정이든 변호사',
    role: '',
    specialty: '부동산 전문',
    headline: ['대한변협 인증 부동산', '전문변호사'],
    history: [
      '(前) 법무법인 정의 (2020~2022)',
      '(前) 법무법인(유) 한 (2022~2024)',
      '(現) 법무법인 나란',
    ],
    image: law3Img,
    imageAlt: '정이든 변호사',
  },
]

const toTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const ROLLING_CASE_LIMITS = {
  category: 40,
  title: 120,
  result: 60,
}

const COMPANY_CASE_LIMITS = {
  name: 80,
  service: 80,
  description: 2000,
}

const CONSULTATION_LIMITS = {
  name: 60,
  phone: 40,
  details: 4000,
}

const POWERLINK_KEYWORD_LIMIT = 120

const MAX_IMAGE_UPLOAD_SIZE_MB = 10
const MAX_IMAGE_UPLOAD_SIZE_BYTES = MAX_IMAGE_UPLOAD_SIZE_MB * 1024 * 1024

const getFileExtension = (file: File): string => {
  const fileName = file.name.trim()
  const extensionFromName = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() ?? '' : ''

  if (extensionFromName) {
    return extensionFromName
  }

  const extensionFromType = file.type.split('/')[1]?.toLowerCase() ?? ''
  return extensionFromType || 'jpg'
}

const validateImageFile = (file: File) => {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드할 수 있습니다.')
  }

  if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    throw new Error(`이미지 파일은 ${MAX_IMAGE_UPLOAD_SIZE_MB}MB 이하만 업로드할 수 있습니다.`)
  }
}

const uploadCaseImage = async (params: {
  file: File
  user: User
  bucketFolder: 'rollingCases' | 'companyCases'
}) => {
  const { file, user, bucketFolder } = params
  validateImageFile(file)

  const fileExtension = getFileExtension(file)
  const uniqueKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const filePath = `${bucketFolder}/${user.uid}/${uniqueKey}.${fileExtension}`
  const uploadedFileRef = storageRef(storage, filePath)

  await uploadBytes(uploadedFileRef, file, {
    contentType: file.type || undefined,
  })

  return getDownloadURL(uploadedFileRef)
}

const deleteCaseImageIfManaged = async (imageUrl: string) => {
  const normalizedImageUrl = imageUrl.trim()

  if (
    !normalizedImageUrl ||
    (!normalizedImageUrl.startsWith('gs://') &&
      !normalizedImageUrl.includes('firebasestorage.googleapis.com'))
  ) {
    return false
  }

  await deleteObject(storageRef(storage, normalizedImageUrl))
  return true
}

const toUploadErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (error instanceof FirebaseError) {
    if (error.code === 'storage/unauthorized') {
      return '스토리지 업로드 권한이 없습니다. Firebase Storage Rules를 확인해주세요.'
    }

    if (error.code === 'storage/quota-exceeded') {
      return '스토리지 용량 한도를 초과했습니다. Firebase 요금제/용량을 확인해주세요.'
    }

    if (error.code === 'storage/canceled') {
      return '이미지 업로드가 취소되었습니다.'
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}

const toAuthErrorMessage = (error: unknown): string => {
  if (!(error instanceof FirebaseError)) {
    return '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
  }

  switch (error.code) {
    case 'auth/invalid-email':
      return '이메일 형식이 올바르지 않습니다.'
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return '이메일 또는 비밀번호가 올바르지 않습니다.'
    case 'auth/email-already-in-use':
      return '이미 사용 중인 이메일입니다.'
    case 'auth/weak-password':
      return '비밀번호는 6자 이상으로 입력해주세요.'
    case 'auth/too-many-requests':
      return '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.'
    default:
      return '인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
  }
}

function App() {
  const [route, setRoute] = useState<PageRoute>(() => resolveRoute(window.location.pathname))
  const rollingTrackRef = useRef<HTMLDivElement | null>(null)
  const rollingImageInputRef = useRef<HTMLInputElement | null>(null)
  const companyImageInputRef = useRef<HTMLInputElement | null>(null)
  const quickFormSectionRef = useRef<HTMLElement | null>(null)
  const heroStatsBarRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollToQuickFormRef = useRef(false)
  const adminEnrollmentInProgressRef = useRef(false)

  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState<AuthViewMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [passwordResetBusy, setPasswordResetBusy] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [isStaffCheckPending, setIsStaffCheckPending] = useState(isFirebaseConfigured)

  const [rollingCases, setRollingCases] = useState<RollingCase[]>([])
  const [companyCases, setCompanyCases] = useState<CompanyCase[]>([])
  const [powerlinkLinks, setPowerlinkLinks] = useState<PowerlinkLink[]>([])

  const [adminOpen, setAdminOpen] = useState(false)
  const [adminNotice, setAdminNotice] = useState('')
  const [adminError, setAdminError] = useState('')

  const [rollingCategoryInput, setRollingCategoryInput] = useState('')
  const [rollingTitleInput, setRollingTitleInput] = useState('')
  const [rollingResultInput, setRollingResultInput] = useState('')
  const [rollingImageFile, setRollingImageFile] = useState<File | null>(null)
  const [rollingUploadBusy, setRollingUploadBusy] = useState(false)

  const [companyNameInput, setCompanyNameInput] = useState('')
  const [companyServiceInput, setCompanyServiceInput] = useState('')
  const [companyDescriptionInput, setCompanyDescriptionInput] = useState('')
  const [companyImageFile, setCompanyImageFile] = useState<File | null>(null)
  const [companyUploadBusy, setCompanyUploadBusy] = useState(false)

  const [consultationNameInput, setConsultationNameInput] = useState('')
  const [consultationPhoneInput, setConsultationPhoneInput] = useState('')
  const [consultationDetailsInput, setConsultationDetailsInput] = useState('')
  const [consultationBusy, setConsultationBusy] = useState(false)
  const [consultationNotice, setConsultationNotice] = useState('')
  const [consultationError, setConsultationError] = useState('')

  const [powerlinkKeywordInput, setPowerlinkKeywordInput] = useState('')
  const [powerlinkGenerateBusy, setPowerlinkGenerateBusy] = useState(false)
  const [heroTypedText, setHeroTypedText] = useState('')
  const [heroStatValues, setHeroStatValues] = useState<number[]>(() => HERO_STAT_ITEMS.map(() => 0))
  const [heroStatsShouldAnimate, setHeroStatsShouldAnimate] = useState(false)

  const landingPath = window.location.pathname || '/'
  const landingToken = useMemo(() => getPowerlinkTokenFromPath(landingPath), [landingPath])
  const landingPowerlinkKeyword = useMemo(() => {
    if (!landingToken) {
      return ''
    }

    const matchedLink = powerlinkLinks.find((item) => item.token === landingToken)
    return matchedLink?.keyword ?? ''
  }, [landingToken, powerlinkLinks])

  const displayRollingCases = rollingCases.length > 0 ? rollingCases : defaultRollingCases
  const rollingLoopCases = useMemo(
    () => [...displayRollingCases, ...displayRollingCases, ...displayRollingCases],
    [displayRollingCases],
  )

  useEffect(() => {
    const legacyRoute = resolveLegacyHashRoute(window.location.hash)

    if (legacyRoute) {
      const legacyPath = getRoutePath(legacyRoute)
      const currentPath = normalizePathname(window.location.pathname)

      if (currentPath !== legacyPath) {
        window.history.replaceState({}, '', `${legacyPath}${window.location.search}`)
      }

      setRoute(legacyRoute)
    }

    const handlePopState = () => {
      setRoute(resolveRoute(window.location.pathname))
      window.scrollTo({ top: 0 })
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (route !== 'home' || !shouldScrollToQuickFormRef.current) {
      return
    }

    shouldScrollToQuickFormRef.current = false

    const frameId = window.requestAnimationFrame(() => {
      quickFormSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [route])

  useEffect(() => {
    if (route !== 'home') {
      setHeroTypedText(HERO_TYPING_TEXT)
      return
    }

    let timeoutId = 0
    let typingIndex = 0
    setHeroTypedText('')

    const typeNextCharacter = () => {
      typingIndex += 1
      setHeroTypedText(HERO_TYPING_TEXT.slice(0, typingIndex))

      if (typingIndex >= HERO_TYPING_TEXT.length) {
        return
      }

      const currentCharacter = HERO_TYPING_TEXT[typingIndex - 1]
      const nextDelay = currentCharacter === '\n' ? 420 : currentCharacter === ' ' ? 65 : 105
      timeoutId = window.setTimeout(typeNextCharacter, nextDelay)
    }

    timeoutId = window.setTimeout(typeNextCharacter, 340)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [route])

  useEffect(() => {
    if (route !== 'home') {
      setHeroStatsShouldAnimate(false)
      setHeroStatValues(HERO_STAT_ITEMS.map(() => 0))
      return
    }

    setHeroStatsShouldAnimate(false)
    setHeroStatValues(HERO_STAT_ITEMS.map(() => 0))
    const statsBarElement = heroStatsBarRef.current

    if (!statsBarElement) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting)

        if (!isVisible) {
          return
        }

        setHeroStatsShouldAnimate(true)
        observer.disconnect()
      },
      {
        threshold: 0.42,
        rootMargin: '0px 0px -6% 0px',
      },
    )

    observer.observe(statsBarElement)

    return () => {
      observer.disconnect()
    }
  }, [route])

  useEffect(() => {
    if (route !== 'home' || !heroStatsShouldAnimate) {
      return
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      setHeroStatValues(HERO_STAT_ITEMS.map((item) => item.value))
      return
    }

    let frameId = 0
    let animationStart = 0
    const durationMs = 1900

    const animate = (now: number) => {
      if (!animationStart) {
        animationStart = now
      }

      const progress = Math.min((now - animationStart) / durationMs, 1)
      const eased = 1 - (1 - progress) ** 3
      setHeroStatValues(HERO_STAT_ITEMS.map((item) => Math.round(item.value * eased)))

      if (progress < 1) {
        frameId = window.requestAnimationFrame(animate)
      }
    }

    frameId = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [route, heroStatsShouldAnimate])

  useEffect(() => {
    if (route !== 'home') {
      return
    }

    const trackEl = rollingTrackRef.current

    if (!trackEl) {
      return
    }

    let frameId = 0
    let previousTime = performance.now()
    let positionX = 0
    const speedPxPerSecond = 48
    const gapPx = 18

    trackEl.style.transform = 'translate3d(0, 0, 0)'

    const animate = (now: number) => {
      const delta = Math.min((now - previousTime) / 1000, 0.05)
      previousTime = now

      positionX -= speedPxPerSecond * delta

      let firstCard = trackEl.firstElementChild as HTMLElement | null

      while (firstCard) {
        const firstCardWidthWithGap = firstCard.getBoundingClientRect().width + gapPx

        if (-positionX < firstCardWidthWithGap) {
          break
        }

        positionX += firstCardWidthWithGap
        trackEl.appendChild(firstCard)
        firstCard = trackEl.firstElementChild as HTMLElement | null
      }

      trackEl.style.transform = `translate3d(${positionX}px, 0, 0)`

      frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(frameId)
      trackEl.style.transform = 'translate3d(0, 0, 0)'
    }
  }, [route, rollingLoopCases])

  useEffect(() => {
    const revealElements = Array.from(
      document.querySelectorAll<HTMLElement>('.reveal-on-scroll'),
    )

    if (!revealElements.length) {
      return
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      revealElements.forEach((element) => element.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.14,
        rootMargin: '0px 0px -8% 0px',
      },
    )

    revealElements.forEach((element) => observer.observe(element))

    return () => {
      observer.disconnect()
    }
  }, [route, adminOpen, displayRollingCases.length, companyCases.length, powerlinkLinks.length])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setIsStaffCheckPending(false)
      return
    }

    let active = true

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) {
        return
      }

      setCurrentUser(user)

      if (!user) {
        setIsStaff(false)
        setIsStaffCheckPending(false)
        return
      }

      setIsStaffCheckPending(true)

      try {
        const [adminSnapshot, legacyStaffSnapshot] = await Promise.all([
          getDoc(doc(db, 'adminUsers', user.uid)),
          getDoc(doc(db, 'staffUsers', user.uid)),
        ])

        if (!active) {
          return
        }

        const hasAdminRole =
          adminSnapshot.exists() &&
          (Boolean(adminSnapshot.data().isAdmin) || Boolean(adminSnapshot.data().isStaff))

        const hasLegacyStaffRole =
          legacyStaffSnapshot.exists() &&
          (Boolean(legacyStaffSnapshot.data().isStaff) || Boolean(legacyStaffSnapshot.data().isAdmin))

        const isStaffAccount = hasAdminRole || hasLegacyStaffRole

        if (isStaffAccount) {
          setIsStaff(true)
          setAdminOpen(true)
          setAuthError('')
          setAuthNotice('')
          adminEnrollmentInProgressRef.current = false

          if (!hasAdminRole && hasLegacyStaffRole) {
            try {
              await setDoc(
                doc(db, 'adminUsers', user.uid),
                {
                  email: user.email ?? '',
                  isAdmin: true,
                  isStaff: true,
                  migratedFrom: 'staffUsers',
                  ...(adminSnapshot.exists() ? {} : { createdAt: serverTimestamp() }),
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              )
            } catch (migrationError) {
              console.warn('adminUsers 마이그레이션을 건너뜁니다.', migrationError)
            }
          }
        } else if (adminEnrollmentInProgressRef.current) {
          setIsStaff(false)
          setAuthNotice('초대코드 확인 후 관리자 승인 중입니다...')
        } else {
          setIsStaff(false)
          setAdminOpen(false)
          setAuthError('관리자 계정만 로그인할 수 있습니다.')
          setShowAuthModal(true)
          await signOut(auth)
        }
      } catch (error) {
        console.error(error)

        if (!active) {
          return
        }

        setIsStaff(false)
        setAuthError('관리자 권한 확인 중 오류가 발생했습니다.')
      } finally {
        if (active) {
          setIsStaffCheckPending(false)
        }
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setRollingCases([])
      return
    }

    const rollingCasesQuery = query(collection(db, 'rollingCases'), orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(
      rollingCasesQuery,
      (snapshot) => {
        const mappedCases = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data()
            const category = toTrimmedString(data.category)
            const title = toTrimmedString(data.title)
            const result = toTrimmedString(data.result)
            const image = toTrimmedString(data.image) || toTrimmedString(data.imageUrl)

            if (!category || !title || !result || !image) {
              return null
            }

            return {
              id: snapshotDoc.id,
              category,
              title,
              result,
              image,
            }
          })
          .filter((item): item is RollingCase => item !== null)

        setRollingCases(mappedCases)
      },
      (error) => {
        console.error(error)
        setRollingCases([])
      },
    )

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return
    }

    const powerlinkLinksQuery = query(collection(db, 'powerlinkLinks'), orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(
      powerlinkLinksQuery,
      (snapshot) => {
        const mappedLinks = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data()
            const keyword = toTrimmedString(data.keyword)
            const token = toTrimmedString(data.token)
            const url = toTrimmedString(data.url)

            if (!keyword || !token || !url) {
              return null
            }

            return {
              id: snapshotDoc.id,
              keyword,
              token,
              url,
            }
          })
          .filter((item): item is PowerlinkLink => item !== null)

        setPowerlinkLinks(mappedLinks)
      },
      (error) => {
        console.error(error)
        setPowerlinkLinks([])
      },
    )

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured) {
      return
    }

    const companyCasesQuery = query(collection(db, 'companyCases'), orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(
      companyCasesQuery,
      (snapshot) => {
        const mappedCases = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data()
            const name = toTrimmedString(data.name)
            const service = toTrimmedString(data.service)
            const description = toTrimmedString(data.description)
            const image = toTrimmedString(data.image) || toTrimmedString(data.imageUrl)

            if (!name || !service || !description || !image) {
              return null
            }

            return {
              id: snapshotDoc.id,
              name,
              service,
              description,
              image,
            }
          })
          .filter((item): item is CompanyCase => item !== null)

        setCompanyCases(mappedCases)
      },
      (error) => {
        console.error(error)
        setCompanyCases([])
      },
    )

    return () => {
      unsubscribe()
    }
  }, [])

  const clearAdminFeedback = () => {
    setAdminNotice('')
    setAdminError('')
  }

  const openAuthModal = (mode: AuthViewMode) => {
    setAuthMode(mode)
    setAuthError('')
    setAuthNotice('')
    setInviteCode('')
    setShowAuthModal(true)
  }

  const closeAuthModal = () => {
    if (authBusy || passwordResetBusy) {
      return
    }

    setShowAuthModal(false)
    setAuthError('')
    setAuthNotice('')
    setAuthPassword('')
    setInviteCode('')
  }

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const email = authEmail.trim()
    const enteredInviteCode = inviteCode.trim()
    const shouldEnrollWithInvite = authMode === 'signup'

    if (!isFirebaseConfigured) {
      setAuthError('Firebase 환경 변수가 설정되지 않았습니다. .env 파일 설정 후 다시 시도해주세요.')
      return
    }

    if (!email || !authPassword) {
      setAuthError('이메일과 비밀번호를 모두 입력해주세요.')
      return
    }

    if (authPassword.length < 6) {
      setAuthError('비밀번호는 6자 이상이어야 합니다.')
      return
    }

    if (shouldEnrollWithInvite) {
      if (!ADMIN_INVITE_CODE) {
        setAuthError(
          '관리자 회원가입을 사용하려면 VITE_ADMIN_INVITE_CODE(또는 기존 VITE_STAFF_INVITE_CODE)를 설정해야 합니다.',
        )
        return
      }

      if (enteredInviteCode !== ADMIN_INVITE_CODE) {
        setAuthError('관리자 초대코드가 올바르지 않습니다.')
        return
      }
    }

    setAuthBusy(true)
    setAuthError('')
    setAuthNotice('')

    let startedAdminEnrollment = false
    let adminEnrollmentWriteFailed = false

    try {
      let credential

      if (authMode === 'signup') {
        adminEnrollmentInProgressRef.current = true
        startedAdminEnrollment = true
        credential = await createUserWithEmailAndPassword(auth, email, authPassword)
      } else {
        credential = await signInWithEmailAndPassword(auth, email, authPassword)
      }

      if (shouldEnrollWithInvite) {
        try {
          await setDoc(
            doc(db, 'adminUsers', credential.user.uid),
            {
              email: credential.user.email ?? email,
              isAdmin: true,
              isStaff: true,
              approvedByInviteCode: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        } catch (error) {
          console.error(error)
          adminEnrollmentWriteFailed = true
          throw error
        }

        setCurrentUser(credential.user)
        setIsStaff(true)
        setAdminOpen(true)
        setAdminError('')
        setAdminNotice('관리자 초대코드 승인 완료')
        setAuthNotice('관리자 승인 완료. 관리자 페이지를 열었습니다.')
      }

      setShowAuthModal(false)
      setAuthPassword('')
      setInviteCode('')
    } catch (error) {
      if (startedAdminEnrollment && auth.currentUser) {
        try {
          await signOut(auth)
        } catch (signOutError) {
          console.error(signOutError)
        }
      }

      if (adminEnrollmentWriteFailed) {
        setAuthError('초대코드는 확인되었지만 관리자 승인 저장에 실패했습니다. Firestore 규칙을 확인해주세요.')
      } else {
        setAuthError(toAuthErrorMessage(error))
      }
    } finally {
      adminEnrollmentInProgressRef.current = false
      setAuthBusy(false)
    }
  }

  const handlePasswordReset = async () => {
    const email = authEmail.trim()

    if (!isFirebaseConfigured) {
      setAuthNotice('')
      setAuthError('Firebase 환경 변수가 설정되지 않았습니다. .env 파일 설정 후 다시 시도해주세요.')
      return
    }

    if (!email) {
      setAuthNotice('')
      setAuthError('비밀번호를 찾을 이메일을 먼저 입력해주세요.')
      return
    }

    setPasswordResetBusy(true)
    setAuthError('')
    setAuthNotice('')

    try {
      await sendPasswordResetEmail(auth, email)
      setAuthNotice('비밀번호 재설정 메일을 보냈습니다. 메일함(스팸함 포함)을 확인해주세요.')
    } catch (error) {
      if (error instanceof FirebaseError) {
        if (error.code === 'auth/invalid-email') {
          setAuthError('이메일 형식이 올바르지 않습니다.')
        } else if (error.code === 'auth/user-not-found') {
          setAuthError('해당 이메일로 등록된 계정을 찾을 수 없습니다.')
        } else if (error.code === 'auth/too-many-requests') {
          setAuthError('요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.')
        } else {
          setAuthError('비밀번호 재설정 메일 전송 중 오류가 발생했습니다.')
        }
      } else {
        setAuthError('비밀번호 재설정 메일 전송 중 오류가 발생했습니다.')
      }
    } finally {
      setPasswordResetBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (!isFirebaseConfigured) {
      return
    }

    try {
      await signOut(auth)
      setAdminOpen(false)
      setAdminNotice('')
      setAdminError('')
    } catch (error) {
      console.error(error)
      setAuthError('로그아웃 중 오류가 발생했습니다. 다시 시도해주세요.')
      setShowAuthModal(true)
    }
  }

  const navigateToRoute = (nextRoute: PageRoute) => {
    const nextPath = getRoutePath(nextRoute)
    const currentPath = normalizePathname(window.location.pathname)

    if (currentPath !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }

    setRoute(nextRoute)
    window.scrollTo({ top: 0 })
  }

  const isPrimaryNavigationClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
    !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)

  const handleRouteNavigation = (event: MouseEvent<HTMLAnchorElement>, nextRoute: PageRoute) => {
    if (!isPrimaryNavigationClick(event)) {
      return
    }

    event.preventDefault()
    navigateToRoute(nextRoute)
  }

  const moveToQuickFormSection = () => {
    if (route === 'home') {
      quickFormSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
      return
    }

    shouldScrollToQuickFormRef.current = true
    navigateToRoute('home')
  }

  const handleConsultingNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPrimaryNavigationClick(event)) {
      return
    }

    event.preventDefault()
    moveToQuickFormSection()
  }

  const handleConsultationSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setConsultationError('')
    setConsultationNotice('')

    const name = consultationNameInput.trim()
    const phone = consultationPhoneInput.trim()
    const details = consultationDetailsInput.trim()

    if (!name || !phone || !details) {
      setConsultationError('이름, 연락처, 피해 내용을 모두 입력해주세요.')
      return
    }

    if (name.length > CONSULTATION_LIMITS.name) {
      setConsultationError(`이름은 ${CONSULTATION_LIMITS.name}자 이하로 입력해주세요.`)
      return
    }

    if (phone.length > CONSULTATION_LIMITS.phone) {
      setConsultationError(`연락처는 ${CONSULTATION_LIMITS.phone}자 이하로 입력해주세요.`)
      return
    }

    if (details.length > CONSULTATION_LIMITS.details) {
      setConsultationError(`피해 내용은 ${CONSULTATION_LIMITS.details}자 이하로 입력해주세요.`)
      return
    }

    const endpoint = CONSULTATION_API_URL || '/api/consultation'
    setConsultationBusy(true)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          phone,
          details,
          source: landingToken ? 'naver-powerlink' : 'website-quick-form',
          pagePath: getRoutePath(route),
          landingPath,
          landingToken,
          queryString: window.location.search || '',
          userAgent: navigator.userAgent,
        }),
      })

      const responseBody = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null

      if (!response.ok || !responseBody?.ok) {
        const errorMessage = responseBody?.message ?? '접수 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'
        throw new Error(errorMessage)
      }

      setConsultationNameInput('')
      setConsultationPhoneInput('')
      setConsultationDetailsInput('')
      setConsultationNotice('신청이 정상 접수되었습니다. 전담 변호사가 확인 후 빠르게 연락드리겠습니다.')
    } catch (error) {
      console.error(error)
      setConsultationError(error instanceof Error ? error.message : '접수 처리 중 오류가 발생했습니다.')
    } finally {
      setConsultationBusy(false)
    }
  }

  const handleCreatePowerlinkLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearAdminFeedback()

    if (!isStaff || !currentUser) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    const keyword = powerlinkKeywordInput.trim()

    if (!keyword) {
      setAdminError('키워드를 입력해주세요.')
      return
    }

    if (keyword.length > POWERLINK_KEYWORD_LIMIT) {
      setAdminError(`키워드는 ${POWERLINK_KEYWORD_LIMIT}자 이하로 입력해주세요.`)
      return
    }

    const endpoint = POWERLINK_GENERATE_API_URL || '/api/powerlink/generate'
    setPowerlinkGenerateBusy(true)

    try {
      const idToken = await currentUser.getIdToken()
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ keyword }),
      })

      const responseBody = (await response.json().catch(() => null)) as
        | {
            ok?: boolean
            message?: string
            keyword?: string
            token?: string
            url?: string
            path?: string
          }
        | null

      if (!response.ok || !responseBody?.ok || !responseBody.keyword || !responseBody.token || !responseBody.url) {
        const errorMessage = responseBody?.message ?? '파워링크 URL 생성에 실패했습니다.'
        throw new Error(errorMessage)
      }

      await addDoc(collection(db, 'powerlinkLinks'), {
        keyword: responseBody.keyword,
        token: responseBody.token,
        url: responseBody.url,
        ...(responseBody.path ? { path: responseBody.path } : {}),
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      })

      setPowerlinkKeywordInput('')
      setAdminNotice(`파워링크 URL 생성 완료: ${responseBody.url}`)
    } catch (error) {
      console.error(error)
      setAdminError(error instanceof Error ? error.message : '파워링크 URL 생성 중 오류가 발생했습니다.')
    } finally {
      setPowerlinkGenerateBusy(false)
    }
  }

  const handleDeletePowerlinkLink = async (id: string) => {
    clearAdminFeedback()

    if (!isStaff) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    try {
      await deleteDoc(doc(db, 'powerlinkLinks', id))
      setAdminNotice('파워링크 URL 정보를 삭제했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError('파워링크 URL 삭제에 실패했습니다.')
    }
  }

  const handleCopyPowerlinkLink = async (url: string) => {
    clearAdminFeedback()

    try {
      await navigator.clipboard.writeText(url)
      setAdminNotice('파워링크 URL을 복사했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError('클립보드 복사에 실패했습니다.')
    }
  }

  const handleAddRollingCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearAdminFeedback()

    if (!isStaff || !currentUser) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    const category = rollingCategoryInput.trim()
    const title = rollingTitleInput.trim()
    const result = rollingResultInput.trim()
    const imageFile = rollingImageFile

    if (!category || !title || !result || !imageFile) {
      setAdminError('롤링 사례 항목을 모두 입력해주세요.')
      return
    }

    if (category.length > ROLLING_CASE_LIMITS.category) {
      setAdminError(`카테고리는 ${ROLLING_CASE_LIMITS.category}자 이하로 입력해주세요.`)
      return
    }

    if (title.length > ROLLING_CASE_LIMITS.title) {
      setAdminError(`사건명은 ${ROLLING_CASE_LIMITS.title}자 이하로 입력해주세요.`)
      return
    }

    if (result.length > ROLLING_CASE_LIMITS.result) {
      setAdminError(`결과는 ${ROLLING_CASE_LIMITS.result}자 이하로 입력해주세요.`)
      return
    }

    setRollingUploadBusy(true)

    try {
      const image = await uploadCaseImage({
        file: imageFile,
        user: currentUser,
        bucketFolder: 'rollingCases',
      })

      await addDoc(collection(db, 'rollingCases'), {
        category,
        title,
        result,
        image,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      })

      setRollingCategoryInput('')
      setRollingTitleInput('')
      setRollingResultInput('')
      setRollingImageFile(null)
      if (rollingImageInputRef.current) {
        rollingImageInputRef.current.value = ''
      }
      setAdminNotice('홈 롤링 사례를 추가했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError(
        toUploadErrorMessage(error, '롤링 사례 저장에 실패했습니다. Firebase 권한과 연결 상태를 확인해주세요.'),
      )
    } finally {
      setRollingUploadBusy(false)
    }
  }

  const handleDeleteRollingCase = async (id: string, imageUrl: string) => {
    clearAdminFeedback()

    if (!isStaff) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    try {
      await deleteDoc(doc(db, 'rollingCases', id))

      let removedManagedImage = false

      try {
        removedManagedImage = await deleteCaseImageIfManaged(imageUrl)
      } catch (imageDeleteError) {
        console.error(imageDeleteError)
        setAdminNotice('롤링 사례는 삭제했지만 업로드 이미지 삭제는 실패했습니다. Storage Rules를 확인해주세요.')
        return
      }

      setAdminNotice(removedManagedImage ? '롤링 사례와 업로드 이미지를 삭제했습니다.' : '롤링 사례를 삭제했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError('롤링 사례 삭제에 실패했습니다.')
    }
  }

  const handleAddCompanyCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearAdminFeedback()

    if (!isStaff || !currentUser) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    const name = companyNameInput.trim()
    const service = companyServiceInput.trim()
    const description = companyDescriptionInput.trim()
    const imageFile = companyImageFile

    if (!name || !service || !description || !imageFile) {
      setAdminError('사기업체 항목을 모두 입력해주세요.')
      return
    }

    if (name.length > COMPANY_CASE_LIMITS.name) {
      setAdminError(`업체명은 ${COMPANY_CASE_LIMITS.name}자 이하로 입력해주세요.`)
      return
    }

    if (service.length > COMPANY_CASE_LIMITS.service) {
      setAdminError(`유형은 ${COMPANY_CASE_LIMITS.service}자 이하로 입력해주세요.`)
      return
    }

    if (description.length > COMPANY_CASE_LIMITS.description) {
      setAdminError(`설명은 ${COMPANY_CASE_LIMITS.description}자 이하로 입력해주세요.`)
      return
    }

    setCompanyUploadBusy(true)

    try {
      const image = await uploadCaseImage({
        file: imageFile,
        user: currentUser,
        bucketFolder: 'companyCases',
      })

      await addDoc(collection(db, 'companyCases'), {
        name,
        service,
        description,
        image,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
      })

      setCompanyNameInput('')
      setCompanyServiceInput('')
      setCompanyDescriptionInput('')
      setCompanyImageFile(null)
      if (companyImageInputRef.current) {
        companyImageInputRef.current.value = ''
      }
      setAdminNotice('사기업체 정보를 추가했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError(
        toUploadErrorMessage(error, '사기업체 정보 저장에 실패했습니다. Firebase 권한과 연결 상태를 확인해주세요.'),
      )
    } finally {
      setCompanyUploadBusy(false)
    }
  }

  const handleDeleteCompanyCase = async (id: string, imageUrl: string) => {
    clearAdminFeedback()

    if (!isStaff) {
      setAdminError('관리자 로그인 후 이용해주세요.')
      return
    }

    try {
      await deleteDoc(doc(db, 'companyCases', id))

      let removedManagedImage = false

      try {
        removedManagedImage = await deleteCaseImageIfManaged(imageUrl)
      } catch (imageDeleteError) {
        console.error(imageDeleteError)
        setAdminNotice(
          '사기업체 정보는 삭제했지만 업로드 이미지 삭제는 실패했습니다. Storage Rules를 확인해주세요.',
        )
        return
      }

      setAdminNotice(removedManagedImage ? '사기업체 정보와 업로드 이미지를 삭제했습니다.' : '사기업체 정보를 삭제했습니다.')
    } catch (error) {
      console.error(error)
      setAdminError('사기업체 정보 삭제에 실패했습니다.')
    }
  }

  const handleAuthBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeAuthModal()
    }
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <a className="brand" href={getRoutePath('home')} onClick={(event) => handleRouteNavigation(event, 'home')}>
          <img src={heroImg} className="brand-logo" alt="법무법인 나란 로고" />
        </a>

        <nav className="menu" aria-label="주요 메뉴">
          <a
            className={route === 'lawyers' ? 'active' : ''}
            href={getRoutePath('lawyers')}
            onClick={(event) => handleRouteNavigation(event, 'lawyers')}
          >
            변호사소개
          </a>
          <a
            className={route === 'companies' ? 'active' : ''}
            href={getRoutePath('companies')}
            onClick={(event) => handleRouteNavigation(event, 'companies')}
          >
            사기업체
          </a>
          <a href={getRoutePath('home')} onClick={handleConsultingNavigation}>
            온라인상담
          </a>

        </nav>
      </header>

      <main>
        {isStaff && adminOpen && (
          <section className="section-wrap admin-panel reveal-on-scroll" aria-label="관리자 창">
            <div className="admin-panel-head">
              <h2>관리자 창</h2>
              <p>
                로그인 계정: <strong>{currentUser?.email ?? '관리자 계정'}</strong>
              </p>
            </div>

            {adminNotice ? <p className="admin-feedback admin-feedback-success">{adminNotice}</p> : null}
            {adminError ? <p className="admin-feedback admin-feedback-error">{adminError}</p> : null}

            <div className="admin-grid">
              <article className="admin-card">
                <h3>롤링 영역 추가</h3>
                <p>카테고리, 사건명, 결과, 이미지 파일을 업로드하면 홈 롤링에 즉시 반영됩니다.</p>

                <form className="admin-form" onSubmit={handleAddRollingCase}>
                  <label>
                    카테고리
                    <input
                      type="text"
                      value={rollingCategoryInput}
                      onChange={(event) => setRollingCategoryInput(event.target.value)}
                      placeholder="예: 형사"
                      maxLength={ROLLING_CASE_LIMITS.category}
                      required
                    />
                  </label>
                  <label>
                    사건명
                    <input
                      type="text"
                      value={rollingTitleInput}
                      onChange={(event) => setRollingTitleInput(event.target.value)}
                      placeholder="예: 코인 투자사기"
                      maxLength={ROLLING_CASE_LIMITS.title}
                      required
                    />
                  </label>
                  <label>
                    결과
                    <input
                      type="text"
                      value={rollingResultInput}
                      onChange={(event) => setRollingResultInput(event.target.value)}
                      placeholder="예: 전액 회수"
                      maxLength={ROLLING_CASE_LIMITS.result}
                      required
                    />
                  </label>
                  <label>
                    이미지 파일
                    <input
                      ref={rollingImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(event) => setRollingImageFile(event.target.files?.[0] ?? null)}
                      required
                      disabled={rollingUploadBusy}
                    />
                  </label>
                  <button type="submit" disabled={rollingUploadBusy}>
                    {rollingUploadBusy ? '업로드 중...' : '롤링 영역 추가'}
                  </button>
                </form>

                <div className="admin-list-wrap">
                  <h4>등록된 롤링 사례</h4>
                  {rollingCases.length > 0 ? (
                    <ul className="admin-item-list">
                      {rollingCases.map((item) => (
                        <li className="admin-item" key={item.id}>
                          <div>
                            <p>{item.category}</p>
                            <strong>{item.title}</strong>
                            <span>{item.result}</span>
                          </div>
                          <button type="button" onClick={() => handleDeleteRollingCase(item.id, item.image)}>
                            삭제
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-empty">DB에 저장된 롤링 사례가 아직 없습니다.</p>
                  )}
                </div>
              </article>

              <article className="admin-card">
                <h3>사기업체 영역 추가</h3>
                <p>사기업체 페이지에 노출할 정보를 입력하고 이미지 파일을 올리면 카드로 자동 생성됩니다.</p>

                <form className="admin-form" onSubmit={handleAddCompanyCase}>
                  <label>
                    업체명
                    <input
                      type="text"
                      value={companyNameInput}
                      onChange={(event) => setCompanyNameInput(event.target.value)}
                      placeholder="예: A투자 운영조직"
                      maxLength={COMPANY_CASE_LIMITS.name}
                      required
                    />
                  </label>
                  <label>
                    유형
                    <input
                      type="text"
                      value={companyServiceInput}
                      onChange={(event) => setCompanyServiceInput(event.target.value)}
                      placeholder="예: 코인 리딩방 사기"
                      maxLength={COMPANY_CASE_LIMITS.service}
                      required
                    />
                  </label>
                  <label>
                    설명
                    <textarea
                      rows={4}
                      value={companyDescriptionInput}
                      onChange={(event) => setCompanyDescriptionInput(event.target.value)}
                      placeholder="피해유형 또는 진행상태를 입력하세요."
                      maxLength={COMPANY_CASE_LIMITS.description}
                      required
                    />
                  </label>
                  <label>
                    이미지 파일
                    <input
                      ref={companyImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(event) => setCompanyImageFile(event.target.files?.[0] ?? null)}
                      required
                      disabled={companyUploadBusy}
                    />
                  </label>
                  <button type="submit" disabled={companyUploadBusy}>
                    {companyUploadBusy ? '업로드 중...' : '사기업체 영역 추가'}
                  </button>
                </form>

                <div className="admin-list-wrap">
                  <h4>등록된 사기업체 정보</h4>
                  {companyCases.length > 0 ? (
                    <ul className="admin-item-list">
                      {companyCases.map((item) => (
                        <li className="admin-item" key={item.id}>
                          <div>
                            <p>{item.service}</p>
                            <strong>{item.name}</strong>
                            <span>{item.description}</span>
                          </div>
                          <button type="button" onClick={() => handleDeleteCompanyCase(item.id, item.image)}>
                            삭제
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-empty">DB에 저장된 사기업체 정보가 아직 없습니다.</p>
                  )}
                </div>
              </article>

              <article className="admin-card">
                <h3>파워링크 URL 생성</h3>
                <p>키워드를 입력하면 동일한 홈 화면으로 연결되는 암호화 하위 URL을 자동 생성합니다.</p>

                <form className="admin-form" onSubmit={handleCreatePowerlinkLink}>
                  <label>
                    키워드
                    <input
                      type="text"
                      value={powerlinkKeywordInput}
                      onChange={(event) => setPowerlinkKeywordInput(event.target.value)}
                      placeholder="예: 코인 사기 변호사"
                      maxLength={POWERLINK_KEYWORD_LIMIT}
                      required
                      disabled={powerlinkGenerateBusy}
                    />
                  </label>
                  <button type="submit" disabled={powerlinkGenerateBusy}>
                    {powerlinkGenerateBusy ? '생성 중...' : '파워링크 URL 생성'}
                  </button>
                </form>

                <div className="admin-list-wrap">
                  <h4>생성된 파워링크 URL</h4>
                  {powerlinkLinks.length > 0 ? (
                    <ul className="admin-item-list">
                      {powerlinkLinks.map((item) => (
                        <li className="admin-item" key={item.id}>
                          <div>
                            <p>파워링크 키워드</p>
                            <strong>{item.keyword}</strong>
                            <span className="admin-item-url">{item.url}</span>
                          </div>
                          <div className="admin-item-actions">
                            <button type="button" onClick={() => handleCopyPowerlinkLink(item.url)}>
                              복사
                            </button>
                            <button type="button" onClick={() => handleDeletePowerlinkLink(item.id)}>
                              삭제
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-empty">아직 생성된 파워링크 URL이 없습니다.</p>
                  )}
                </div>
              </article>
            </div>
          </section>
        )}

        {route === 'home' && (
          <>
            <section className="hero-section">
              <div className="hero-inner section-wrap">
                <div className="hero-copy">
                  <p className="hero-eyebrow hero-eyebrow-nowrap">
                    대규모 사기 사건, 비상장주식부터 보이스피싱 단체 사기까지
                  </p>
                  {landingPowerlinkKeyword ? (
                    <p className="hero-keyword-highlight">{landingPowerlinkKeyword}</p>
                  ) : null}
                  <h1
                    aria-label="나란에서 해결할 수 없다면 그 어디서도 해결할 수 없습니다."
                    className={landingPowerlinkKeyword ? 'hero-title-with-keyword' : undefined}
                  >
                    <span className="hero-typing-text">{heroTypedText || '\u00A0'}</span>
                    <span className="hero-typing-cursor" aria-hidden="true">
                      |
                    </span>
                  </h1>
                </div>

                <div className="hero-stats-bar" ref={heroStatsBarRef} aria-label="상담 및 해결 통계">
                  <ul className="hero-stats-list">
                    {HERO_STAT_ITEMS.map((item, index) => (
                      <li className="hero-stats-item" key={item.label}>
                        <p className="hero-stats-label">{item.label}</p>
                        <strong className="hero-stats-value">{(heroStatValues[index] ?? 0).toLocaleString('ko-KR')}+</strong>
                      </li>
                    ))}
                  </ul>
                </div>

                <a className="hero-cta" href={getRoutePath('home')} onClick={handleConsultingNavigation}>
                  피해 사실 접수
                </a>

                <div className="hero-experts">
                  <article className="expert-card expert-card-left">
                    <img
                      className="expert-thumb expert-thumb-avatar"
                      src={i1Img}
                      alt="서지원 변호사 프로필"
                    />
                    <div>
                      <h3>투자사기 피해회복 전문</h3>
                      <p>서지원 변호사</p>
                    </div>
                  </article>

                  <article className="expert-card expert-card-right">
                    <img
                      className="expert-thumb expert-thumb-logo"
                      src={i2Img}
                      alt="법무법인 나란 엠블럼"
                    />
                    <div>
                      <h3>핀테크 전문</h3>
                      <p>법무법인 나란</p>
                    </div>
                  </article>
                </div>
              </div>
            </section>

            <section className="rolling-section reveal-on-scroll" aria-label="성공사례 롤링 배너">
              <div className="section-wrap rolling-head">
                <h2>
                  말이 필요없는 10,000건 이상의
                  <br />
                  <span>성공사례로 증명</span>합니다.
                </h2>
                <p>
                  법무법인 나란의 수많은 성공경험과 노하우로
                  <br />
                  의뢰인의 믿음과 신뢰에 최선의 결과로 보답합니다.
                </p>
              </div>

              <div className="rolling-track-mask">
                <div className="rolling-track" ref={rollingTrackRef}>
                  {rollingLoopCases.map((item, index) => (
                    <article className="rolling-card" key={`${item.id}-${index}`}>
                      <p className="rolling-card-category">{item.category}</p>
                      <h3>{item.title}</h3>
                      <p className="rolling-card-result">{item.result}</p>
                      <div className="rolling-card-image-wrap">
                        <img src={item.image} alt={`${item.title} 사례 이미지`} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="scam-section" aria-label="진행중인 사기 사건 유형">
              <div className="section-wrap scam-inner">
                <div className="scam-header reveal-on-scroll">
                  <div>
                    <h2>
                      혹시 수수료와 세금을 명목으로
                      <br />
                      <span>출금이 지연되고 있나요?</span>
                    </h2>
                    <p>
                      법무법인 나란은 피해회복 과정에서 필요한 정보력을 토대로
                      <br />
                      금융사기로 인한 각종 피해해결을 최우선으로 생각합니다.
                    </p>
                  </div>

                  <img src={picImg} alt="법무법인 나란 심볼" className="scam-header-emblem" />
                </div>

                <div className="scam-grid">
                  {activeScamCases.map((item, index) => (
                    <article
                      className="scam-card reveal-on-scroll scam-card-reveal"
                      key={item.title}
                      style={{ '--reveal-delay': `${index * 0.2}s` } as CSSProperties}
                    >
                      <div className="scam-card-copy">
                        <p className="scam-card-tag">{item.tag}</p>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                      </div>
                      <img src={item.icon} alt={`${item.title} 아이콘`} className="scam-card-icon" />
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section className="review-section" aria-label="의뢰인 후기">
              <div className="section-wrap review-inner">
                <div className="review-head reveal-on-scroll">
                  <h2>
                    <span className="review-keyword">{landingPowerlinkKeyword || '투자사기'}</span> 피해회복의
                    <br />
                    <span>베테랑 나란</span>과 함께하세요.
                  </h2>
                </div>

                <div className="review-grid">
                  {reviewCards.map((item, index) => (
                    <article
                      className="review-card reveal-on-scroll review-card-reveal"
                      key={`review-${index}`}
                      style={{ '--reveal-delay': `${index * 0.2}s` } as CSSProperties}
                    >
                      <img className="review-quote" src={ssImg} alt="" aria-hidden="true" />
                      <p className="review-card-tag">나란 평가</p>
                      <p className="review-card-body">
                        {item.lines.map((line, lineIndex) => (
                          <span key={`${line}-${lineIndex}`}>
                            {line}
                            {lineIndex < item.lines.length - 1 ? <br /> : null}
                          </span>
                        ))}
                      </p>
                      <p className="review-card-foot">의뢰인님의 후기</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            <section
              className="quick-form-section reveal-on-scroll"
              aria-label="빠른 상담 접수"
              ref={quickFormSectionRef}
            >
              <div className="section-wrap quick-form-inner">
                <h2>접수즉시 전담 변호사가 연락드립니다.</h2>
                <h2>10분 이내 무료 전화 상담</h2>
                <p>접수 즉시 전담 변호사가 연락드립니다.</p>

                <form className="quick-form" onSubmit={handleConsultationSubmit}>
                  <input
                    type="text"
                    value={consultationNameInput}
                    onChange={(event) => setConsultationNameInput(event.target.value)}
                    placeholder="이름"
                    maxLength={CONSULTATION_LIMITS.name}
                    autoComplete="name"
                    required
                    disabled={consultationBusy}
                  />
                  <input
                    type="tel"
                    value={consultationPhoneInput}
                    onChange={(event) => setConsultationPhoneInput(event.target.value)}
                    placeholder="연락처"
                    maxLength={CONSULTATION_LIMITS.phone}
                    autoComplete="tel"
                    required
                    disabled={consultationBusy}
                  />
                  <textarea
                    rows={4}
                    value={consultationDetailsInput}
                    onChange={(event) => setConsultationDetailsInput(event.target.value)}
                    placeholder="피해받은 내용"
                    maxLength={CONSULTATION_LIMITS.details}
                    required
                    disabled={consultationBusy}
                  />
                  <button type="submit" disabled={consultationBusy}>
                    {consultationBusy ? '전송중...' : '바로상담하기'}
                  </button>
                </form>
                {consultationNotice ? (
                  <p className="quick-form-feedback quick-form-feedback-success">{consultationNotice}</p>
                ) : null}
                {consultationError ? (
                  <p className="quick-form-feedback quick-form-feedback-error">{consultationError}</p>
                ) : null}
              </div>
            </section>
          </>
        )}

        {route === 'lawyers' && (
          <section className="section-wrap lawyers-page">
            <div className="lawyers-page-head reveal-on-scroll">
              <h2>
                실력으로 증명하는 <span>베테랑 전문가 그룹</span>
              </h2>
              <p>법무법인 나란의 고객의 피해회복을 최우선하는 든든한 파트너가 되겠습니다.</p>
            </div>

            <div className="lawyer-profile-list">
              {lawyerProfiles.map((lawyer, index) => (
                <article
                  className={`lawyer-profile-card reveal-on-scroll ${
                    lawyer.reverse ? 'lawyer-profile-card-reverse' : ''
                  }`}
                  key={`${lawyer.name}-${index}`}
                >
                  <div className="lawyer-profile-photo-wrap">
                    <img className="lawyer-profile-photo" src={lawyer.image} alt={lawyer.imageAlt} />
                  </div>

                  <div className="lawyer-profile-content">
                    <p className="lawyer-profile-name-row">
                      <strong>{lawyer.name}</strong>
                      {lawyer.specialty ? <span>{lawyer.specialty}</span> : null}
                    </p>

                    <p className="lawyer-profile-headline">
                      {lawyer.headline[0]}
                      <br />
                      {lawyer.headline[1]}
                    </p>

                    <hr className="lawyer-profile-divider" />

                    <ul className="lawyer-profile-history">
                      {lawyer.history.map((item, itemIndex) => (
                        <li key={`${lawyer.name}-history-${itemIndex}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {route === 'companies' && (
          <section className="companies-page reveal-on-scroll" aria-label="사기업체 사례">
            <div className="companies-banner-wrap">
              <img src={bannerImg} alt="사기업체 배너" className="companies-banner" />
            </div>

            <div className="section-wrap companies-grid-wrap">
              <div className="companies-grid">
                {companyCases.length > 0
                  ? companyCases.map((item) => (
                      <article className="company-card company-card-filled" key={item.id}>
                        <div className="company-card-thumb-wrap">
                          <img src={item.image} alt={`${item.name} 이미지`} className="company-card-image" />
                        </div>
                        <p className="company-card-name">{item.name}</p>
                        <p className="company-card-service">{item.service}</p>
                        <p className="company-card-description">{item.description}</p>
                      </article>
                    ))
                  : companyPlaceholders.map((_, index) => (
                      <article className="company-card" key={`company-placeholder-${index}`}>
                        <div className="company-card-thumb" aria-hidden="true" />
                        <div className="company-card-line company-card-line-short" aria-hidden="true" />
                        <div className="company-card-line" aria-hidden="true" />
                        <div className="company-card-line company-card-line-mid" aria-hidden="true" />
                      </article>
                    ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <section className="quick-apply-bar" aria-label="하단 고정 간편 신청">
        <div className="section-wrap quick-apply-inner">
          <p className="quick-apply-title">간편 신청</p>

          <div className="quick-apply-scroll">
            <form className="quick-apply-form" onSubmit={handleConsultationSubmit}>
              <input
                type="text"
                value={consultationNameInput}
                onChange={(event) => setConsultationNameInput(event.target.value)}
                placeholder="이름"
                maxLength={CONSULTATION_LIMITS.name}
                autoComplete="name"
                required
                disabled={consultationBusy}
              />
              <input
                type="tel"
                value={consultationPhoneInput}
                onChange={(event) => setConsultationPhoneInput(event.target.value)}
                placeholder="연락처"
                maxLength={CONSULTATION_LIMITS.phone}
                autoComplete="tel"
                required
                disabled={consultationBusy}
              />
              <textarea
                rows={1}
                value={consultationDetailsInput}
                onChange={(event) => setConsultationDetailsInput(event.target.value)}
                placeholder="피해받은 내용"
                maxLength={CONSULTATION_LIMITS.details}
                required
                disabled={consultationBusy}
              />
              <button type="submit" disabled={consultationBusy}>
                {consultationBusy ? '전송중...' : '바로상담'}
              </button>
            </form>
          </div>
        </div>

        {consultationNotice ? (
          <p className="quick-apply-bar-feedback quick-apply-bar-feedback-success">{consultationNotice}</p>
        ) : null}
        {consultationError ? (
          <p className="quick-apply-bar-feedback quick-apply-bar-feedback-error">{consultationError}</p>
        ) : null}
      </section>

      <div className="floating-actions" aria-label="빠른 실행 버튼">
        <a
          className="floating-action-btn floating-action-btn-kakao"
          href={KAKAO_OPEN_CHAT_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="카카오톡 오픈채팅방 열기"
        >
          <span className="floating-action-icon" aria-hidden="true">
            <img src={kakaoIconImg} alt="" />
          </span>
        </a>

        <a className="floating-action-btn floating-action-btn-phone" href={CONTACT_PHONE_TEL} aria-label="대표번호로 전화">
          <span className="floating-action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path
                d="M6.7 3.3A2 2 0 0 1 8.9 2h1.9a2 2 0 0 1 2 1.7l.4 2.8a2 2 0 0 1-1.1 2.1l-1.4.7a13.2 13.2 0 0 0 4.1 4.1l.7-1.4a2 2 0 0 1 2.1-1.1l2.8.4a2 2 0 0 1 1.7 2v1.9a2 2 0 0 1-1.3 2.2l-1.2.4a7.8 7.8 0 0 1-6.8-1.1A22.3 22.3 0 0 1 5.2 10a7.8 7.8 0 0 1-1.1-6.8l.4-1.2a2 2 0 0 1 2.2-1.3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </a>
      </div>

      <footer className="site-footer">
        <div className="site-footer-inner section-wrap">
          <img src={logoImg} alt="법무법인 나란 로고" className="footer-logo" />

          <p className="footer-meta">
            회사명 : 법무법인 | 나란사업자번호 : 395-88-02904 | 대표 : 서지원 | 개인정보관리책임자 :
            서지원 변호사 |
          </p>
          <p className="footer-meta">
            본사무소 : 서울 송파구 송파대로167 (문정동 651) | 분사무소 : 서울특별시 도봉구 도봉로 803, 1층
          </p>
          <p className="footer-meta">TEL : {CONTACT_PHONE_NUMBER} | FAX : 02-2054-3451 | 이메일 : naranlawb1@gmail.com</p>

          <div className="footer-admin-actions">
            {isStaff ? (
              <>
                <button
                  type="button"
                  className="footer-admin-btn footer-admin-btn-primary"
                  onClick={() => setAdminOpen((previous) => !previous)}
                >
                  {adminOpen ? '관리자 닫기' : '관리자 창'}
                </button>
                <button type="button" className="footer-admin-btn" onClick={handleSignOut}>
                  로그아웃
                </button>
              </>
            ) : (
              <button
                type="button"
                className="footer-admin-btn footer-admin-btn-primary"
                onClick={() => openAuthModal('login')}
                disabled={isStaffCheckPending}
              >
                {isStaffCheckPending ? '권한확인중' : '관리자 로그인'}
              </button>
            )}
          </div>
        </div>
      </footer>

      {showAuthModal && (
        <div className="auth-modal-overlay" role="presentation" onClick={handleAuthBackdropClick}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-label="관리자 인증">
            <button type="button" className="auth-modal-close" onClick={closeAuthModal}>
              닫기
            </button>

            <h3>관리자 전용 계정</h3>
            <p className="auth-modal-copy">
              footer의 관리자 로그인 버튼을 통해 관리자만 접속할 수 있습니다.
            </p>

            <div className="auth-mode-tabs" role="tablist" aria-label="인증 방식">
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'login'}
                className={`auth-mode-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login')
                  setAuthError('')
                  setAuthNotice('')
                  setInviteCode('')
                }}
              >
                로그인
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'signup'}
                className={`auth-mode-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signup')
                  setAuthError('')
                  setAuthNotice('')
                  setInviteCode('')
                }}
              >
                회원가입
              </button>
            </div>

            {isFirebaseConfigured ? (
              <form className="auth-form" onSubmit={handleAuthSubmit}>
                <label>
                  이메일
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="admin@example.com"
                    autoComplete="email"
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    placeholder="6자 이상"
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  />
                </label>

                {authMode === 'signup' ? (
                  <label>
                    관리자 초대코드
                    <input
                      type="password"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      placeholder="운영자가 전달한 코드"
                    />
                  </label>
                ) : null}

                <button type="submit" disabled={authBusy || passwordResetBusy}>
                  {authBusy ? '처리중...' : authMode === 'login' ? '로그인' : '회원가입'}
                </button>

                {authMode === 'login' ? (
                  <div className="auth-help-row">
                    <p>이메일 입력 후 비밀번호 재설정 메일을 보내세요.</p>
                    <button
                      type="button"
                      className="auth-link-btn"
                      onClick={handlePasswordReset}
                      disabled={authBusy || passwordResetBusy}
                    >
                      {passwordResetBusy ? '메일 전송중...' : '비밀번호 찾기'}
                    </button>
                  </div>
                ) : null}
              </form>
            ) : (
              <p className="auth-form-error">
                Firebase 설정이 없습니다. <code>.env</code>에 <code>VITE_FIREBASE_*</code> 값을 입력해주세요.
              </p>
            )}

            {authMode === 'signup' ? (
              <p className="auth-form-help">회원가입 시 초대코드가 맞으면 바로 관리자 승인 후 관리자 창을 사용할 수 있습니다.</p>
            ) : (
              <p className="auth-form-help">관리자 승인된 계정으로 로그인하면 관리자 페이지에 접속합니다.</p>
            )}

            {authNotice ? <p className="auth-form-success">{authNotice}</p> : null}
            {authError ? <p className="auth-form-error">{authError}</p> : null}
          </section>
        </div>
      )}
    </div>
  )
}

export default App
