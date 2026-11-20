import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ActionIcon, Button, FileButton, Loader, Modal, SegmentedControl, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconFlame, IconLock, IconPhoto, IconSearch, IconSnowflake, IconUpload, IconX } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { getErrorMessage } from '../../api/errorMessage'
import { prepBookService } from '../../services/prepBookService'
import { PREP_CATEGORIES, type PrepCategory, type PrepRecipe } from './prepBookTypes'
import { otherTemp, searchRecipes, withMl } from './prepSearch'
import './prepBook.css'

type TempFilter = 'all' | 'hot' | 'iced'

/**
 * RECIPES — the bar's drink recipes, searchable: type a drink, read its ingredients and steps, open the original
 * guide page. Used mid-shift, typically on the bar iPad or a phone.
 *
 * THE GUIDE IS CONFIDENTIAL, so nothing of it is in the website's files: the book (recipes and thumbnails) and the
 * scanned pages come from the API to a signed-in user who holds PREP_BOOK_VIEW, and an admin (PREP_BOOK_MANAGE)
 * uploads or replaces the book here - which is also how a new version of the guide is published. Once loaded the
 * page searches in the browser, so it stays quick on a weak connection.
 *
 * The open drink lives in the URL (?drink=iced-spanish-latte): the iPad's back gesture closes it.
 */
export default function PrepBookPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSION.PREP_BOOK_MANAGE)
  const canView = hasPermission(PERMISSION.PREP_BOOK_VIEW)
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PrepCategory | 'all'>('all')
  const [temp, setTemp] = useState<TempFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)

  // undefined = still reading; null = no book has been uploaded yet.
  const [recipes, setRecipes] = useState<PrepRecipe[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    if (!canView) {
      setRecipes(null)
      return
    }
    try {
      const book = await prepBookService.get()
      setRecipes(book ? book.recipes : null)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
      setRecipes((current) => current ?? null)
    }
  }, [canView])

  useEffect(() => {
    // A read on mount: the state is set when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function upload(file: File | null) {
    if (!file) return
    setUploading(true)
    try {
      const info = await prepBookService.upload(file)
      notifications.show({
        color: 'green',
        message: t('prepBook.uploaded', { recipes: info.recipeCount, scans: info.scanCount }),
        autoClose: 6000,
      })
      await load()
    } catch (err) {
      notifications.show({ color: 'red', message: getErrorMessage(err), autoClose: 12000 })
    } finally {
      setUploading(false)
    }
  }

  const all = useMemo(() => recipes ?? [], [recipes])
  const openId = params.get('drink')
  const open = useMemo(() => all.find((r) => r.id === openId) ?? null, [all, openId])

  /* A search runs across the WHOLE book: typing a drink name while "Matcha" is selected and finding
     nothing would read as "we don't make that". The chips narrow only an empty search. */
  const searching = query.trim().length > 0
  const shown = useMemo(() => {
    const pool = searching ? all : all.filter((r) => category === 'all' || r.category === category)
    return searchRecipes(pool, query).filter((r) => temp === 'all' || r.temp === temp)
  }, [all, query, category, temp, searching])

  // Only the categories the book on file has drinks in.
  const categories = useMemo(() => PREP_CATEGORIES.filter((c) => all.some((r) => r.category === c)), [all])

  const openRecipe = (id: string) => setParams({ drink: id })
  const close = () => {
    // Opened from this page → go back (keeps history tidy); opened from a shared link → just drop it.
    if (window.history.state?.idx > 0) window.history.back()
    else setParams({}, { replace: true })
  }

  // "/" or any letter typed anywhere jumps into the search box, like a kiosk.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (open || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === '/' || (e.key.length === 1 && /\p{L}/u.test(e.key))) {
        searchRef.current?.focus()
        if (e.key === '/') e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="prep-book">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('prepBook.title')}</h1>
          <p className="page-subtitle">{t('prepBook.subtitle')}</p>
        </div>
        {canManage && (
          <div className="page-head-actions">
            <FileButton onChange={(file) => void upload(file)} accept=".zip,application/zip,application/x-zip-compressed">
              {(props) => (
                <Button {...props} variant="default" loading={uploading} leftSection={<IconUpload size={16} />}>
                  {recipes && recipes.length > 0 ? t('prepBook.replaceBook') : t('prepBook.uploadBook')}
                </Button>
              )}
            </FileButton>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          {t('prepBook.loadFailed', { error })}
        </div>
      )}

      {recipes === undefined ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : all.length === 0 ? (
        !error && (
          <div className="card">
            <div className="empty-hint">
              <div className="empty-hint-main">{t('prepBook.noBookTitle')}</div>
              {canManage ? t('prepBook.noBookManage') : t('prepBook.noBookText')}
            </div>
          </div>
        )
      ) : (
        renderBook()
      )}

      <RecipeModal
        recipe={open}
        other={open ? otherTemp(open, all) : null}
        onSwitch={(id) => setParams({ drink: id }, { replace: true })}
        onClose={close}
      />
    </div>
  )

  function renderBook() {
    return (
      <>
      <div className="prep-toolbar">
        <TextInput
          ref={searchRef}
          size="lg"
          radius="md"
          className="prep-search"
          placeholder={t('prepBook.searchPlaceholder')}
          aria-label={t('prepBook.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown.length > 0) openRecipe(shown[0].id)
            if (e.key === 'Escape') setQuery('')
          }}
          leftSection={<IconSearch size={20} />}
          rightSection={
            query ? (
              <ActionIcon variant="subtle" color="gray" aria-label={t('prepBook.clear')} onClick={() => setQuery('')}>
                <IconX size={18} />
              </ActionIcon>
            ) : null
          }
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />

        <div className="prep-filters">
          <div className={`prep-chips${searching ? ' prep-chips--idle' : ''}`} role="group" aria-label={t('prepBook.category')}>
            {(['all', ...categories] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={`prep-chip${category === c ? ' prep-chip--on' : ''}`}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
              >
                {t(`prepBook.categories.${c}`)}
              </button>
            ))}
          </div>
          <SegmentedControl
            size="md"
            radius="xl"
            value={temp}
            onChange={(v) => setTemp(v as TempFilter)}
            data={[
              { value: 'all', label: t('prepBook.temp.all') },
              { value: 'hot', label: t('prepBook.temp.hot') },
              { value: 'iced', label: t('prepBook.temp.iced') },
            ]}
          />
        </div>
        {searching && <div className="hint">{t('prepBook.searchingAll', { count: shown.length })}</div>}
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('prepBook.noneTitle')}</div>
            {t('prepBook.noneText')}
          </div>
        </div>
      ) : (
        <div className="prep-grid">
          {shown.map((r) => (
            <RecipeCard key={r.id} recipe={r} onOpen={() => openRecipe(r.id)} />
          ))}
        </div>
      )}

      <p className="prep-confidential">
        <IconLock size={14} aria-hidden="true" /> {t('prepBook.confidential')}
      </p>
      </>
    )
  }
}

