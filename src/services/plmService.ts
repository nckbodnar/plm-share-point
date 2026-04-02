/**
 * PLM Service
 *
 * Provides an abstract interface to the PLM REST API.  Three implementations
 * are available:
 *   • ArasPlmService  – Aras Innovator PLM via SOAP/AML (PLM_TYPE=aras).
 *   • RealPlmService  – generic REST API (PLM_TYPE=generic).
 *   • MockPlmService  – returns realistic static data (PLM_TYPE=mock or PLM_USE_MOCK=true).
 *
 * The `getPlmService()` factory returns the correct implementation based on
 * the value of `config.plm.type` (with a fallback to `config.plm.useMock`).
 */

import crypto from 'node:crypto';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import type { Part, PartRevision, LifecycleState, Assembly } from '../types';

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

  /**
   * Return all assemblies whose current lifecycle state is "Released".
   */
  getAssemblies(): Promise<Assembly[]>;

  /**
   * Return a single released assembly by its PLM ID.
   * Throws if the assembly does not exist or is not Released.
   */
  getAssemblyById(id: string): Promise<Assembly>;

  /**
   * Add a new part to the data store and return the created part.
   * Throws with code CONFLICT if a part with the same id or partNumber already exists.
   * Only supported by MockPlmService; other adapters throw NOT_SUPPORTED.
   */
  addPart(part: Part): Promise<Part>;
}

// ---------------------------------------------------------------------------
// Aras Innovator PLM implementation (SOAP / AML)
// ---------------------------------------------------------------------------

/** Upper-case MD5 hex digest – the format Aras SOAP API expects for passwords.
 *  NOTE: MD5 is mandated by the Aras Innovator SOAP protocol (AUTHPASSWORD field);
 *  this is NOT used for local password storage. */
// lgtm[js/insufficient-password-hash]
function md5Upper(s: string): string {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

/** Escape the five predefined XML entities */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extract the text content of the first matching simple element.
 * Works for `<tag>value</tag>` and `<tag attr="x">value</tag>`.
 * Does NOT handle nested elements of the same tag name.
 */
function xmlText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  if (!m) return '';
  // Single-pass entity decode avoids double-decoding sequences like &amp;lt; → &lt; → <
  return m[1]
    .replace(/&(amp|lt|gt|quot|apos|#x[\da-fA-F]+|#\d+);/gi, (_, entity: string) => {
      switch (entity.toLowerCase()) {
        case 'amp':  return '&';
        case 'lt':   return '<';
        case 'gt':   return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        default:
          if (entity.startsWith('#x') || entity.startsWith('#X'))
            return String.fromCodePoint(parseInt(entity.slice(2), 16));
          if (entity.startsWith('#'))
            return String.fromCodePoint(parseInt(entity.slice(1), 10));
          return `&${entity};`;
      }
    })
    .trim();
}

/**
 * Extract a named XML attribute value from an attribute string.
 * E.g. xmlAttr('type="Part" id="abc"', 'id') → 'abc'
 */
function xmlAttr(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs);
  return m ? m[1] : '';
}

/**
 * Find all `<Item type="File">` leaf nodes anywhere in an AML XML string.
 *
 * `File` items are always leaf nodes in the Aras response (they never contain
 * nested `<Item>` elements), so a non-greedy regex is safe here.
 *
 * Exported so unit tests can exercise it without a live Aras server.
 */
export function findAllFileItems(
  xml: string,
): Array<{ fileId: string; fileName: string; mimeType: string }> {
  const files: Array<{ fileId: string; fileName: string; mimeType: string }> = [];
  const fileRe = /<Item\b([^>]*type="File"[^>]*)>([\s\S]*?)<\/Item>/gi;
  let m: RegExpExecArray | null;
  while ((m = fileRe.exec(xml)) !== null) {
    const attrStr = m[1]!;
    const body = m[2]!;
    if (/isError="1"/i.test(attrStr)) continue;
    const fileId = xmlAttr(attrStr, 'id') || xmlText(body, 'id');
    if (!fileId) continue;
    const fileName = xmlText(body, 'filename');
    const mimeType = xmlText(body, 'mimetype') || 'application/octet-stream';
    files.push({ fileId, fileName, mimeType });
  }
  return files;
}

