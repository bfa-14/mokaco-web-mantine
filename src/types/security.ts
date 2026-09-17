/** One role held by a user, as the users list may carry it. */
export interface UserRoleRef {
  roleId: number
  name: string
}

/**
 * Row in the users grid — GET /api/users (mirrors backend UserListItem).
 *
 * The employee and role fields are OPTIONAL because the API is gaining them in a separate change
 * (Username + Roles per user on GET /api/users). Until it lands the list carries only the four
 * original columns, and the grid must read as "unknown" for the rest rather than crash — so every
 * reader goes through {@link roleNamesOf} / {@link roleIdsOf}, which accept any of the shapes the
 * endpoint might reasonably return (names, ids, or {roleId, name} pairs) and an absent field.
 */
export interface UserListItem {
  userId: number
  username: string
  isActive: boolean
  lastLoginAt: string | null
  /** The linked employee, when the list carries it. */
  employeeId?: number | null
  employeeName?: string | null
  /** The user's roles, as names or as {roleId, name} pairs. */
  roles?: Array<string | UserRoleRef> | null
  /** The user's role ids, when the list carries them separately from the names. */
  roleIds?: number[] | null
}

/** The role names a list row carries, in list order — empty when the list carries none. */
export function roleNamesOf(user: UserListItem): string[] {
  if (Array.isArray(user.roles)) {
    return user.roles.map((r) => (typeof r === 'string' ? r : r.name)).filter(Boolean)
  }
  return []
}

/**
 * The role ids a list row stands for, resolved against the roles dictionary when the list carries
 * only names. Prefills the roles editor; a name the dictionary does not know is dropped.
 */
export function roleIdsOf(user: UserListItem, roles: Role[]): number[] {
  if (Array.isArray(user.roleIds)) return user.roleIds
  if (Array.isArray(user.roles)) {
    return user.roles
      .map((r) =>
        typeof r === 'string'
          ? (roles.find((x) => x.name.toLowerCase() === r.toLowerCase())?.roleId ?? null)
          : r.roleId,
      )
      .filter((id): id is number => id != null)
  }
  return []
}

/**
 * An account not yet claimed by any employee — GET /api/users/unlinked. The picker on the employee
 * accounts screen offers only these, so it cannot present an account that is already taken.
 */
export interface UnlinkedUser {
  userId: number
  username: string
  isActive: boolean
}

/** Payload for POST /api/users (mirrors backend CreateUserRequest). */
export interface CreateUserRequest {
  username: string
  password: string
  isActive: boolean
  roleIds: number[]
}

/** A role — GET /api/roles (mirrors backend Role). */
export interface Role {
  roleId: number
  name: string
  isSystem: boolean
  createdAt: string
  createdBy: number | null
  modifiedAt: string | null
  modifiedBy: number | null
}

/**
 * One approver role's rejection behaviour (GET /api/roles/rejection-behaviour).
 *
 * `rejectionEndsRequest` false (the default) means a rejection by this role is ADVICE — the next
 * approver still decides; true means the rejection STOPS the request there. `meaning` is the
 * database's own plain-language reading of that flag, shown verbatim rather than reworded.
 */
export interface RoleRejectionBehaviour {
  roleId: number
  name: string
  isSystem: boolean
  usableAsApprover: boolean
  rejectionEndsRequest: boolean
  meaning: string
}

/**
 * A role's approver-usage and signature flags (GET /api/roles/signature-requirements) — two of the
 * three "workflow behaviour" settings. `usableAsApprover` gates whether the role appears in chains at
 * all; `requiresSignaturePassword` whether its decisions must be re-signed with a password.
 * `activeMemberCount` is context for both — a role nobody holds can neither approve nor sign.
 */
export interface RoleSignatureRequirement {
  roleId: number
  name: string
  isSystem: boolean
  usableAsApprover: boolean
  requiresSignaturePassword: boolean
  activeMemberCount: number
}

/** A permission — GET /api/roles/permissions (mirrors backend Permission). */
export interface Permission {
  permissionId: number
  code: string
  name: string
  module: string
}

/**
 * A user's signature, metadata ONLY (GET /api/users/signatures). The image bytes never travel in
 * this list — the thumbnail is fetched per row from its own URL. HasSignature drives the column.
 */
export interface UserSignatureInfo {
  userId: number
  username: string
  hasSignature: boolean
  contentType: string | null
  fileName: string | null
  byteSize: number | null
  updatedAt: string | null
  updatedByUsername: string | null
}
