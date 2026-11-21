import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ActionIcon, Button, FileButton, Loader, Modal, SegmentedControl, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconChevronLeft, IconChevronRight, IconFlame, IconLock, IconPhoto, IconSearch, IconSnowflake, IconUpload, IconX } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { PERMISSION } from '../../auth/routeAccess'
import { getErrorMessage } from '../../api/errorMessage'
import { prepBookService } from '../../services/prepBookService'
import { isGuidePage, PREP_CATEGORIES, type PrepCategory, type PrepRecipe } from './prepBookTypes'
import { otherTemp, searchRecipes, withMl } from './prepSearch'
import './prepBook.css'

type TempFilter = 'all' | 'hot' | 'iced'

/** What the API accepts for the guide (PrepBookPackageReader.MaxZipBytes). */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024

/**
 * RECIPES — the bar's drink recipes, searchable: type a drink, read its ingredients and steps, open the original
 * guide page. Used mid-shift, typically on the bar iPad or a phone.
 *
 * THE GUIDE IS CONFIDENTIAL, so nothing of it is in the website's files: the book (recipes and thumbnails) and the
 * scanned pages come from the API to a signed-in user who holds PREP_BOOK_VIEW, and an admin (PREP_BOOK_MANAGE)
 * uploads or replaces the book here - which is also how a new version of the guide is published. Once loaded the
 * page searches in the browser, so it stays quick on a weak connection.
 *
 * TWO KINDS OF BOOK. A recipe book (.zip) holds recipe CARDS: ingredients, steps, categories, hot and iced. The guide
 * uploaded as a PDF becomes a book of PAGES: the server draws every page, and here they are a grid of pictures to
 * flip through (found by a word when the PDF has text, by looking when it is made of pictures).
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
  // A PDF chosen while the book on file has recipe cards: asked about before anything is replaced.
  const [pendingPdf, setPendingPdf] = useState<File | null>(null)

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

  const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

  /** A PDF brings pages only: when the book on file has recipe cards, the admin is told what goes before it goes. */
  function choose(file: File | null) {
    if (!file) return
    // The server takes 40 MB at most; said here, in words, rather than as a bare "413" after a long wait.
    if (file.size > MAX_UPLOAD_BYTES) {
      notifications.show({
        color: 'red',
        message: t('prepBook.tooLarge', { size: Math.ceil(file.size / (1024 * 1024)), max: MAX_UPLOAD_BYTES / (1024 * 1024) }),
        autoClose: 12000,
      })
      return
    }
    if (isPdf(file) && (recipes ?? []).some((r) => !isGuidePage(r))) setPendingPdf(file)
    else void upload(file)
  }

  async function upload(file: File) {
    const pdf = isPdf(file)
    setUploading(true)
    try {
      const info = await prepBookService.upload(file)
      notifications.show({
        color: 'green',
        message: pdf
          ? t('prepBook.uploadedPdf', { pages: info.scanCount })
          : t('prepBook.uploaded', { recipes: info.recipeCount, scans: info.scanCount }),
        autoClose: 6000,
      })
      setQuery('')
      setCategory('all')
      setTemp('all')
      await load()
    } catch (err) {
      notifications.show({ color: 'red', message: getErrorMessage(err), autoClose: 12000 })
    } finally {
      setUploading(false)
    }
  }

  const all = useMemo(() => recipes ?? [], [recipes])
  // A book of pages (the guide uploaded as a PDF): pictures to flip through, no categories, no hot and iced.
  const pageBook = all.length > 0 && all.every(isGuidePage)
  const hasText = useMemo(() => all.some((r) => r.text), [all])
  const openId = params.get('drink')
  const open = useMemo(() => all.find((r) => r.id === openId) ?? null, [all, openId])

  /* A search runs across the WHOLE book: typing a drink name while "Matcha" is selected and finding
     nothing would read as "we don't make that". The chips narrow only an empty search. */
  const searching = query.trim().length > 0
  const shown = useMemo(() => {
    if (pageBook) {
      // "12" or "page 12" goes straight to that page; anything else is searched in the names and the text.
      const number = /^\s*(?:page\s*)?(\d{1,3})\s*$/i.exec(query)?.[1]
      if (number) return all.filter((r) => r.page === Number(number))
      return searchRecipes(all, query)
    }
    const pool = searching ? all : all.filter((r) => category === 'all' || r.category === category)
    return searchRecipes(pool, query).filter((r) => temp === 'all' || r.temp === temp)
  }, [all, query, category, temp, searching, pageBook])

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
          <p className="page-subtitle">{pageBook ? t('prepBook.subtitlePages') : t('prepBook.subtitle')}</p>
        </div>
        {canManage && (
          <div className="page-head-actions">
            <FileButton onChange={choose} accept=".pdf,application/pdf,.zip,application/zip,application/x-zip-compressed">
              {(props) => (
                <Button {...props} variant="default" loading={uploading} leftSection={<IconUpload size={16} />}>
                  {recipes && recipes.length > 0 ? t('prepBook.replaceBook') : t('prepBook.uploadBook')}
                </Button>
              )}
            </FileButton>
          </div>
        )}
      </div>

      {uploading && (
        <div className="alert alert--warning" role="status">
          {t('prepBook.uploadingPdf')}
        </div>
      )}

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
        recipe={open && !isGuidePage(open) ? open : null}
        other={open && !isGuidePage(open) ? otherTemp(open, all) : null}
        onSwitch={(id) => setParams({ drink: id }, { replace: true })}
        onClose={close}
      />
      <PageModal
        page={open && isGuidePage(open) ? open : null}
        pages={all}
        onGo={(id) => setParams({ drink: id }, { replace: true })}
        onClose={close}
      />

      <Modal
        opened={pendingPdf !== null}
        onClose={() => setPendingPdf(null)}
        title={t('prepBook.replaceWithPdfTitle')}
        centered
        size={520}
      >
        <p>{t('prepBook.replaceWithPdfText', { count: all.filter((r) => !isGuidePage(r)).length })}</p>
        <div className="form-actions">
          <Button variant="default" onClick={() => setPendingPdf(null)}>
            {t('prepBook.keepCards')}
          </Button>
          <Button
            color="red"
            onClick={() => {
              const file = pendingPdf
              setPendingPdf(null)
              if (file) void upload(file)
            }}
          >
            {t('prepBook.replaceWithPdfConfirm')}
          </Button>
        </div>
      </Modal>
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
          placeholder={pageBook ? t('prepBook.searchPages') : t('prepBook.searchPlaceholder')}
          aria-label={pageBook ? t('prepBook.searchPages') : t('prepBook.searchPlaceholder')}
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

        {pageBook && !hasText && (
          <div className="hint">
            {t('prepBook.picturesOnly')}
            {canManage ? ` ${t('prepBook.picturesOnlyAdmin')}` : ''}
          </div>
        )}
        {!pageBook && (
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
        )}
        {searching && (
          <div className="hint">
            {pageBook ? t('prepBook.pagesFound', { count: shown.length }) : t('prepBook.searchingAll', { count: shown.length })}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{pageBook ? t('prepBook.nonePagesTitle') : t('prepBook.noneTitle')}</div>
            {pageBook ? t('prepBook.nonePagesText') : t('prepBook.noneText')}
          </div>
        </div>
      ) : pageBook ? (
        <div className="prep-grid prep-grid--pages">
          {shown.map((r) => (
            <PageCard key={r.id} page={r} onOpen={() => openRecipe(r.id)} />
          ))}
        </div>
      ) : (
        <div className="prep-grid">
          {shown.map((r) => (isGuidePage(r) ? <PageCard key={r.id} page={r} onOpen={() => openRecipe(r.id)} /> : <RecipeCard key={r.id} recipe={r} onOpen={() => openRecipe(r.id)} />))}
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

/** One page of a PDF guide in the grid: its small picture, its number, and its name when the page has one. */
function PageCard({ page, onOpen }: { page: PrepRecipe; onOpen: () => void }) {
  const { t } = useTranslation()
  const number = t('prepBook.pageNumber', { page: page.page })
  // A page of pictures is named "Page N" by the server: the number is then all there is to say.
  const named = page.page == null || page.name !== `Page ${page.page}`
  return (
    <button type="button" className="prep-page-card" onClick={onOpen} aria-label={named ? `${number}: ${page.name}` : number}>
      <div className="prep-page-thumb">{page.thumb ? <img src={page.thumb} alt="" loading="lazy" draggable={false} /> : null}</div>
      <div className="prep-page-caption">
        <span className="prep-page-number">{number}</span>
        {named && (
          <span className="prep-page-name" dir="auto">
            {page.name}
          </span>
        )}
      </div>
    </button>
  )
}

/**
 * One page of a PDF guide, full size, with the pages before and after it one press away (the arrow keys too).
 * The picture is fetched with the token when the page opens and its object URL is given back when it closes.
 */
function PageModal({
  page,
  pages,
  onGo,
  onClose,
}: {
  page: PrepRecipe | null
  /** The whole book in order: where "previous" and "next" lead. */
  pages: PrepRecipe[]
  onGo: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const narrow = useMediaQuery('(max-width: 720px)')
  const number = page?.page ?? null
  const index = page ? pages.findIndex((p) => p.id === page.id) : -1
  const previous = index > 0 ? pages[index - 1] : null
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null

  const [picture, setPicture] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    if (number == null) return
    let cancelled = false
    let made: string | null = null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicture({ url: null, error: null })
    prepBookService
      .scanObjectUrl('pages', number)
      .then((url) => {
        if (cancelled) URL.revokeObjectURL(url)
        else {
          made = url
          setPicture({ url, error: null })
        }
      })
      .catch((err) => !cancelled && setPicture({ url: null, error: getErrorMessage(err) }))
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [number])

  const previousId = previous?.id
  const nextId = next?.id
  useEffect(() => {
    if (number == null) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && previousId) onGo(previousId)
      if (e.key === 'ArrowRight' && nextId) onGo(nextId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [number, previousId, nextId, onGo])

  const named = page != null && (page.page == null || page.name !== `Page ${page.page}`)

  return (
    <Modal
      opened={page !== null}
      onClose={onClose}
      size={1100}
      fullScreen={narrow}
      centered
      padding="md"
      radius="lg"
      title={
        page ? (
          <div className="prep-modal-title">
            <div>
              <div className="prep-modal-name" dir="auto">
                {named ? page.name : t('prepBook.pageNumber', { page: page.page })}
              </div>
              <div className="prep-card-meta">
                <span>{t('prepBook.pageOf', { page: index + 1, count: pages.length })}</span>
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {page && (
        <div className="prep-page-view" dir="ltr">
          <div className="prep-page-nav">
            <Button
              variant="default"
              leftSection={<IconChevronLeft size={16} />}
              disabled={!previous}
              onClick={() => previous && onGo(previous.id)}
            >
              {t('prepBook.prevPage')}
            </Button>
            <Button
              variant="default"
              rightSection={<IconChevronRight size={16} />}
              disabled={!next}
              onClick={() => next && onGo(next.id)}
            >
              {t('prepBook.nextPage')}
            </Button>
          </div>
          {picture.url ? (
            <img src={picture.url} alt={page.name} className="prep-original" draggable={false} />
          ) : picture.error ? (
            <div className="alert alert--error" role="alert">
              {picture.error}
            </div>
          ) : (
            <div className="page-loading">
              <Loader size={32} />
            </div>
          )}
        </div>
      )}
    </Modal>
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
