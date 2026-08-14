/** Row in the users grid — GET /api/users (mirrors backend UserListItem). */
export interface UserListItem {
  userId: number
  username: string
  isActive: boolean
  lastLoginAt: string | null
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