function TempBadge({ temp }: { temp?: PrepRecipe['temp'] }) {
  const { t } = useTranslation()
  if (!temp) return null
  const Icon = temp === 'hot' ? IconFlame : IconSnowflake
  return (
    <span className={`prep-temp prep-temp--${temp}`}>
      <Icon size={14} aria-hidden="true" />
      {t(`prepBook.temp.${temp}`)}
    </span>
  )
}

function RecipeCard({ recipe, onOpen }: { recipe: PrepRecipe; onOpen: () => void }) {
  const { t } = useTranslation()
  const thumb = recipe.thumb ?? null
  return (
    <button type="button" className="prep-card" onClick={onOpen}>
      <div className="prep-card-img">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <span className="prep-card-initial" aria-hidden="true">
            {recipe.name.charAt(0)}
          </span>
        )}
      </div>
      <div className="prep-card-body">
        <div className="prep-card-name">{recipe.name}</div>
        <div className="prep-card-meta">
          <span>{t(`prepBook.categories.${recipe.category}`)}</span>
          <TempBadge temp={recipe.temp} />
        </div>
      </div>
    </button>
  )
}

function RecipeModal({
  recipe,
  other,
  onSwitch,
  onClose,
}: {
  recipe: PrepRecipe | null
  /** The same drink at the other temperature, when the book has it. */
  other: PrepRecipe | null
  onSwitch: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const narrow = useMediaQuery('(max-width: 720px)')
  const [showOriginal, setShowOriginal] = useState(false)
  const recipeId = recipe?.id
  const page = recipe?.page
  const label = recipe?.label
  const hasOriginal = page != null || label != null

  // Each drink opens on its recipe, not on the last drink's scanned page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowOriginal(false)
  }, [recipeId])

  /* The scan is fetched with the token only when somebody asks to see it, and its object URL is given back when
     the drink closes or another scan takes its place. */
  const [original, setOriginal] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    if (!showOriginal || !hasOriginal) return
    let cancelled = false
    let made: string | null = null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOriginal({ url: null, error: null })
    prepBookService
      .scanObjectUrl(page != null ? 'pages' : 'labels', (page ?? label) as number)
      .then((url) => {
        if (cancelled) URL.revokeObjectURL(url)
        else {
          made = url
          setOriginal({ url, error: null })
        }
      })
      .catch((err) => !cancelled && setOriginal({ url: null, error: getErrorMessage(err) }))
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [showOriginal, hasOriginal, page, label])

  const thumb = recipe?.thumb ?? null

  return (
    <Modal
      opened={recipe !== null}
      onClose={onClose}
      size={920}
      fullScreen={narrow}
      centered
      padding="lg"
      radius="lg"
      title={
        recipe ? (
          <div className="prep-modal-title">
            {thumb && <img src={thumb} alt="" className="prep-modal-thumb" />}
            <div>
              <div className="prep-modal-name">{recipe.name}</div>
              <div className="prep-card-meta">
                <span>{t(`prepBook.categories.${recipe.category}`)}</span>
                <TempBadge temp={recipe.temp} />
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {recipe && (
        <div className="prep-recipe" dir="ltr" lang="en">
          {(hasOriginal || other) && (
            <div className="prep-recipe-actions">
              {other && (
                <Button
                  variant="default"
                  leftSection={other.temp === 'hot' ? <IconFlame size={16} /> : <IconSnowflake size={16} />}
                  onClick={() => onSwitch(other.id)}
                >
                  {other.temp === 'hot' ? t('prepBook.seeHot') : t('prepBook.seeIced')}
                </Button>
              )}
              {hasOriginal && (
                <Button
                  variant={showOriginal ? 'filled' : 'default'}
                  leftSection={<IconPhoto size={16} />}
                  onClick={() => setShowOriginal((v) => !v)}
                >
                  {showOriginal
                    ? t('prepBook.showRecipe')
                    : recipe.page
                      ? t('prepBook.showGuidePage', { page: recipe.page })
                      : t('prepBook.showLabel')}
                </Button>
              )}
            </div>
          )}

          {showOriginal && hasOriginal ? (
            original.url ? (
              <img src={original.url} alt={recipe.name} className="prep-original" draggable={false} />
            ) : original.error ? (
              <div className="alert alert--error" role="alert">
                {original.error}
              </div>
            ) : (
              <div className="page-loading">
                <Loader size={32} />
              </div>
            )
          ) : (
            <RecipeBody recipe={recipe} />
          )}
        </div>
      )}
    </Modal>
  )
}

function RecipeBody({ recipe }: { recipe: PrepRecipe }) {
  const { t } = useTranslation()
  return (
    <>
      {recipe.sizes && (
        <section className="prep-section">
          <div className="prep-sizes">
            {recipe.sizes.map((s) => (
              <div key={s.size} className="prep-size">
                <div className="prep-size-label">{s.size}</div>
                <ul>
                  {s.items.map((item) => (
                    <li key={item}>{withMl(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {recipe.ingredients && (
        <section className="prep-section">
          <h3 className="prep-h">{t('prepBook.ingredients')}</h3>
          <ul className="prep-ingredients">
            {recipe.ingredients.map((item) => (
              <li key={item}>{withMl(item)}</li>
            ))}
          </ul>
        </section>
      )}

      {recipe.method && (
        <section className="prep-section">
          {recipe.method.map((m) => (
            <div key={m} className="prep-method">
              {withMl(m)}
            </div>
          ))}
        </section>
      )}

      {recipe.steps && (
        <section className="prep-section">
          <h3 className="prep-h">{t('prepBook.steps')}</h3>
          <ol className="prep-steps">
            {recipe.steps.map((step, i) => (
              <li key={`${i}-${step.title}`} className="prep-step">
                <div className="prep-step-num">{i + 1}</div>
                <div>
                  <div className="prep-step-title">{step.title}</div>
                  {step.items.length > 0 && (
                    <ul>
                      {step.items.map((item, j) => (
                        <li key={j}>{withMl(item)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {recipe.notes && (
        <section className="prep-section">
          {recipe.notes.map((n) => (
            <div key={n} className="prep-note">
              {n}
            </div>
          ))}
        </section>
      )}

      <div className="prep-source">
        {recipe.page
          ? t('prepBook.sourceGuide', { page: recipe.page })
          : t('prepBook.sourceLabels', { page: recipe.label })}
      </div>
    </>
  )
}
