import { apiRequest } from '../api/client'
import { API_BASE_URL } from '../config'
import { tokenStorage } from '../auth/tokenStorage'
import type {
  CreateUserRequest,
  Permission,
  Role,
  RoleRejectionBehaviour,
  RoleSignatureRequirement,
  UnlinkedUser,
  UserListItem,
  UserSignatureInfo,
} from '../types/security'

/** Users administration — all endpoints require the USER_MANAGE permission. */
export const usersService = {
  getAll(): Promise<UserListItem[]> {
    return apiRequest<UserListItem[]>('/api/users')
  },

  /** Accounts not yet linked to any employee — feeds the "link account" picker. */
  unlinked(): Promise<UnlinkedUser[]> {
    return apiRequest<UnlinkedUser[]>('/api/users/unlinked')
  },

  create(request: CreateUserRequest): Promise<{ userId: number }> {
    return apiRequest<{ userId: number }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  },

  setActive(userId: number, isActive: boolean): Promise<void> {
    return apiRequest<void>(
      `/api/users/${userId}/active?isActive=${isActive}`,
      { method: 'POST' },
    )
  },
}

/** Roles & permissions — all endpoints require the ROLE_MANAGE permission. */
export const rolesService = {
  getRoles(): Promise<Role[]> {
    return apiRequest<Role[]>('/api/roles')
  },

  createRole(name: string): Promise<{ roleId: number }> {
    return apiRequest<{ roleId: number }>('/api/roles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },

  updateRole(roleId: number, name: string): Promise<void> {
    return apiRequest<void>(`/api/roles/${roleId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
  },

  getPermissions(): Promise<Permission[]> {
    return apiRequest<Permission[]>('/api/roles/permissions')
  },

  getRolePermissionIds(roleId: number): Promise<number[]> {
    return apiRequest<number[]>(`/api/roles/${roleId}/permissions`)
  },

  /**
   * Replaces a role's permission set.
   *
   * NOTE: this endpoint is not yet implemented on the backend. The repository
   * method (RoleRepository.SetPermissionsAsync) exists, but no controller
   * action exposes it. Add a `PUT /api/roles/{id}/permissions` action that
   * calls it, then this will work end-to-end.
   */
  setRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    return apiRequest<void>(`/api/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(permissionIds),
    })
  },

  /** Every approver role with its rejection behaviour and the database's plain-language meaning of it. */
  getRejectionBehaviour(): Promise<RoleRejectionBehaviour[]> {
    return apiRequest<RoleRejectionBehaviour[]>('/api/roles/rejection-behaviour')
  },

  /**
   * Sets whether a rejection by this role ends the request. Returns the role's new standing, Meaning
   * included, so the caller shows the database's own wording rather than recomputing it.
   */
  setRejectionBehaviour(
    roleId: number,
    rejectionEndsRequest: boolean,
  ): Promise<RoleRejectionBehaviour> {
    return apiRequest<RoleRejectionBehaviour>(`/api/roles/${roleId}/rejection-behaviour`, {
      method: 'PUT',
      body: JSON.stringify({ rejectionEndsRequest }),
    })
  },

  /** Every role with its approver-usage and signature flags and active-member count. */
  getSignatureRequirements(): Promise<RoleSignatureRequirement[]> {
    return apiRequest<RoleSignatureRequirement[]>('/api/roles/signature-requirements')
  },

  /**
   * Sets whether a role may be chosen as an approver in chains. Returns the role's new standing.
   * REFUSES (409, message intact) to switch off a role still used by a published chain.
   */
  setApproverUsage(roleId: number, usableAsApprover: boolean): Promise<RoleSignatureRequirement> {
    return apiRequest<RoleSignatureRequirement>(`/api/roles/${roleId}/approver-usage`, {
      method: 'PUT',
      body: JSON.stringify({ usableAsApprover }),
    })
  },

  /** Sets whether decisions by this role must be password-signed. Returns the role's new standing. */
  setSignatureRequirement(
    roleId: number,
    requiresSignaturePassword: boolean,
  ): Promise<RoleSignatureRequirement> {
    return apiRequest<RoleSignatureRequirement>(`/api/roles/${roleId}/signature-requirement`, {
      method: 'PUT',
      body: JSON.stringify({ requiresSignaturePassword }),
    })
  },
}

/**
 * User signature images.
 *
 * The list carries only metadata; the bytes are fetched one image at a time. The image endpoint is
 * bearer-authenticated, and a plain <img src> cannot send the Authorization header — so the image
 * is fetched here WITH the token and handed back as an object URL. That is also why upload uses a
 * bare fetch rather than apiRequest: it needs the multipart body and the raw error text.
 */
export const signaturesService = {
  getAll(): Promise<UserSignatureInfo[]> {
    return apiRequest<UserSignatureInfo[]>('/api/users/signatures')
  },

  /**
   * Fetches one user's CURRENT signature as an object URL, authenticated. Returns null when the
   * user has none (404). The caller must revoke the URL when done, or it leaks.
   *
   * PASS THE VERSION (that signature's updatedAt). This URL is keyed by user id, so it answers with
   * different bytes after a replacement — re-running the fetch is not enough on its own if the HTTP
   * cache still holds the previous response for the same address.
   */
  async getImageObjectUrl(userId: number, version?: string | null): Promise<string | null> {
    const token = tokenStorage.getAccessToken()
    const bust = version ? `?v=${Date.parse(version) || encodeURIComponent(version)}` : ''
    const res = await fetch(`${API_BASE_URL}/api/users/${userId}/signature/image${bust}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Could not load the signature image (${res.status}).`)
    return URL.createObjectURL(await res.blob())
  },

  /** Uploads (or replaces) a signature. The server validates type and size and returns a readable error. */
  async upload(userId: number, file: File): Promise<void> {
    const token = tokenStorage.getAccessToken()
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`${API_BASE_URL}/api/users/${userId}/signature`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body,
    })
    if (!res.ok) {
      // The API returns { error } for a bad upload; surface that exact message.
      const problem = await res.json().catch(() => null)
      throw new Error(
        problem?.error ?? `Upload failed (${res.status}).`,
      )
    }
  },

  remove(userId: number): Promise<void> {
    return apiRequest<void>(`/api/users/${userId}/signature`, { method: 'DELETE' })
  },
}
