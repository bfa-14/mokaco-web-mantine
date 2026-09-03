import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Checkbox,
  Loader,
  Modal,
  NumberInput,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconClock, IconPencil, IconPlus, IconSparkles } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { getErrorMessage } from '../../api/errorMessage'
import { PageHelp } from '../../components/PageHelp'
import { roomsService } from '../../services/bookingService'
import type {
  AddonPriceType,
  Room,
  RoomAddon,
  RoomCatalog,
  RoomHoursPayload,
  RoomUpsertPayload,
} from '../../types/booking'
import { hhmm, money, PERMISSIONS, withSeconds } from './bookingShared'
import { t as translate } from '../../i18n/t'
import './bookings.css'

/**
 * The room catalogue: what each room is, when it is open, and what can be added to a booking of it.
 *
 * ALL THREE ARE EDITED FROM ONE PAGE because they are one decision. A room whose hours nobody set is
 * a room that cannot be booked, and a price list that lives on another screen is one nobody updates
 * when the price changes.
 *
 * THE ROOM FORM SENDS EVERY FIELD, ALWAYS. The server UPDATEs the whole row, so a field left out of
 * the body is stored as its default rather than left alone — an edit that posted only the name would
 * silently reset the deposit to 0%. The dialog is therefore seeded from the room it is editing, not
 * from blanks.
 *
 * RE-PRICING IS SAFE AND WORTH KNOWING. A room's rate and an add-on's price are copied onto a
 * booking when it is taken, so changing either here moves nothing that is already booked.
 */
