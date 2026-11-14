import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { ActionIcon, Button, Modal, SegmentedControl, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconFlame, IconPhoto, IconSearch, IconSnowflake, IconX } from '@tabler/icons-react'
import {
  guidePageUrl,
  labelUrl,
  PREP_CATEGORIES,
  PREP_RECIPES,
  thumbUrl,
  type PrepCategory,
  type PrepRecipe,
} from './prepBookData'
import { searchRecipes, withMl } from './prepSearch'
import './prepBook.css'

type TempFilter = 'all' | 'hot' | 'iced'

/**
 * PREP BOOK — the bar's drink recipes, searchable. Open to every signed-in user (OPEN_ROUTES): it
 * holds no personal data and every barista needs it, typically on the bar iPad mid-shift.
 *
 * Everything is in the bundle (prepBookData.ts) and the scanned pages in /public/prep-book, so the
 * page needs no API, no permission code and no database script, and it keeps working on a flaky
 * connection once it has loaded.
 *
 * The open drink lives in the URL (?drink=iced-spanish-latte): the iPad's back gesture closes it,
 * and a link to one drink can be sent to somebody.
 */
export default function PrepBookPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PrepCategory | 'all'>('all')
  const [temp, setTemp] = useState<TempFilter>('all')
  const searchRef = useRef<HTMLInputElement>(null)

  const openId = params.get('drink')
  const open = useMemo(() => PREP_RECIPES.find((r) => r.id === openId) ?? null, [openId])

  /* A search runs across the WHOLE book: typing a drink name while "Matcha" is selected and finding
     nothing would read as "we don't make that". The chips narrow only an empty search. */
  const searching = query.trim().length > 0
  const shown = useMemo(() => {
    const pool = searching
      ? PREP_RECIPES
      : PREP_RECIPES.filter((r) => category === 'all' || r.category === category)
    return searchRecipes(pool, query).filter((r) => temp === 'all' || r.temp === temp)
  }, [query, category, temp, searching])

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
      </div>

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
            {(['all', ...PREP_CATEGORIES] as const).map((c) => (
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

      <RecipeModal recipe={open} onClose={close} />
    </div>
  )
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
  const thumb = thumbUrl(recipe)
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

function RecipeModal({ recipe, onClose }: { recipe: PrepRecipe | null; onClose: () => void }) {
  const { t } = useTranslation()
  const narrow = useMediaQuery('(max-width: 720px)')
  const [showOriginal, setShowOriginal] = useState(false)
  const recipeId = recipe?.id

  // Each drink opens on its recipe, not on the last drink's scanned page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowOriginal(false)
  }, [recipeId])

  const original = recipe?.page ? guidePageUrl(recipe.page) : recipe?.label ? labelUrl(recipe.label) : null
  const thumb = recipe ? thumbUrl(recipe) : null

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
          {original && (
            <div className="prep-recipe-actions">
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
            </div>
          )}

          {showOriginal && original ? (
            <img src={original} alt={recipe.name} className="prep-original" />
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