/**
 * Parse a flat list of `<Item type="Part">` elements from an Aras SOAP/AML
 * response XML string.
 *
 * The function is exported so that unit tests can exercise it without an
 * actual Aras server.
 *
 * @internal
 */
export function parseArasPartList(xml: string): Part[] {
  const parts: Part[] = [];

  // Match every <Item ...>...</Item> block (non-greedy).
  // Because we request only scalar `select` properties the response will NOT
  // contain nested <Item> elements, so non-greedy is sufficient.
  const itemRe = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const attrStr = m[1]!;
    const body = m[2]!;

    // Only handle Part items; skip error markers (isError="1")
    if (!/type="Part"/i.test(attrStr)) continue;
    if (/isError="1"/i.test(attrStr)) continue;

    const id = xmlAttr(attrStr, 'id') || xmlText(body, 'id');
    if (!id) continue;

    const partNumber = xmlText(body, 'item_number') || id;
    const name = xmlText(body, 'name') || partNumber;
    const rawDesc = xmlText(body, 'description');
    const description = rawDesc || undefined;
    const state = (xmlText(body, 'state') || 'Released') as LifecycleState;
    const majorRev = xmlText(body, 'major_rev') || 'A';
    const releaseDate = xmlText(body, 'release_date') || '';
    const modifiedOn = xmlText(body, 'modified_on') || new Date().toISOString();

    parts.push({
      id,
      partNumber,
      name,
      description,
      lifecycleState: state,
      latestRevision: {
        revision: majorRev,
        releaseDate,
        lifecycleState: 'Released',
        // Use Part item ID as the document reference; getDocumentContent uses it
        // to look up attached files via the Aras REST file endpoint.
        documentId: id,
        specificationFileName: `${partNumber}_Rev${majorRev}_Specification`,
      },
      updatedAt: modifiedOn,
    });
  }

  return parts;
}

/**
 * Concrete PLM integration for Aras Innovator.
 *
 * Authentication uses the Aras SOAP/AML ApplyAML endpoint:
 *   POST {baseUrl}/Server/InnovatorServer.aspx
 *
 * The password is sent as an MD5 hash (upper-case hex), which is the
 * standard credential format required by all Aras Innovator versions.
 *
 * File downloads use the Aras REST file endpoint:
 *   GET {baseUrl}/api/v1/File/{fileId}/content
 * with HTTP Basic auth (username:MD5(password)).
 *
 * Environment variables:
 *   PLM_TYPE=aras
 *   PLM_BASE_URL=http://localhost/UA-LPT-MYBO-Aras3Shape-development
 *   PLM_USERNAME=admin
 *   PLM_PASSWORD=<plain-text password>
 *   PLM_ARAS_DATABASE=UA-LPT-MYBO-Aras3Shape-development  (optional – derived from PLM_BASE_URL)
 */
export class ArasPlmService implements IPlmService {
  private readonly soapEndpoint: string;
  private readonly database: string;
  private readonly authUser: string;
  /** MD5(password) upper-case hex as required by the Aras SOAP API */
  private readonly authPassword: string;
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  /** Cached OAuth token for Aras REST API v1 file downloads */
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.baseUrl = config.plm.baseUrl.replace(/\/+$/, '');

    // Derive the Aras database name from the last non-empty URL path segment
    // when PLM_ARAS_DATABASE is not set explicitly.
    this.database =
      config.plm.arasDatabase ||
      this.baseUrl.split('/').filter(Boolean).pop() ||
      'Aras';

    this.authUser = config.plm.username ?? 'admin';
    this.authPassword = config.plm.password ? md5Upper(config.plm.password) : '';

    this.soapEndpoint = `${this.baseUrl}/Server/InnovatorServer.aspx`;