export default function RoomsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(PERMISSIONS.manage)

  const [catalog, setCatalog] = useState<RoomCatalog>({ rooms: [], hours: [], addons: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<Room | null>(null)
  const [creating, setCreating] = useState(false)
  const [hoursFor, setHoursFor] = useState<Room | null>(null)
  const [addonsFor, setAddonsFor] = useState<Room | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCatalog(await roomsService.getCatalog(true))
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage, load])

  if (!canManage) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('booking.rooms.title')}</h1>
          </div>
        </div>
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.noAccess')}</div>
            {t('booking.rooms.manageOnly')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('booking.rooms.title')}</h1>
          <p className="page-subtitle">{t('booking.rooms.subtitle')}</p>
        </div>
        <div className="page-head-actions">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            {t('booking.rooms.newRoom')}
          </Button>
        </div>
      </div>

      <PageHelp>{t('booking.rooms.help')}</PageHelp>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="page-loading">
          <Loader size={40} />
        </div>
      ) : catalog.rooms.length === 0 ? (
        <div className="card">
          <div className="empty-hint">
            <div className="empty-hint-main">{t('booking.rooms.empty')}</div>
            {t('booking.rooms.emptyHint')}
          </div>
        </div>
      ) : (
        <div className="bk-room-grid">
          {catalog.rooms.map((room) => {
            const hours = catalog.hours
              .filter((h) => h.roomId === room.roomId)
              .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
            const addons = catalog.addons.filter((a) => a.roomId === room.roomId)

            return (
              <div
                key={room.roomId}
                className={
                  room.isActive ? 'bk-room-card' : 'bk-room-card bk-room-card--inactive'
                }
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{room.name}</strong>
                  <Badge color={room.isActive ? 'green' : 'gray'} variant="light">
                    {room.isActive ? t('booking.rooms.active') : t('booking.rooms.inactive')}
                  </Badge>
                </div>

                <div className="hint" style={{ margin: 0 }}>
                  {room.code}
                  {room.description ? ` · ${room.description}` : ''}
                </div>

                <div className="bk-detail-grid">
                  <span className="bk-detail-label">{t('booking.rooms.capacity')}</span>
                  <span className="bk-detail-value">
                    {t('booking.rooms.capacityValue', {
                      min: room.minPersons,
                      max: room.seats,
                    })}
                  </span>

                  <span className="bk-detail-label">{t('booking.rooms.rate')}</span>
                  <span className="bk-detail-value">
                    {t('booking.rooms.rateValue', {
                      price: money(room.pricePerHour, room.currencyCode),
                    })}
                  </span>

                  <span className="bk-detail-label">{t('booking.rooms.deposit')}</span>
                  <span className="bk-detail-value">{room.depositPercent}%</span>

                  <span className="bk-detail-label">{t('booking.rooms.length')}</span>
                  <span className="bk-detail-value">
                    {t('booking.rooms.lengthValue', {
                      min: room.minHours ?? t('booking.rooms.systemDefault'),
                      max: room.maxHours ?? t('booking.rooms.systemDefault'),
                    })}
                  </span>

                  {/* The number that makes retiring a room an informed act rather than a guess. */}
                  <span className="bk-detail-label">{t('booking.rooms.futureBookings')}</span>
                  <span className="bk-detail-value">{room.futureBookings}</span>
                </div>

                {room.features && (
                  <div className="hint" style={{ margin: 0 }}>
                    {room.features}
                  </div>
                )}

                <div className="bk-room-hours">
                  {hours.map((row) => (
                    <span key={row.dayOfWeek} style={{ display: 'contents' }}>
                      <span>{t(`common.weekday.${row.dayOfWeek}`)}</span>
                      <span>
                        {row.isClosed
                          ? t('booking.rooms.closed')
                          : `${hhmm(row.openTime)}–${hhmm(row.closeTime)}`}
                      </span>
                    </span>
                  ))}
                  {hours.length === 0 && <span>{t('booking.rooms.noHours')}</span>}
                </div>

                <div className="hint" style={{ margin: 0 }}>
                  {addons.length === 0
                    ? t('booking.rooms.noAddons')
                    : t('booking.rooms.addonCount', { count: addons.length })}
                </div>

                <div className="form-actions" style={{ marginTop: 'auto' }}>
                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconPencil size={14} />}
                    onClick={() => setEditing(room)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconClock size={14} />}
                    onClick={() => setHoursFor(room)}
                  >
                    {t('booking.rooms.hours')}
                  </Button>
                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconSparkles size={14} />}
                    onClick={() => setAddonsFor(room)}
                  >
                    {t('booking.rooms.addons')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <RoomEditModal
        room={editing}
        opened={editing != null || creating}
        onClose={() => {
          setEditing(null)
          setCreating(false)
        }}
        onSaved={load}
      />

      <RoomHoursModal
        room={hoursFor}
        catalog={catalog}
        opened={hoursFor != null}
        onClose={() => setHoursFor(null)}
        onSaved={load}
      />

      <RoomAddonsModal
        room={addonsFor}
        catalog={catalog}
        opened={addonsFor != null}
        onClose={() => setAddonsFor(null)}
        onSaved={load}
      />
    </div>
  )
}

/* ── the room form ───────────────────────────────────────────────────────────────────────────── */

/** A blank room, carrying the same defaults the server would apply — see the page remark on why. */
function blankRoom(): RoomUpsertPayload {
  return {
    code: '',
    name: '',
    nameAr: null,
    seats: 4,
    minPersons: 1,
    pricePerHour: 0,
    currencyCode: 'USD',
    depositPercent: 50,
    minHours: null,
    maxHours: null,
    description: null,
    features: null,
    policyText: null,
    photoKey: null,
    sortOrder: 0,
    isActive: true,
  }
}

function RoomEditModal({
  room,
  opened,
  onClose,
  onSaved,
}: {
  /** null = create. */
  room: Room | null
  opened: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()

  const [form, setForm] = useState<RoomUpsertPayload>(blankRoom())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Seeded from the room being edited, EVERY field of it. A form that started blank would post
     blanks over the fields nobody touched. */
  useEffect(() => {
    if (!opened) return

    setForm(
      room
        ? {
            code: room.code,
            name: room.name,
            nameAr: room.nameAr,
            seats: room.seats,
            minPersons: room.minPersons,
            pricePerHour: room.pricePerHour,
            currencyCode: room.currencyCode,
            depositPercent: room.depositPercent,
            minHours: room.minHours,
            maxHours: room.maxHours,
            description: room.description,
            features: room.features,
            policyText: room.policyText,
            photoKey: room.photoKey,
            sortOrder: room.sortOrder,
            isActive: room.isActive,
          }
        : blankRoom(),
    )
    setError(null)
  }, [opened, room])

  function set<K extends keyof RoomUpsertPayload>(key: K, value: RoomUpsertPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const missing = form.code.trim() === '' || form.name.trim() === '' || form.seats < 1

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      if (room) await roomsService.update(room.roomId, form)
      else await roomsService.create(form)

      notifications.show({ message: t('booking.rooms.saved'), color: 'green' })
      onSaved()
      onClose()
    } catch (err) {
      // "A room with that code already exists." / "Check seats, price and deposit percent."
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={room ? t('booking.rooms.editRoom') : t('booking.rooms.newRoom')}
      size={620}
      centered
    >
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <div className="form-grid">
        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-code">
            {t('booking.rooms.code')}
          </label>
          <TextInput
            id="bk-room-code"
            value={form.code}
            onChange={(e) => set('code', e.currentTarget.value)}
            maxLength={30}
          />
          <div className="hint">{t('booking.rooms.codeHint')}</div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-name">
            {t('booking.rooms.name')}
          </label>
          <TextInput
            id="bk-room-name"
            value={form.name}
            onChange={(e) => set('name', e.currentTarget.value)}
            maxLength={80}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-namear">
            {t('booking.rooms.nameAr')} {t('common.optional')}
          </label>
          <TextInput
            id="bk-room-namear"
            value={form.nameAr ?? ''}
            onChange={(e) => set('nameAr', e.currentTarget.value || null)}
            maxLength={80}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-sort">
            {t('booking.rooms.sortOrder')}
          </label>
          <NumberInput
            id="bk-room-sort"
            value={form.sortOrder}
            onChange={(v) => set('sortOrder', typeof v === 'number' ? v : 0)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-minp">
            {t('booking.rooms.minPersons')}
          </label>
          <NumberInput
            id="bk-room-minp"
            min={1}
            value={form.minPersons}
            onChange={(v) => set('minPersons', typeof v === 'number' ? v : 1)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-seats">
            {t('booking.rooms.seats')}
          </label>
          <NumberInput
            id="bk-room-seats"
            min={1}
            value={form.seats}
            onChange={(v) => set('seats', typeof v === 'number' ? v : 1)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-price">
            {t('booking.rooms.pricePerHour')}
          </label>
          <NumberInput
            id="bk-room-price"
            min={0}
            decimalScale={2}
            value={form.pricePerHour}
            onChange={(v) => set('pricePerHour', typeof v === 'number' ? v : 0)}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-ccy">
            {t('common.currency')}
          </label>
          <TextInput
            id="bk-room-ccy"
            value={form.currencyCode}
            onChange={(e) => set('currencyCode', e.currentTarget.value.toUpperCase())}
            maxLength={3}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-dep">
            {t('booking.rooms.depositPercent')}
          </label>
          <NumberInput
            id="bk-room-dep"
            min={0}
            max={100}
            decimalScale={2}
            value={form.depositPercent}
            onChange={(v) => set('depositPercent', typeof v === 'number' ? v : 0)}
          />
          <div className="hint">{t('booking.rooms.depositHint')}</div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-minh">
            {t('booking.rooms.minHours')} {t('common.optional')}
          </label>
          <NumberInput
            id="bk-room-minh"
            min={1}
            value={form.minHours ?? ''}
            onChange={(v) => set('minHours', typeof v === 'number' ? v : null)}
          />
          <div className="hint">{t('booking.rooms.hoursNullHint')}</div>
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-room-maxh">
            {t('booking.rooms.maxHours')} {t('common.optional')}
          </label>
          <NumberInput
            id="bk-room-maxh"
            min={1}
            value={form.maxHours ?? ''}
            onChange={(v) => set('maxHours', typeof v === 'number' ? v : null)}
          />
        </div>

        <div className="form-field full">
          <label className="form-label" htmlFor="bk-room-desc">
            {t('common.description')} {t('common.optional')}
          </label>
          <TextInput
            id="bk-room-desc"
            value={form.description ?? ''}
            onChange={(e) => set('description', e.currentTarget.value || null)}
            maxLength={300}
          />
        </div>

        <div className="form-field full">
          <label className="form-label" htmlFor="bk-room-features">
            {t('booking.rooms.features')} {t('common.optional')}
          </label>
          <TextInput
            id="bk-room-features"
            value={form.features ?? ''}
            onChange={(e) => set('features', e.currentTarget.value || null)}
            maxLength={300}
          />
          <div className="hint">{t('booking.rooms.featuresHint')}</div>
        </div>

        <div className="form-field full">
          <label className="form-label" htmlFor="bk-room-policy">
            {t('booking.rooms.policyText')} {t('common.optional')}
          </label>
          <Textarea
            id="bk-room-policy"
            minRows={3}
            value={form.policyText ?? ''}
            onChange={(e) => set('policyText', e.currentTarget.value || null)}
            maxLength={1000}
          />
          <div className="hint">{t('booking.rooms.policyHint')}</div>
        </div>

        <div className="form-field full">
          <Switch
            checked={form.isActive}
            onChange={(e) => set('isActive', e.currentTarget.checked)}
            label={t('booking.rooms.activeLabel')}
          />
          {room && room.futureBookings > 0 && !form.isActive && (
            <div className="hint">
              {t('booking.rooms.deactivateWarning', { count: room.futureBookings })}
            </div>
          )}
        </div>
      </div>

      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} loading={saving} disabled={missing}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  )
}

/* ── the weekly hours ────────────────────────────────────────────────────────────────────────── */

/** Seven rows, Monday first — the same 1..7 the server stores and the calendar reads. */
function blankWeek(): RoomHoursPayload[] {
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index + 1,
    openTime: '09:00',
    closeTime: '22:00',
    isClosed: false,
  }))
}

function RoomHoursModal({
  room,
  catalog,
  opened,
  onClose,
  onSaved,
}: {
  room: Room | null
  catalog: RoomCatalog
  opened: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()

  const [week, setWeek] = useState<RoomHoursPayload[]>(blankWeek())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened || !room) return

    const stored = catalog.hours.filter((h) => h.roomId === room.roomId)
    setWeek(
      blankWeek().map((day) => {
        const match = stored.find((h) => h.dayOfWeek === day.dayOfWeek)
        return match
          ? {
              dayOfWeek: day.dayOfWeek,
              openTime: hhmm(match.openTime),
              closeTime: hhmm(match.closeTime),
              isClosed: match.isClosed,
            }
          : day
      }),
    )
    setError(null)
  }, [opened, room, catalog.hours])

  function setDay(dayOfWeek: number, patch: Partial<RoomHoursPayload>) {
    setWeek((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    )
  }

  async function submit() {
    if (!room) return

    setSaving(true)
    setError(null)
    try {
      await roomsService.setHours(
        room.roomId,
        week.map((day) => ({
          ...day,
          openTime: withSeconds(day.openTime),
          closeTime: withSeconds(day.closeTime),
        })),
      )
      notifications.show({ message: t('booking.rooms.hoursSaved'), color: 'green' })
      onSaved()
      onClose()
    } catch (err) {
      // "Close time must be after open time." The server applies the week a day at a time and is
      // not transactional, so the days before the refused one are already stored — hence the hint.
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('booking.rooms.hoursTitle', { room: room?.name ?? '' })}
      size={520}
      centered
    >
      {error && (
        <>
          <div className="alert alert--error" role="alert">
            {error}
          </div>
          <div className="hint">{t('booking.rooms.hoursPartialHint')}</div>
        </>
      )}

      <div className="bk-hours-editor">
        {week.map((day) => (
          <span key={day.dayOfWeek} style={{ display: 'contents' }}>
            <span className="form-label" style={{ alignSelf: 'center' }}>
              {t(`common.weekday.${day.dayOfWeek}`)}
            </span>
            <TextInput
              type="time"
              w={120}
              value={day.openTime}
              disabled={day.isClosed}
              aria-label={t('booking.rooms.openTime')}
              onChange={(e) => setDay(day.dayOfWeek, { openTime: e.currentTarget.value })}
            />
            <TextInput
              type="time"
              w={120}
              value={day.closeTime}
              disabled={day.isClosed}
              aria-label={t('booking.rooms.closeTime')}
              onChange={(e) => setDay(day.dayOfWeek, { closeTime: e.currentTarget.value })}
            />
            <Checkbox
              checked={day.isClosed}
              label={t('booking.rooms.closed')}
              onChange={(e) => setDay(day.dayOfWeek, { isClosed: e.currentTarget.checked })}
            />
          </span>
        ))}
      </div>

      <div className="hint">{t('booking.rooms.hoursHint')}</div>

      <div className="form-actions">
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} loading={saving}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  )
}

