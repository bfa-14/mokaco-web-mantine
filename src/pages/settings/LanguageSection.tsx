import { Group, Radio, useDirection } from '@mantine/core'
import { SettingRow } from './SettingsCard'
import { useLanguage } from '../../i18n/useLanguage'
import { LANGUAGES, LANGUAGE_LABELS, LANGUAGE_DIRECTION } from '../../i18n/lang'
import type { Language } from '../../i18n/lang'

const ITEMS = LANGUAGES.map((value) => ({ value, text: LANGUAGE_LABELS[value] }))

/**
 * LANGUAGE — which language this person reads the app in, and therefore which way the page runs.
 *
 * NOT a system setting, and deliberately not permission-gated. It is stored per user on this
 * browser, so it shows for everybody: an owner choosing one language for the whole company would be
 * answering a question nobody asked them. Same reasoning, and the same home, as Live updates.
 *
 * Each language is named IN ITSELF. Somebody looking for Arabic is not helped by the word "Arabic"
 * written in English.
 *
 * A ROW of the Preferences card rather than a card of its own — it is one choice, and a full panel
 * for it said otherwise. The choice, the wording and where it is stored are all unchanged.
 */
export function LanguageRow() {
  const { language, setLanguage } = useLanguage()
  // Mantine keeps its own direction context (Popover placement, logical style props). applyLanguage
  // flips document.dir, but DirectionProvider only reads that at mount — so flip it here too, in the
  // same frame as the language switch. (PARITY.md "known divergences" item — now closed.)
  const { setDirection } = useDirection()

  return (
    <SettingRow
      label="Language / اللغة"
      hint={
        <>
          Applies immediately — no reload. Arabic lays the whole application out right-to-left,
          including the grids, the date pickers and anything you print. Numbers stay in Western
          digits (1234, not ١٢٣٤) in both languages, which is the business convention here.
        </>
      }
      note={
        <>
          Remembered per person on this browser. Some text that comes from the server — a refusal
          explaining why an approval was not allowed, and the automatic titles on requests — is
          still written in English and will read that way inside the Arabic layout.
        </>
      }
      control={
        <Radio.Group
          value={language}
          onChange={(value) => {
            // Guard kept from the original: never briefly set an undefined language, whatever the
            // control fires with mid-switch.
            if (value) {
              setLanguage(value as Language)
              setDirection(LANGUAGE_DIRECTION[value as Language])
            }
          }}
        >
          {/* layout="horizontal" — the options sit side by side, as before. */}
          <Group gap="lg">
            {ITEMS.map((item) => (
              <Radio key={item.value} value={item.value} label={item.text} />
            ))}
          </Group>
        </Radio.Group>
      }
    />
  )
}