    this.http = axios.create({ timeout: config.plm.timeoutMs });
  }

  /** Build a SOAP envelope that wraps an AML query string. */
  private buildEnvelope(aml: string): string {
    return (
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<SOAP-ENV:Body><ApplyAML>' +
      `<AUTHUSER>${escapeXml(this.authUser)}</AUTHUSER>` +
      `<AUTHPASSWORD>${this.authPassword}</AUTHPASSWORD>` +
      `<DATABASE>${escapeXml(this.database)}</DATABASE>` +
      '<LOCALE>en</LOCALE>' +
      '<TIMEZONE_NAME>UTC</TIMEZONE_NAME>' +
      `<AML>${aml}</AML>` +
      '</ApplyAML></SOAP-ENV:Body></SOAP-ENV:Envelope>'
    );
  }

  /** Execute an AML query and return the raw response XML. */
  private async callAml(aml: string): Promise<string> {
    const body = this.buildEnvelope(aml);
    const res = await this.http.post<string>(this.soapEndpoint, body, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      responseType: 'text',
    });
    const xml = typeof res.data === 'string' ? res.data : String(res.data);

    // Surface Aras SOAP fault messages as proper JS errors
    if (/<faultcode/i.test(xml) && !/<Item\b/i.test(xml)) {
      const msg = xmlText(xml, 'faultstring') || xml;
      throw new Error(`Aras SOAP fault: ${msg}`);
    }

    return xml;
  }

  async getReleasedParts(): Promise<Part[]> {
    const aml =
      '<Item type="Part" action="get" maxRecords="500" ' +
      'select="id,item_number,name,description,state,major_rev,release_date,modified_on">' +
      '<state>Released</state>' +
      '</Item>';

    const xml = await this.callAml(aml);
    return parseArasPartList(xml);
  }

  async getReleasedPartById(id: string): Promise<Part> {
    const aml =
      `<Item type="Part" action="get" id="${escapeXml(id)}" ` +
      'select="id,item_number,name,description,state,major_rev,release_date,modified_on">' +
      '<state>Released</state>' +
      '</Item>';

    const xml = await this.callAml(aml);
    const parts = parseArasPartList(xml);

    if (parts.length === 0) {
      const err = new Error(`Part "${id}" not found or not in Released state.`);
      (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw err;
    }

    return parts[0]!;
  }

  async getDocumentContent(
    documentId: string,
  ): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    // documentId is the Aras Part GUID (set by parseArasPartList).
    // Step 1 – resolve the Part to its first attached File via AML.
    const fileInfo = await this.findFirstPartFile(documentId);
    if (!fileInfo) {
      const err = new Error(`No specification file is attached to part "${documentId}" in Aras.`);
      (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw err;
    }

    // Step 2 – download the file from the Aras vault using the REST v1 API.
    return this.downloadArasFile(fileInfo.fileId, fileInfo.fileName, fileInfo.mimeType);
  }

  /**
   * Obtain an OAuth2 Bearer token from the Aras REST API v1 token endpoint.
   * The token is cached for its stated lifetime minus a 60-second safety margin.
   *
   * Aras expects the password already hashed to upper-case MD5 in the token
   * request body.
   */
  private async getRestToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type: 'password',
      username: this.authUser,
      password: this.authPassword, // already MD5-hashed upper-case hex
      database: this.database,
    });

    const res = await this.http.post<{ access_token: string; expires_in?: number }>(
      `${this.baseUrl}/api/v1/Token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const token = res.data.access_token;
    const expiresIn = res.data.expires_in ?? 3600;
    this.tokenCache = { token, expiresAt: now + expiresIn * 1000 };
    return token;
  }

  /**
   * Navigate the Aras relationship chain
   *   Part → Part Documents → Document → Document File → File
   * and return the first attached `File` item's metadata.
   *
   * Returns `null` when no file is found (e.g. no documents attached to the
   * Part, or the SOAP request fails).
   */
  private async findFirstPartFile(
    partId: string,
  ): Promise<{ fileId: string; fileName: string; mimeType: string } | null> {
    const aml =
      `<Item type="Part" action="get" id="${escapeXml(partId)}" select="id">` +
      '<Relationships>' +
      '<Item type="Part Documents" action="get" select="id">' +
      '<related_id>' +
      '<Item type="Document" action="get" select="id">' +
      '<Relationships>' +
      '<Item type="Document File" action="get" select="id">' +
      '<related_id>' +
      '<Item type="File" action="get" select="id,filename,mimetype"/>' +
      '</related_id>' +
      '</Item>' +
      '</Relationships>' +
      '</Item>' +
      '</related_id>' +
      '</Item>' +
      '</Relationships>' +
      '</Item>';

    let xml: string;
    try {
      xml = await this.callAml(aml);
    } catch {
      return null;
    }

    const files = findAllFileItems(xml);
    return files[0] ?? null;
  }

  /**
   * Download an Aras File item by its GUID using the REST v1 OData endpoint:
   *   GET {baseUrl}/api/v1/File('{fileId}')/$value
   *
   * Authentication tries OAuth Bearer token first; falls back to Basic auth
   * (username : MD5_password) for older Aras instances that do not support
   * the token endpoint.
   */
  private async downloadArasFile(
    fileId: string,
    knownFileName: string,
    knownMimeType: string,
  ): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    // OData URL format required by Aras REST v1
    const url = `${this.baseUrl}/api/v1/File('${encodeURIComponent(fileId)}')/$value`;

    let res: import('axios').AxiosResponse<ArrayBuffer>;

    // Try OAuth Bearer token first (Aras 12+ / 11 SP10+)
    try {
      const token = await this.getRestToken();
      res = await this.http.get<ArrayBuffer>(url, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
      });
    } catch {
      // Fall back to HTTP Basic auth (username:MD5_password) for older instances
      const basicCred = Buffer.from(`${this.authUser}:${this.authPassword}`).toString('base64');
      res = await this.http.get<ArrayBuffer>(url, {
        headers: { Authorization: `Basic ${basicCred}` },
        responseType: 'arraybuffer',
      });
    }

    const contentType =
      (res.headers['content-type'] as string | undefined) ??
      (knownMimeType || 'application/octet-stream');
    const disposition = (res.headers['content-disposition'] as string | undefined) ?? '';
    const fileNameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const fileName = fileNameMatch
      ? fileNameMatch[1].replace(/['"]/g, '')
      : knownFileName || `file-${fileId}`;

    return { data: Buffer.from(res.data), contentType, fileName };
  }

  async getAssemblies(): Promise<Assembly[]> {
    // TODO: implement Aras AML query for Part BOM structures
    return [];
  }

  async getAssemblyById(_id: string): Promise<Assembly> {
    const error = new Error('Assembly retrieval not yet implemented for Aras.');
    (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw error;
  }

  async addPart(_part: Part): Promise<Part> {
    const error = new Error('addPart is not supported by ArasPlmService.');
    (error as NodeJS.ErrnoException).code = 'NOT_SUPPORTED';
    throw error;
  }
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

  async getAssemblies(): Promise<Assembly[]> {
    // TODO: implement generic REST assembly endpoint
    return [];
  }

  async getAssemblyById(_id: string): Promise<Assembly> {
    const error = new Error('Assembly retrieval not yet implemented for generic REST.');
    (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw error;
  }

  async addPart(_part: Part): Promise<Part> {
    const error = new Error('addPart is not supported by RealPlmService.');
    (error as NodeJS.ErrnoException).code = 'NOT_SUPPORTED';
    throw error;
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

/**
 * Build a minimal but valid PDF buffer for mock document viewing.
 * All content is ASCII, so string length === byte offset — safe to use
 * directly as PDF byte offsets in the cross-reference table.
 */
function buildMockPdf(partNumber: string, docId: string): Buffer {
  const stream = [
    'BT',
    '/F1 14 Tf',
    '50 760 Td',
    `(PLM Specification Document) Tj`,
    '0 -22 Td',
    `/F1 11 Tf`,
    `(Part Number: ${partNumber}) Tj`,
    '0 -18 Td',
    `(Document ID: ${docId}) Tj`,
    '0 -18 Td',
    `(This is a placeholder document.) Tj`,
    '0 -18 Td',
    `(In production the real PDF is streamed from the PLM server.) Tj`,
    'ET',
  ].join('\n');
  const streamLen = stream.length; // ASCII only → length === byte count

  let pdf = '';
  pdf += '%PDF-1.4\n';

  const off1 = pdf.length;
  pdf += '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n';

  const off2 = pdf.length;
  pdf += '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n';

  const off3 = pdf.length;
  pdf +=
    '3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]' +
    ' /Contents 4 0 R /Resources <</Font <</F1 <</Type /Font' +
    ' /Subtype /Type1 /BaseFont /Helvetica>>>>>>>> >>\nendobj\n';

  const off4 = pdf.length;
  pdf += `4 0 obj\n<</Length ${streamLen}>>\nstream\n${stream}\nendstream\nendobj\n`;

  const xrefPos = pdf.length;
  pdf += 'xref\n';
  pdf += '0 5\n';
  pdf += `0000000000 65535 f \n`;
  pdf += `${String(off1).padStart(10, '0')} 00000 n \n`;
  pdf += `${String(off2).padStart(10, '0')} 00000 n \n`;
  pdf += `${String(off3).padStart(10, '0')} 00000 n \n`;
  pdf += `${String(off4).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

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
  {
    id: 'part-006',
    partNumber: 'PN-10006',
    name: 'Healing Abutment – Regular Platform',
    description: 'Titanium healing abutment for guided tissue shaping during osseointegration phase.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'B',
      releaseDate: '2024-05-10',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-006-B',
      specificationFileName: 'PN-10006_RevB_Specification.pdf',
    },
    previousRevision: {
      revision: 'A',
      releaseDate: '2023-03-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-006-A',
      specificationFileName: 'PN-10006_RevA_Specification.pdf',
    },
    updatedAt: '2024-05-10T08:00:00Z',
  },
  {
    id: 'part-007',
    partNumber: 'PN-10007',
    name: 'PEEK Temporary Crown – Universal',
    description: 'PEEK-based temporary crown blank for CAD/CAM milling, mono-colour, A2 shade.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'C',
      releaseDate: '2024-06-15',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-007-C',
      specificationFileName: 'PN-10007_RevC_Specification.pdf',
    },
    previousRevision: {
      revision: 'B',
      releaseDate: '2023-12-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      documentId: 'doc-007-B',
      specificationFileName: 'PN-10007_RevB_Specification.pdf',
    },
    updatedAt: '2024-06-15T14:30:00Z',
  },
];

