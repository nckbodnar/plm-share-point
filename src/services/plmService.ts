/**
 * PLM Service
 *
 * Provides an abstract interface to the PLM REST API.  Two implementations are
 * available:
 *   • RealPlmService  – talks to the configured on-premise PLM server via HTTP.
 *   • MockPlmService  – returns realistic static data (useful when PLM_USE_MOCK=true).
 *
 * The `getPlmService()` factory returns the correct implementation based on
 * the value of `config.plm.useMock`.
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import type { Part, PartRevision, LifecycleState } from '../types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IPlmService {
  /**
   * Return all parts whose current lifecycle state is "Released".
   * Only the latest and (if available) previous released revision are returned.
   */
  getReleasedParts(): Promise<Part[]>;

  /**
   * Return a single released part by its PLM ID.
   * Throws if the part does not exist or is not Released.
   */
  getReleasedPartById(id: string): Promise<Part>;

  /**
   * Return the raw document/file bytes for a specific document ID.
   * The caller is responsible for setting the correct Content-Type header.
   */
  getDocumentContent(documentId: string): Promise<{ data: Buffer; contentType: string; fileName: string }>;
}

// ---------------------------------------------------------------------------
// Real implementation
// ---------------------------------------------------------------------------

/**
 * Concrete PLM integration that calls the on-premise PLM REST API.
 *
 * The PLM API is expected to follow a RESTful convention where:
 *   GET /parts?lifecycleState=Released    → list released parts
 *   GET /parts/:id                        → single part
 *   GET /documents/:docId/content         → file bytes
 *
 * Authentication is performed via a Bearer API key (preferred) or HTTP Basic.
 * Adjust the mapping functions below if your PLM API uses different field names.
 */
export class RealPlmService implements IPlmService {
  private readonly http: AxiosInstance;

  constructor() {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.plm.apiKey) {
      headers['Authorization'] = `Bearer ${config.plm.apiKey}`;
    }

    this.http = axios.create({
      baseURL: config.plm.baseUrl,
      timeout: config.plm.timeoutMs,
      headers,
      auth:
        config.plm.username && config.plm.password
          ? { username: config.plm.username, password: config.plm.password }
          : undefined,
    });
  }

  async getReleasedParts(): Promise<Part[]> {
    const res = await this.http.get<PlmApiPartList>('/parts', {
      params: { lifecycleState: 'Released', pageSize: 500 },
    });
    return (res.data.items ?? []).map(mapApiPart).filter((p) => p.lifecycleState === 'Released');
  }

  async getReleasedPartById(id: string): Promise<Part> {
    const res = await this.http.get<PlmApiPart>(`/parts/${encodeURIComponent(id)}`);
    const part = mapApiPart(res.data);
    if (part.lifecycleState !== 'Released') {
      throw new Error(`Part ${id} is not in Released state.`);
    }
    return part;
  }

  async getDocumentContent(
    documentId: string,
  ): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    const res = await this.http.get<Buffer>(`/documents/${encodeURIComponent(documentId)}/content`, {
      responseType: 'arraybuffer',
    });
    const contentType = (res.headers['content-type'] as string | undefined) ?? 'application/octet-stream';
    const disposition = (res.headers['content-disposition'] as string | undefined) ?? '';
    const fileNameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const fileName = fileNameMatch ? fileNameMatch[1].replace(/['"]/g, '') : `document-${documentId}`;
    return { data: Buffer.from(res.data), contentType, fileName };
  }
}

// ---------------------------------------------------------------------------
// Raw API shapes returned by the PLM server
// ---------------------------------------------------------------------------

interface PlmApiRevision {
  revision: string;
  releaseDate?: string;
  releasedBy?: string;
  lifecycleState?: string;
  documentId?: string;
  specificationFileName?: string;
}

interface PlmApiPart {
  id: string;
  partNumber?: string;
  name?: string;
  description?: string;
  lifecycleState?: string;
  latestRevision?: PlmApiRevision;
  previousRevision?: PlmApiRevision;
  updatedAt?: string;
}

interface PlmApiPartList {
  items: PlmApiPart[];
}

function mapApiRevision(r: PlmApiRevision): PartRevision {
  return {
    revision: r.revision,
    releaseDate: r.releaseDate ?? '',
    releasedBy: r.releasedBy,
    lifecycleState: (r.lifecycleState ?? 'Released') as LifecycleState,
    documentId: r.documentId,
    specificationFileName: r.specificationFileName,
  };
}

