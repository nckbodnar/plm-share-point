/**
 * Shared TypeScript types for the PLM SharePoint application.
 */

/** Lifecycle state values as used in the PLM system */
export type LifecycleState =
  | 'Released'
  | 'Obsolete'
  | 'Preliminary'
  | 'In Work'
  | 'In Review';

/** A single revision of a part as returned by the PLM */
export interface PartRevision {
  /** Revision identifier, e.g. "A", "B", "01" */
  revision: string;
  /** ISO-8601 date when this revision was released */
  releaseDate: string;
  /** Name of the person who released this revision */
  releasedBy?: string;
  /** Lifecycle state of this specific revision */
  lifecycleState: LifecycleState;
  /** Internal document/file identifier in the PLM system */
  documentId?: string;
  /** Human-readable file name of the specification document */
  specificationFileName?: string;
}

/** A part record as returned by the PLM system */
export interface Part {
  /** Unique identifier in the PLM system */
  id: string;
  /** Part number (e.g. "PN-12345") */
  partNumber: string;
  /** Display name */
  name: string;
  /** Optional free-text description */
  description?: string;
  /** Current lifecycle state */
  lifecycleState: LifecycleState;
  /** Latest released revision (the one shown by default) */
  latestRevision: PartRevision;
  /** Previous released revision, if one exists */
  previousRevision?: PartRevision;
  /** ISO-8601 date of last update in PLM */
  updatedAt: string;
}

/** A registered user / access-request record */
export interface User {
  id: number;
  email: string;
  name: string;
  company?: string;
  /** bcrypt hash of password */
  passwordHash: string;
  /** Whether an admin has approved this account */
  isApproved: boolean;
  /** Whether this user is an admin (data owner) */
  isAdmin: boolean;
  /** Reason provided by the user when requesting access */
  reason?: string;
  /** ISO-8601 timestamp of when the request was submitted */
  requestedAt: string;
  /** ISO-8601 timestamp of when the account was approved */
  approvedAt?: string;
  /** Email of the admin who approved */
  approvedBy?: string;
  /** Optional notes from the admin */
  adminNotes?: string;
}

/** Minimal user payload stored inside a JWT */
export interface JwtPayload {
  userId: number;
  email: string;
  isAdmin: boolean;
}

/** A component (child part) within an assembly BOM */
export interface AssemblyComponent {
  /** Reference to the child part */
  part: Part;
  /** Quantity of this part in the assembly */
  quantity: number;
  /** Optional reference designator (e.g. "R1", "C2") */
  referenceDesignator?: string;
}

/** A single revision of an assembly */
export interface AssemblyRevision {
  /** Revision identifier, e.g. "A", "B", "01" */
  revision: string;
  /** ISO-8601 date when this revision was released */
  releaseDate: string;
  /** Name of the person who released this revision */
  releasedBy?: string;
  /** Lifecycle state of this specific revision */
  lifecycleState: LifecycleState;
  /** Components (child parts) in this revision of the assembly */
  components: AssemblyComponent[];
}

/** An assembly record – a collection of parts forming a product */
export interface Assembly {
  /** Unique identifier in the PLM system */
  id: string;
  /** Assembly number (e.g. "ASM-20001") */
  assemblyNumber: string;
  /** Display name */
  name: string;
  /** Optional free-text description */
  description?: string;
  /** Current lifecycle state */
  lifecycleState: LifecycleState;
  /** Latest released revision */
  latestRevision: AssemblyRevision;
  /** Previous released revision, if one exists */
  previousRevision?: AssemblyRevision;
  /** ISO-8601 date of last update in PLM */
  updatedAt: string;
}

/** Audit-log entry for tracking who viewed which part */
export interface AuditEntry {
  id: number;
  userId: number;
  userEmail: string;
  partId: string;
  partNumber: string;
  revision: string;
  action: 'view_part' | 'view_document' | 'view_assembly';
  accessedAt: string;
}