/* ── add-ons ─────────────────────────────────────────────────────────────────────────────────── */

/** The two price types, named for the dropdown. */
function priceTypeOptions() {
  return [
    { value: 'PerHour', label: translate('booking.rooms.priceType.PerHour') },
    { value: 'Fixed', label: translate('booking.rooms.priceType.Fixed') },
  ]
}

function RoomAddonsModal({
  room,
  catalog,
  opened,
  onClose,
  onSaved,
}: {
  room: Room | null
  catalog: RoomCatalog
  opened: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()

  const [addons, setAddons] = useState<RoomAddon[]>([])
  const [name, setName] = useState('')
  const [priceType, setPriceType] = useState<AddonPriceType>('PerHour')
  const [price, setPrice] = useState<number>(0)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened || !room) return
    setAddons(catalog.addons.filter((a) => a.roomId === room.roomId))
    resetForm()
    setError(null)
  }, [opened, room, catalog.addons])

  function resetForm() {
    setEditingId(null)
    setName('')
    setPriceType('PerHour')
    setPrice(0)
    setIsActive(true)
  }

  function startEdit(addon: RoomAddon) {
    setEditingId(addon.addonId)
    setName(addon.name)
    setPriceType(addon.priceType)
    setPrice(addon.price)
    setIsActive(addon.isActive)
  }

  async function submit() {
    if (!room || name.trim() === '') return

    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), priceType, price, isActive }
      if (editingId == null) await roomsService.createAddon(room.roomId, payload)
      else await roomsService.updateAddon(room.roomId, editingId, payload)

      notifications.show({ message: t('booking.rooms.addonSaved'), color: 'green' })
      resetForm()
      onSaved()
      onClose()
    } catch (err) {
      // "Price type is PerHour or Fixed."
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('booking.rooms.addonsTitle', { room: room?.name ?? '' })}
      size={520}
      centered
    >
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      {addons.length === 0 ? (
        <div className="hint">{t('booking.rooms.noAddons')}</div>
      ) : (
        addons.map((addon) => (
          <div className="bk-money-row" key={addon.addonId}>
            <span>
              {addon.name}
              {!addon.isActive && ` · ${t('booking.rooms.inactive')}`}
              <br />
              <span className="bk-detail-label">
                {t(`booking.rooms.priceType.${addon.priceType}`)} ·{' '}
                {money(addon.price, room?.currencyCode ?? '')}
              </span>
            </span>
            <Button variant="subtle" size="xs" onClick={() => startEdit(addon)}>
              {t('common.edit')}
            </Button>
          </div>
        ))
      )}

      <h3 className="card-title" style={{ marginTop: 16 }}>
        {editingId == null
          ? t('booking.rooms.addAddon')
          : t('booking.rooms.editAddon')}
      </h3>

      <div className="form-grid">
        <div className="form-field full">
          <label className="form-label" htmlFor="bk-addon-name">
            {t('booking.rooms.addonName')}
          </label>
          <TextInput
            id="bk-addon-name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={80}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-addon-type">
            {t('booking.rooms.addonPriceType')}
          </label>
          <Select
            id="bk-addon-type"
            data={priceTypeOptions()}
            value={priceType}
            onChange={(value) => setPriceType((value as AddonPriceType) ?? 'PerHour')}
            allowDeselect={false}
          />
        </div>

        <div className="form-field">
          <label className="form-label" htmlFor="bk-addon-price">
            {t('booking.rooms.addonPrice')}
          </label>
          <NumberInput
            id="bk-addon-price"
            min={0}
            decimalScale={2}
            value={price}
            onChange={(v) => setPrice(typeof v === 'number' ? v : 0)}
          />
        </div>

        <div className="form-field full">
          <Switch
            checked={isActive}
            onChange={(e) => setIsActive(e.currentTarget.checked)}
            label={t('booking.rooms.addonActive')}
          />
          <div className="hint">{t('booking.rooms.addonRepriceHint')}</div>
        </div>
      </div>

      <div className="form-actions">
        {editingId != null && (
          <Button variant="subtle" onClick={resetForm} disabled={saving}>
            {t('booking.rooms.addNewInstead')}
          </Button>
        )}
        <Button variant="default" onClick={onClose} disabled={saving}>
          {t('common.close')}
        </Button>
        <Button onClick={submit} loading={saving} disabled={name.trim() === ''}>
          {t('common.save')}
        </Button>
      </div>
    </Modal>
  )
}
