import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { notifications } from '@mantine/notifications'
import { IconCalendarPlus } from '@tabler/icons-react'
import { useAuth } from '../../auth/useAuth'
import { useBookingChanged } from '../../live/bookingLive'
import { bookingDrawerLink, PERMISSIONS } from './bookingShared'

/**
 * "New booking from the website — MC-…", wherever in the app the user happens to be.
 *
 * Mounted once in the layout, renders nothing. A request made on the website waits for a person to
 * confirm it, and until now that person found out by reloading the calendar; the toast is that
 * moment arriving by itself. Clicking it opens the booking's drawer, where Confirm is.
 *
 * ONLY Pending + Website. Every other change (a colleague's confirmation, a payment, a manual
 * booking somebody here just typed) refreshes the pages that show it and says nothing: a toast for
 * what the user did themselves is noise, and one for every status change would teach people to
 * ignore the one that matters.
 *
 * It stays until dismissed or clicked — a request that scrolled away after four seconds while the
 * barista was making coffee is a request nobody confirmed. One per booking: the id is the
 * notification's id, so a second message about the same booking updates it rather than stacking.
 */
export function BookingLiveToasts() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const mayRead = hasPermission(PERMISSIONS.view) || hasPermission(PERMISSIONS.manage)

  useBookingChanged((message) => {
    const id = `booking-live-${message.bookingId}`

    if (message.status !== 'Pending' || message.source !== 'Website') {
      // Decided (or cancelled by the guest) before anybody clicked: the prompt is out of date.
      notifications.hide(id)
      return
    }

    notifications.show({
      id,
      color: 'teal',
      icon: <IconCalendarPlus size={18} />,
      autoClose: false,
      withCloseButton: true,
      title: t('booking.live.newWebsiteTitle', { ref: message.ref }),
      message: t('booking.live.newWebsiteBody', { guest: message.guestName, room: message.roomCode, date: message.date }),
      style: { cursor: 'pointer' },
      onClick: () => {
        notifications.hide(id)
        navigate(bookingDrawerLink(message))
      },
    })
  }, mayRead)

  return null
}
