/**
 * WHICH LEDGER ROW MAY BE DELETED (QA3 LEV-9).
 *
 * Only a manual adjustment -- an HR correction -- may be deleted. Every other movement is kept right by what wrote it:
 * an approved leave (retract or reopen it), the year opening (undo it), an exit permission's conversion, the carry-over
 * expiry. hr.usp_LeaveLedger_Delete refuses those with a sentence, and GET /api/leave-ledger/by-employee says which row
 * is which (canDelete), so the delete is offered only where it can work. A row from an API that does not say is not
 * offered the delete.
 *
 * Pure, no imports but a type: run by `npm test` with nothing but Node.
 */
export interface DeletableRow {
  canDelete?: boolean | null
}

export function isDeletableLedgerRow(row: DeletableRow): boolean {
  return row.canDelete === true
}
