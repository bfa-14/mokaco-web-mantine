import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowLeft,
  IconArrowRight,
  IconBulb,
  IconCalendarEvent,
  IconCash,
  IconChartBar,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconCreditCard,
  IconDeviceFloppy,
  IconDownload,
  IconHelp,
  IconHome,
  IconKey,
  IconLayoutList,
  IconListNumbers,
  IconLock,
  IconLogout,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSitemap,
  IconSquareX,
  IconTrash,
  IconUpload,
  IconUser,
  IconUserQuestion,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import type { Icon } from '@tabler/icons-react'
import { currentDirection } from '../i18n'

/**
 * The original app's DevExtreme font-icon names, mapped to the Tabler glyph that looks like the
 * one DX drew.
 *
 * WHY A MAP AND NOT JUST TABLER IMPORTS AT EACH CALL SITE. The port carried the DX icon NAMES
 * through — the nav tables still key on 'card', 'tips', 'hierarchy' — and several of those names
 * do not mean what an English reader assumes: DX's `card` is a CREDIT CARD, not an ID badge; its
 * `tips` is a LIGHTBULB, not a monitor; its `hierarchy` is a boxes org-tree, not a dot tree; its
 * `chart` is a BAR chart, not a line. Each of those had been guessed differently at a different
 * call site. One table is what stops a glyph meaning two things in two places.
 *
 * Keys are DX's names exactly, so this file diffs against the original's `icon=` props.
 */
export const DX_ICONS: Record<string, Icon> = {
  /* toolbar verbs */
  refresh: IconRefresh,
  plus: IconPlus,
  add: IconPlus,
  edit: IconPencil,
  trash: IconTrash,
  search: IconSearch,
  find: IconSearch,
  print: IconPrinter,
  upload: IconUpload,
  download: IconDownload,
  revert: IconArrowBackUp,
  undo: IconArrowBackUp,
  check: IconCheck,
  copy: IconCopy,
  save: IconDeviceFloppy,
  close: IconX,
  clearsquare: IconSquareX,
  /* DX called the sign-out glyph 'export' — an arrow leaving a box. */
  export: IconLogout,

  /* nouns */
  clock: IconClock,
  user: IconUser,
  key: IconKey,
  event: IconCalendarEvent,
  home: IconHome,
  checklist: IconChecklist,
  preferences: IconSettings,
  group: IconUsers,
  orderedlist: IconListNumbers,
  money: IconCash,
  help: IconHelp,
  warning: IconAlertTriangle,
  detailslayout: IconLayoutList,
  lock: IconLock,

  /* the four DX names whose glyph is not what the name suggests */
  card: IconCreditCard,
  tips: IconBulb,
  hierarchy: IconSitemap,
  chart: IconChartBar,

  /* DX's 'taskhelpneeded' is a person carrying a question mark — a role waiting to be filled. */
  taskhelpneeded: IconUserQuestion,

  /**
   * DX's group expander was 'spf': a DOWN chevron that rotates 180° when the group opens. Down
   * and up are direction-NEUTRAL, which is why the original needed no RTL handling here and why
   * a right-pointing chevron would have been wrong in Arabic.
   */
  spf: IconChevronDown,
}

/** The DX glyph for `name`, or the neutral list icon for a name nothing maps. */
export function dxIcon(name: string): Icon {
  return DX_ICONS[name] ?? IconLayoutList
}

/**
 * The two arrows that mean BACKWARDS and FORWARDS rather than left and right.
 *
 * DevExtreme flipped these under `rtlEnabled`; Tabler will not, because an SVG has no opinion
 * about the page. Reading the direction AT RENDER (not at import) is what makes them follow a
 * language switch — LanguageProvider remounts the routed tree, so every instance is rebuilt.
 *
 * `back` is the Back button and the previous-period arrow; `arrowright` is onwards/next.
 */
export function DirectionalIcon({
  name,
  size = 16,
  stroke = 1.75,
  className,
}: {
  name: 'back' | 'arrowright'
  size?: number
  stroke?: number
  className?: string
}) {
  const rtl = currentDirection() === 'rtl'
  const pointsStart = name === 'back' ? !rtl : rtl
  const Cmp = pointsStart ? IconArrowLeft : IconArrowRight
  return <Cmp size={size} stroke={stroke} className={className} aria-hidden="true" />
}
