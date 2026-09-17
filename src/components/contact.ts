/**
 * THE CONTACT RULES, mirrored from the API's ContactRules (MokaCo.HRMS.Services/HR/ContactRules.cs)
 * so a phone or e-mail is refused HERE, under the box, with the same sentence the server would use
 * — rather than accepted by the form and thrown back as a 400 a round trip later.
 *
 * The server is still the rule. These exist so the form can say what it needs before someone
 * submits; nothing here may be relied on as validation.
 *
 * PHONE — Lebanese: 8 local digits (03 123 456, 71 234 567, 01 234 567) or the international form
 * +961 / 00961 / 961 followed by the national number, with or without its leading 0. Spaces,
 * dashes, dots and brackets are formatting and ignored. The stored form is E.164: "+961" plus the
 * national number without its leading 0 (+9613123456, +96171234567).
 *
 * E-MAIL — one bare address: no spaces, one @, a dot in the host. Deliberately loose beyond that,
 * for the reason the old employee-form regex gave: the strict grammar rejects addresses that
 * genuinely deliver, and the real test is the mail arriving.
 */

export const PHONE_MESSAGE =
  'Enter a Lebanese phone number: 8 digits (e.g. 03 123 456) or +961 followed by the number.'
export const EMAIL_MESSAGE = 'Enter a valid e-mail address.'
export const CONTACT_REQUIRED_MESSAGE = 'Phone number and e-mail are required for a new employee.'

/**
 * The E.164 form ("+961…") of a valid Lebanese number, or null when the input is blank or not
 * a Lebanese number. Step for step the server's NormalisePhone.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === '') return null
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits.length === 0) return null

  let national: string
  if (plus) {
    if (!digits.startsWith('961')) return null
    national = digits.slice(3)
  } else if (digits.startsWith('00961')) {
    national = digits.slice(5)
  } else if (digits.length === 8) {
    national = digits
  } else if (digits.startsWith('961') && (digits.length === 10 || digits.length === 11)) {
    national = digits.slice(3)
  } else {
    return null
  }

  // The national number is 7 digits (after dropping a local leading 0) or 8 (7x/8x mobiles).
  if (national.length === 8 && national[0] === '0') national = national.slice(1)
  if (national.length !== 7 && national.length !== 8) return null
  if (national[0] === '0') return null

  return '+961' + national
}

export function isValidPhone(raw: string | null | undefined): boolean {
  return normalisePhone(raw) != null
}

/** True for one syntactically valid bare address. Blank is not valid. */
export function isValidEmail(raw: string | null | undefined): boolean {
  if (raw == null) return false
  const value = raw.trim()
  if (value === '' || value.includes(' ')) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const host = value.slice(at + 1)
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return false
  return true
}

/**
 * The field error for a phone box, or null when it passes. `required` decides what a blank box
 * means: on employee CREATE it is refused (the API's own sentence); elsewhere blank is allowed.
 */
export function phoneError(raw: string, required: boolean): string | null {
  if (raw.trim() === '') return required ? CONTACT_REQUIRED_MESSAGE : null
  return isValidPhone(raw) ? null : PHONE_MESSAGE
}

/** The field error for an e-mail box, or null when it passes. Same contract as {@link phoneError}. */
export function emailError(raw: string, required: boolean): string | null {
  if (raw.trim() === '') return required ? CONTACT_REQUIRED_MESSAGE : null
  return isValidEmail(raw) ? null : EMAIL_MESSAGE
}
