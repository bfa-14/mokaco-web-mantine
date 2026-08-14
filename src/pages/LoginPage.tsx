import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Button, PasswordInput, TextInput } from '@mantine/core'
import { useAuth } from '../auth/useAuth'
import { safeNextPath } from '../auth/sessionRedirect'
import { ApiError } from '../api/client'
import { BrandWordmark, BrandSlogan } from '../components/Brand'
import './LoginPage.css'

interface FromState {
  from?: { pathname?: string }
}

interface LoginForm {
  username: string
  password: string
}

/** Takes `t` as an argument: a module-level function has no hook, and the fallbacks are translated. */
function messageFromError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    // The backend returns a specific message in { error } for failed logins; surface it directly.
    return error.message || t('auth.errorGeneric')
  }
  if (error instanceof Error) {
    return error.message
  }
  return t('auth.errorUnknown')
}

/**
 * The sign-in screen — same split layout and classes as the original (LoginPage.css is carried
 * over verbatim); the DevExtreme TextBox/Validator stack is replaced by react-hook-form + Mantine
 * inputs, which is the form pattern this build standardises on for simple forms.
 */
export default function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ defaultValues: { username: '', password: '' } })

  /**
   * Where to land after signing in. ?next= is authoritative; router state is read behind it so an
   * older link is not stranded. Both go through safeNextPath — `next` came out of a URL, so it is
   * untrusted input, not a hint. (Unchanged from the original.)
   */
  const redirectTo =
    safeNextPath(new URLSearchParams(location.search).get('next')) ??
    safeNextPath((location.state as FromState | null)?.from?.pathname) ??
    '/'

  async function onSubmit(values: LoginForm) {
    setError(null)
    setLoading(true)
    try {
      await login({ username: values.username, password: values.password })
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(messageFromError(err, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <aside className="login-brand" aria-hidden="true">
        <div className="login-brand-pattern" />
        <div className="login-brand-content">
          <BrandWordmark className="login-brand-mark" />
          <BrandSlogan className="login-brand-slogan" />
        </div>
        <div className="login-brand-footer">{t('auth.brandFooter')}</div>
      </aside>

      <div className="login-form-side">
        <form className="login-card" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
          <div className="login-header">
            <span className="login-tag">HRMS</span>
            <h1 className="login-title">{t('auth.title')}</h1>
            <p className="login-subtitle">{t('auth.subtitle')}</p>
          </div>

          <div className="login-field">
            <TextInput
              id="login-username"
              label={t('auth.username')}
              placeholder={t('auth.usernamePlaceholder')}
              autoComplete="username"
              disabled={loading}
              error={errors.username?.message}
              {...register('username', { required: t('auth.usernameRequired') })}
            />
          </div>

          <div className="login-field">
            <PasswordInput
              id="login-password"
              label={t('auth.password')}
              placeholder={t('auth.passwordPlaceholder')}
              autoComplete="current-password"
              disabled={loading}
              error={errors.password?.message}
              {...register('password', { required: t('auth.passwordRequired') })}
            />
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" fullWidth h={44} loading={loading}>
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </div>
    </div>
  )
}