const MOCK_ASSEMBLIES: Assembly[] = [
  {
    id: 'asm-001',
    assemblyNumber: 'ASM-20001',
    name: 'Standard Implant Kit',
    description:
      'Complete kit for standard implant placement including scanning body, abutment screw and impression coping.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'B',
      releaseDate: '2024-03-20',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[0]! }, quantity: 1, referenceDesignator: 'SB1' },
        { part: { ...MOCK_PARTS[3]! }, quantity: 2, referenceDesignator: 'SC1' },
        { part: { ...MOCK_PARTS[4]! }, quantity: 1, referenceDesignator: 'IC1' },
        { part: { ...MOCK_PARTS[5]! }, quantity: 1, referenceDesignator: 'HA1' },
      ],
    },
    previousRevision: {
      revision: 'A',
      releaseDate: '2023-10-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[0]! }, quantity: 1, referenceDesignator: 'SB1' },
        { part: { ...MOCK_PARTS[3]! }, quantity: 2, referenceDesignator: 'SC1' },
      ],
    },
    updatedAt: '2024-03-20T09:00:00Z',
  },
  {
    id: 'asm-002',
    assemblyNumber: 'ASM-20002',
    name: 'Zirconia Restoration Set',
    description: 'Milling blank and calibration block for zirconia crown workflow.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'B',
      releaseDate: '2024-05-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[1]! }, quantity: 3, referenceDesignator: 'ZB1' },
        { part: { ...MOCK_PARTS[2]! }, quantity: 1, referenceDesignator: 'CB1' },
        { part: { ...MOCK_PARTS[6]! }, quantity: 2, referenceDesignator: 'TC1' },
      ],
    },
    previousRevision: {
      revision: 'A',
      releaseDate: '2024-02-10',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[1]! }, quantity: 3, referenceDesignator: 'ZB1' },
        { part: { ...MOCK_PARTS[2]! }, quantity: 1, referenceDesignator: 'CB1' },
      ],
    },
    updatedAt: '2024-05-01T12:00:00Z',
  },
  {
    id: 'asm-003',
    assemblyNumber: 'ASM-20003',
    name: 'Full Arch Immediate Loading Kit',
    description:
      'Multi-unit assembly for immediate loading full-arch protocols — includes scanning bodies, healing abutments and impression copings.',
    lifecycleState: 'Released',
    latestRevision: {
      revision: 'C',
      releaseDate: '2024-07-01',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[0]! }, quantity: 6, referenceDesignator: 'SB1-SB6' },
        { part: { ...MOCK_PARTS[3]! }, quantity: 12, referenceDesignator: 'SC1' },
        { part: { ...MOCK_PARTS[4]! }, quantity: 6, referenceDesignator: 'IC1-IC6' },
        { part: { ...MOCK_PARTS[5]! }, quantity: 6, referenceDesignator: 'HA1-HA6' },
        { part: { ...MOCK_PARTS[6]! }, quantity: 2, referenceDesignator: 'TC1' },
      ],
    },
    previousRevision: {
      revision: 'B',
      releaseDate: '2024-02-15',
      releasedBy: 'Morten Falk Reventlow',
      lifecycleState: 'Released',
      components: [
        { part: { ...MOCK_PARTS[0]! }, quantity: 4, referenceDesignator: 'SB1-SB4' },
        { part: { ...MOCK_PARTS[3]! }, quantity: 8, referenceDesignator: 'SC1' },
        { part: { ...MOCK_PARTS[4]! }, quantity: 4, referenceDesignator: 'IC1-IC4' },
        { part: { ...MOCK_PARTS[5]! }, quantity: 4, referenceDesignator: 'HA1-HA4' },
      ],
    },
    updatedAt: '2024-07-01T10:00:00Z',
  },
];

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

    // Find the part that owns this document for better PDF metadata
    const owningPart = MOCK_PARTS.find(
      (p) =>
        p.latestRevision.documentId === documentId ||
        p.previousRevision?.documentId === documentId,
    );
    const partNumber = owningPart?.partNumber ?? 'UNKNOWN';

    return {
      data: buildMockPdf(partNumber, documentId),
      contentType: 'application/pdf',
      fileName: `${documentId}-specification.pdf`,
    };
  }

  async getAssemblies(): Promise<Assembly[]> {
    return MOCK_ASSEMBLIES.map((a) => ({ ...a }));
  }

  async getAssemblyById(id: string): Promise<Assembly> {
    const asm = MOCK_ASSEMBLIES.find((a) => a.id === id);
    if (!asm) {
      const error = new Error(`Assembly "${id}" not found or not Released.`);
      (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw error;
    }
    return { ...asm };
  }

  async addPart(part: Part): Promise<Part> {
    const duplicate = MOCK_PARTS.find((p) => p.id === part.id || p.partNumber === part.partNumber);
    if (duplicate) {
      const error = new Error(
        `A part with id "${part.id}" or partNumber "${part.partNumber}" already exists.`,
      );
      (error as NodeJS.ErrnoException).code = 'CONFLICT';
      throw error;
    }
    MOCK_PARTS.push({ ...part });
    return { ...part };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _service: IPlmService | null = null;

/**
 * Return the singleton PLM service instance, creating it on first call.
 *
 * Selection order:
 *   1. PLM_TYPE=aras    → ArasPlmService
 *   2. PLM_TYPE=generic → RealPlmService
 *   3. PLM_TYPE=mock    → MockPlmService
 *   4. (fallback)       → honours the legacy PLM_USE_MOCK flag
 */
export function getPlmService(): IPlmService {
  if (!_service) {
    const type = config.plm.type;
    if (type === 'aras') {
      _service = new ArasPlmService();
    } else if (type === 'generic' || (type === '' && !config.plm.useMock)) {
      _service = new RealPlmService();
    } else {
      _service = new MockPlmService();
    }
  }
  return _service;
}

/** Replace the service singleton (used in tests). */
export function setPlmService(svc: IPlmService): void {
  _service = svc;
}

/** Reset the singleton so the next call to getPlmService() creates a fresh instance (used in tests). */
export function resetPlmService(): void {
  _service = null;
}