function mapApiPart(p: PlmApiPart): Part {
  const latestRevision: PartRevision = p.latestRevision
    ? mapApiRevision(p.latestRevision)
    : { revision: 'A', releaseDate: '', lifecycleState: 'Released' };

  return {
    id: p.id,
    partNumber: p.partNumber ?? p.id,
    name: p.name ?? p.partNumber ?? p.id,
    description: p.description,
    lifecycleState: (p.lifecycleState ?? 'Released') as LifecycleState,
    latestRevision,
    previousRevision: p.previousRevision ? mapApiRevision(p.previousRevision) : undefined,
    updatedAt: p.updatedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

const MOCK_PARTS: Part[] = [
  {
    id: 'part-001',
    partNumber: 'PN-10001',
    name: 'Titanium Scanning Body – Standard',
    description: 'Titanium scanning body for standard implant placement. Use with IOS scanner.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'C',
      releaseDate: '2024-03-15',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-001-C',
      specificationFileName: 'PN-10001_RevC_Specification.pdf',
    },
    previousRevision: {
      revision: 'B',
      releaseDate: '2023-09-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-001-B',
      specificationFileName: 'PN-10001_RevB_Specification.pdf',
    },
    updatedAt: '2024-03-15T10:30:00Z',
  },
  {
    id: 'part-002',
    partNumber: 'PN-10002',
    name: 'Zirconia Crown Blank – HT 98mm',
    description:
      'High-translucency zirconia milling blank, 98 mm disc format, for anterior and posterior restorations.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'B',
      releaseDate: '2024-01-20',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-002-B',
      specificationFileName: 'PN-10002_RevB_Specification.pdf',
    },
    previousRevision: {
      revision: 'A',
      releaseDate: '2023-05-12',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-002-A',
      specificationFileName: 'PN-10002_RevA_Specification.pdf',
    },
    updatedAt: '2024-01-20T14:00:00Z',
  },
  {
    id: 'part-003',
    partNumber: 'PN-10003',
    name: 'IOS Scanner Calibration Block',
    description: 'Reference calibration block for intra-oral scanner accuracy verification.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'A',
      releaseDate: '2023-11-05',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-003-A',
      specificationFileName: 'PN-10003_RevA_Specification.pdf',
    },
    updatedAt: '2023-11-05T09:00:00Z',
  },
  {
    id: 'part-004',
    partNumber: 'PN-10004',
    name: 'Abutment Screw – Hex 1.2mm',
    description:
      'Gold-coloured titanium abutment screw, hex 1.2 mm drive, M1.4 thread, 6 mm length.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'D',
      releaseDate: '2024-02-28',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-004-D',
      specificationFileName: 'PN-10004_RevD_Specification.pdf',
    },
    previousRevision: {
      revision: 'C',
      releaseDate: '2022-08-16',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-004-C',
      specificationFileName: 'PN-10004_RevC_Specification.pdf',
    },
    updatedAt: '2024-02-28T08:45:00Z',
  },
  {
    id: 'part-005',
    partNumber: 'PN-10005',
    name: 'Impression Coping – Open Tray',
    description: 'Snap-fit open-tray impression coping compatible with standard platform implants.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'A',
      releaseDate: '2024-04-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-005-A',
      specificationFileName: 'PN-10005_RevA_Specification.pdf',
    },
    updatedAt: '2024-04-01T11:00:00Z',
  },
];

/** In-memory mock document store (returns a simple text blob) */
const MOCK_DOCUMENT_CONTENT = `This is a placeholder specification document.
In a real deployment this file would be streamed from the PLM server.
Part specification data is intentionally not downloadable in bulk.`;

export class MockPlmService implements IPlmService {
  async getReleasedParts(): Promise<Part[]> {
    // Return copies so callers cannot mutate the source data
    return MOCK_PARTS.map((p) => ({ ...p }));
  }

  async getReleasedPartById(id: string): Promise<Part> {
    const part = MOCK_PARTS.find((p) => p.id === id);
    if (!part) {
      const error = new Error(`Part "${id}" not found or not Released.`);
      (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw error;
    }
    return { ...part };
  }

  async getDocumentContent(
    documentId: string,
  ): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    // Verify the documentId belongs to a known released document
    const known = MOCK_PARTS.flatMap((p) => [
      p.latestRevision.documentId,
      p.previousRevision?.documentId,
    ]).filter(Boolean);

    if (!known.includes(documentId)) {
      const error = new Error(`Document "${documentId}" not found.`);
      (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw error;
    }

    return {
      data: Buffer.from(MOCK_DOCUMENT_CONTENT, 'utf-8'),
      contentType: 'text/plain; charset=utf-8',
      fileName: `${documentId}-specification.txt`,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _service: IPlmService | null = null;

export function getPlmService(): IPlmService {
  if (!_service) {
    _service = config.plm.useMock ? new MockPlmService() : new RealPlmService();
  }
  return _service;
}

/** Replace the service singleton (used in tests). */
export function setPlmService(svc: IPlmService): void {
  _service = svc;
}
