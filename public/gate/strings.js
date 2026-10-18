/**
 * The gate page's words, in English and Arabic, and the two small decisions made about the reader.
 *
 * The gate is shown BEFORE anybody has signed in, so the app's per-user language choice is not
 * known yet; the page carries both languages itself and a toggle between them. Same keys in both —
 * tests/gatePage.test.ts holds them to it.
 *
 * {email} and {host} are filled in by gate.js, always into textContent.
 *
 * Pure (no DOM), so the test runs it under plain Node.
 */

export const STRINGS = {
  en: {
    langName: 'English',
    docTitle: 'Sign in — Moka & Co HRMS',
    title: 'Sign in to continue',
    lead: 'This is the Moka & Co HRMS. Sign in with the Google account (Gmail) on your employee record.',
    loading: 'Loading…',
    loadingGoogle: 'Loading Google sign-in…',
    checking: 'Checking your Google account…',
    success: 'Signed in as {email}. Opening the HRMS…',
    opening: 'Opening the HRMS…',
    stuck: 'Google sign-in is not needed right now. Continue to the HRMS.',
    continue: 'Continue',
    retry: 'Try again',
    notSetUp: 'Google sign-in is not set up yet. Ask the administrator.',
    offline: 'Could not reach the HRMS. Check the connection and try again.',
    gsiFailed: "Google's sign-in could not load. Check the connection and try again.",
    refused400: 'Google could not confirm this sign-in. Try again.',
    refused403: 'This Google account cannot open the HRMS.',
    refused503: 'Sign-in is not available right now. Try again in a minute.',
    tooMany: 'Too many tries. Wait a minute and try again.',
    failed: 'Sign-in failed. Try again.',
    help: 'If the Google button does nothing, open {host} in Chrome or Safari — not inside WhatsApp.',
    inApp: 'You seem to be inside an app such as WhatsApp. Google sign-in often does not work here. Open {host} in Chrome or Safari.',
    testTag: 'Test',
    foot: 'Moka & Co — HRMS',
  },
  ar: {
    langName: 'العربية',
    docTitle: 'تسجيل الدخول — نظام الموارد البشرية Moka & Co',
    title: 'سجّل الدخول للمتابعة',
    lead: 'هذا نظام الموارد البشرية لدى Moka & Co. سجّل الدخول بحساب Google (Gmail) المسجّل في سجلّك الوظيفي.',
    loading: 'جارٍ التحميل…',
    loadingGoogle: 'جارٍ تحميل تسجيل الدخول من Google…',
    checking: 'جارٍ التحقق من حساب Google…',
    success: 'تم تسجيل الدخول باسم {email}. جارٍ فتح النظام…',
    opening: 'جارٍ فتح النظام…',
    stuck: 'لا حاجة إلى تسجيل الدخول عبر Google الآن. تابع إلى النظام.',
    continue: 'متابعة',
    retry: 'حاول مجددًا',
    notSetUp: 'لم يتم إعداد تسجيل الدخول عبر Google بعد. راجع المسؤول.',
    offline: 'تعذّر الوصول إلى النظام. تحقّق من الاتصال وحاول مجددًا.',
    gsiFailed: 'تعذّر تحميل تسجيل الدخول من Google. تحقّق من الاتصال وحاول مجددًا.',
    refused400: 'لم تتمكّن Google من تأكيد تسجيل الدخول. حاول مجددًا.',
    refused403: 'لا يمكن لحساب Google هذا فتح النظام.',
    refused503: 'تسجيل الدخول غير متاح الآن. حاول مجددًا بعد دقيقة.',
    tooMany: 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا.',
    failed: 'تعذّر تسجيل الدخول. حاول مجددًا.',
    help: 'إذا لم يستجب زر Google، افتح {host} في Chrome أو Safari، وليس من داخل WhatsApp.',
    inApp: 'يبدو أنك داخل تطبيق مثل WhatsApp، وغالبًا لا يعمل تسجيل الدخول عبر Google هنا. افتح {host} في Chrome أو Safari.',
    testTag: 'تجريبي',
    foot: 'Moka & Co — نظام الموارد البشرية',
  },
}

export const LANGUAGES = ['en', 'ar']

/**
 * The language to start in: the one this browser chose on the gate before, else Arabic when the
 * phone's first language is Arabic, else English.
 * @param {string | null | undefined} stored
 * @param {readonly string[] | undefined} preferred navigator.languages
 * @returns {'en' | 'ar'}
 */
export function pickLanguage(stored, preferred) {
  if (stored === 'en' || stored === 'ar') return stored
  const first = (preferred && preferred[0]) || ''
  return first.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

/**
 * Is this an app's built-in browser? Google refuses to sign in inside most of them (an Android
 * WebView, Facebook, Instagram), and a link opened from a WhatsApp chat on Android lands in one.
 * Only used to show the "open it in Chrome or Safari" note more loudly — never to block anything.
 * @param {string | null | undefined} userAgent
 */
export function isInAppBrowser(userAgent) {
  return /WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|; wv\)/i.test(userAgent || '')
}

/**
 * The page's own sentence for a refused sign-in, by status (0: no answer at all). In English the API's sentence is shown
 * instead when there is one ("x@gmail.com is not on the HRMS list …"); in Arabic this line comes
 * first and the API's English sentence follows it, because it names the address.
 * @param {number} status
 */
export function refusalKey(status) {
  if (status === 0) return 'offline'
  if (status === 400) return 'refused400'
  if (status === 403) return 'refused403'
  if (status === 429) return 'tooMany'
  if (status === 503) return 'refused503'
  return 'failed'
}
