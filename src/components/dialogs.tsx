import { Drawer as MantineDrawer, Modal as MantineModal, Button } from '@mantine/core'
import type { DrawerProps, ModalProps } from '@mantine/core'
import type { ReactNode } from 'react'
import { FormErrorBoundary } from '../pages/workflow/FormErrorBoundary'

/**
 * A CRASHING DIALOG MUST NOT BLANK THE PAGE BEHIND IT.
 *
 * A Mantine Modal renders through a portal, but React's error propagation follows the component
 * tree, not the DOM — so a render error inside a dialog body climbed past the page to the route
 * boundary and replaced the whole page with "This page could not be displayed", the dialog included.
 * That is how one add-on checkbox emptied the booking calendar.
 *
 * This boundary sits just inside the dialog. The error is shown IN the dialog, verbatim, with a
 * Close button that calls the dialog's own onClose; the page behind stays exactly as it was. The
 * reset key is the open state: closing clears a caught crash, so the next opening starts clean.
 *
 * The `Modal` and `Drawer` exported below are drop-in replacements for Mantine's — same props,
 * same behaviour — with their children wrapped in this boundary. Every dialog in the app imports
 * them instead of the Mantine originals, so the containment is a property of the import, not
 * something each dialog has to remember.
 */
export function ModalErrorBoundary({
  opened,
  onClose,
  children,
}: {
  opened: boolean
  onClose: () => void
  children: ReactNode
}) {
  return (
    <FormErrorBoundary
      resetKey={opened ? 'open' : 'closed'}
      tag="dialog"
      title="This dialog could not be displayed"
      hint="The page behind it still works. Close this and try again, or send the text below to whoever is fixing it."
      actions={
        <Button variant="default" onClick={onClose}>
          Close
        </Button>
      }
    >
      {children}
    </FormErrorBoundary>
  )
}

/** Mantine's Modal with its body contained. See {@link ModalErrorBoundary}. */
export function Modal({ children, ...props }: ModalProps) {
  return (
    <MantineModal {...props}>
      <ModalErrorBoundary opened={props.opened} onClose={props.onClose}>
        {children}
      </ModalErrorBoundary>
    </MantineModal>
  )
}

/** Mantine's Drawer with its body contained. See {@link ModalErrorBoundary}. */
export function Drawer({ children, ...props }: DrawerProps) {
  return (
    <MantineDrawer {...props}>
      <ModalErrorBoundary opened={props.opened} onClose={props.onClose}>
        {children}
      </ModalErrorBoundary>
    </MantineDrawer>
  )
}
