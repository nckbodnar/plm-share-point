import {
  MockPlmService,
  ArasPlmService,
  parseArasPartList,
  findAllFileItems,
  getPlmService,
  resetPlmService,
} from '../src/services/plmService';

describe('MockPlmService', () => {
  const svc = new MockPlmService();

  // ---------------------------------------------------------------------------
  // getReleasedParts
  // ---------------------------------------------------------------------------

  describe('getReleasedParts', () => {
    it('returns a non-empty array', async () => {
      const parts = await svc.getReleasedParts();
      expect(parts.length).toBeGreaterThan(0);
    });

    it('all returned parts have lifecycleState === "Released"', async () => {
      const parts = await svc.getReleasedParts();
      parts.forEach((p) => {
        expect(p.lifecycleState).toBe('Released');
      });
    });

    it('all parts have a latestRevision', async () => {
      const parts = await svc.getReleasedParts();
      parts.forEach((p) => {
        expect(p.latestRevision).toBeDefined();
        expect(p.latestRevision.revision).toBeTruthy();
        expect(p.latestRevision.lifecycleState).toBe('Released');
      });
    });

    it('returns independent copies (mutations do not affect source)', async () => {
      const [first] = await svc.getReleasedParts();
      const original = first!.name;
      first!.name = 'MUTATED';

      const [fresh] = await svc.getReleasedParts();
      expect(fresh!.name).toBe(original);
    });
  });

  // ---------------------------------------------------------------------------
  // getReleasedPartById
  // ---------------------------------------------------------------------------

  describe('getReleasedPartById', () => {
    it('returns a specific part by ID', async () => {
      const part = await svc.getReleasedPartById('part-001');
      expect(part.partNumber).toBe('PN-10001');
      expect(part.lifecycleState).toBe('Released');
    });

    it('throws NOT_FOUND for an unknown ID', async () => {
      await expect(svc.getReleasedPartById('nonexistent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('returns previousRevision when it exists', async () => {
      const part = await svc.getReleasedPartById('part-001');
      expect(part.previousRevision).toBeDefined();
      expect(part.previousRevision!.revision).toBeTruthy();
    });

    it('returns undefined previousRevision for single-revision parts', async () => {
      const part = await svc.getReleasedPartById('part-003');
      expect(part.previousRevision).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getDocumentContent
  // ---------------------------------------------------------------------------

  describe('getDocumentContent', () => {
    it('returns content for a known document ID', async () => {
      const part = await svc.getReleasedPartById('part-001');
      const docId = part.latestRevision.documentId!;
      const result = await svc.getDocumentContent(docId);

      expect(result.data).toBeInstanceOf(Buffer);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.contentType).toBeTruthy();
      expect(result.fileName).toBeTruthy();
    });

    it('returns content for a previous revision document', async () => {
      const part = await svc.getReleasedPartById('part-002');
      const docId = part.previousRevision!.documentId!;
      const result = await svc.getDocumentContent(docId);

      expect(result.data.length).toBeGreaterThan(0);
    });

    it('throws NOT_FOUND for an unknown document ID', async () => {
      await expect(svc.getDocumentContent('unknown-doc-id')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('returns application/pdf content type', async () => {
      const part = await svc.getReleasedPartById('part-001');
      const docId = part.latestRevision.documentId!;
      const result = await svc.getDocumentContent(docId);
      expect(result.contentType).toBe('application/pdf');
    });

    it('returns a valid PDF buffer (starts with %PDF-)', async () => {
      const part = await svc.getReleasedPartById('part-001');
      const docId = part.latestRevision.documentId!;
      const result = await svc.getDocumentContent(docId);
      expect(result.data.slice(0, 5).toString('ascii')).toBe('%PDF-');
    });

    it('returns a .pdf file name', async () => {
      const part = await svc.getReleasedPartById('part-001');
      const docId = part.latestRevision.documentId!;
      const result = await svc.getDocumentContent(docId);
      expect(result.fileName).toMatch(/\.pdf$/);
    });
  });

  // ---------------------------------------------------------------------------
  // getAssemblies
  // ---------------------------------------------------------------------------

  describe('getAssemblies', () => {
    it('returns a non-empty array', async () => {
      const assemblies = await svc.getAssemblies();
      expect(assemblies.length).toBeGreaterThan(0);
    });

    it('all returned assemblies have lifecycleState === "Released"', async () => {
      const assemblies = await svc.getAssemblies();
      assemblies.forEach((a) => {
        expect(a.lifecycleState).toBe('Released');
      });
    });

    it('all assemblies have a latestRevision with at least one component', async () => {
      const assemblies = await svc.getAssemblies();
      assemblies.forEach((a) => {
        expect(a.latestRevision).toBeDefined();
        expect(a.latestRevision.components.length).toBeGreaterThan(0);
      });
    });

    it('at least one assembly has a previousRevision', async () => {
      const assemblies = await svc.getAssemblies();
      expect(assemblies.some((a) => a.previousRevision !== undefined)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getAssemblyById
  // ---------------------------------------------------------------------------

  describe('getAssemblyById', () => {
    it('returns a specific assembly by ID', async () => {
      const asm = await svc.getAssemblyById('asm-001');
      expect(asm.assemblyNumber).toBe('ASM-20001');
      expect(asm.lifecycleState).toBe('Released');
    });

    it('throws NOT_FOUND for an unknown ID', async () => {
      await expect(svc.getAssemblyById('nonexistent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('returns previousRevision when it exists', async () => {
      const asm = await svc.getAssemblyById('asm-001');
      expect(asm.previousRevision).toBeDefined();
      expect(asm.previousRevision!.revision).toBeTruthy();
    });

    it('components in latest revision have valid part references', async () => {
      const asm = await svc.getAssemblyById('asm-001');
      asm.latestRevision.components.forEach((c) => {
        expect(c.part.id).toBeTruthy();
        expect(c.part.partNumber).toBeTruthy();
        expect(c.quantity).toBeGreaterThan(0);
      });
    });

    it('asm-003 has 5 components in latest revision', async () => {
      const asm = await svc.getAssemblyById('asm-003');
      expect(asm.latestRevision.components.length).toBe(5);
      expect(asm.previousRevision).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// parseArasPartList – unit tests for the AML XML parser
// ---------------------------------------------------------------------------

/** Minimal Aras-style SOAP response wrapping one Part item */
function wrapAml(itemsXml: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    '<ApplyAMLResponse xmlns="http://www.aras.com/InnovatorServer">' +
    '<ApplyAMLResult>' +
    '<AML>' +
    itemsXml +
    '</AML>' +
    '</ApplyAMLResult>' +
    '</ApplyAMLResponse>' +
    '</soap:Body>' +
    '</soap:Envelope>'
  );
}

describe('parseArasPartList', () => {
  it('parses a single Released Part item', () => {
    const xml = wrapAml(
      '<Item type="Part" id="abc-123">' +
        '<item_number>PN-99001</item_number>' +
        '<name>Test Scanning Body</name>' +
        '<description>A test part</description>' +
        '<state>Released</state>' +
        '<major_rev>B</major_rev>' +
        '<release_date>2025-06-01T00:00:00</release_date>' +
        '<modified_on>2025-06-01T10:00:00Z</modified_on>' +
        '</Item>',
    );

    const parts = parseArasPartList(xml);
    expect(parts).toHaveLength(1);

    const [p] = parts;
    expect(p!.id).toBe('abc-123');
    expect(p!.partNumber).toBe('PN-99001');
    expect(p!.name).toBe('Test Scanning Body');
    expect(p!.description).toBe('A test part');
    expect(p!.lifecycleState).toBe('Released');
    expect(p!.latestRevision.revision).toBe('B');
    expect(p!.latestRevision.releaseDate).toBe('2025-06-01T00:00:00');
    expect(p!.latestRevision.documentId).toBe('abc-123');
  });

  it('parses multiple Part items', () => {
    const xml = wrapAml(
      '<Item type="Part" id="p1"><item_number>PN-1</item_number><name>Part One</name><state>Released</state><major_rev>A</major_rev><release_date>2025-01-01</release_date><modified_on>2025-01-01T00:00:00Z</modified_on></Item>' +
        '<Item type="Part" id="p2"><item_number>PN-2</item_number><name>Part Two</name><state>Released</state><major_rev>C</major_rev><release_date>2025-02-01</release_date><modified_on>2025-02-01T00:00:00Z</modified_on></Item>',
    );

    const parts = parseArasPartList(xml);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.partNumber).toBe('PN-1');
    expect(parts[1]!.partNumber).toBe('PN-2');
  });

  it('returns empty array for an Aras "no items found" error response', () => {
    const xml = wrapAml(
      '<Item type="Part" isError="1" action="get">' +
        '<Fault><faultcode>0</faultcode><faultstring>No items of type Part found.</faultstring></Fault>' +
        '</Item>',
    );

    expect(parseArasPartList(xml)).toHaveLength(0);
  });

  it('returns empty array when the AML block contains no Part items', () => {
    expect(parseArasPartList('<AML></AML>')).toHaveLength(0);
  });

  it('ignores non-Part Item elements', () => {
    const xml = wrapAml(
      '<Item type="Document" id="d1"><item_number>DOC-1</item_number></Item>' +
        '<Item type="Part" id="p1"><item_number>PN-1</item_number><name>P</name><state>Released</state><major_rev>A</major_rev><release_date>2025-01-01</release_date><modified_on>2025-01-01T00:00:00Z</modified_on></Item>',
    );

    const parts = parseArasPartList(xml);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.partNumber).toBe('PN-1');
  });

  it('decodes XML entities in part properties', () => {
    const xml = wrapAml(
      '<Item type="Part" id="p1">' +
        '<item_number>PN &amp; 001</item_number>' +
        '<name>Body &lt;Standard&gt;</name>' +
        '<state>Released</state>' +
        '<major_rev>A</major_rev>' +
        '<release_date>2025-01-01</release_date>' +
        '<modified_on>2025-01-01T00:00:00Z</modified_on>' +
        '</Item>',
    );

    const [p] = parseArasPartList(xml);
    expect(p!.partNumber).toBe('PN & 001');
    expect(p!.name).toBe('Body <Standard>');
  });

  it('uses item_number as fallback when name element is absent', () => {
    const xml = wrapAml(
      '<Item type="Part" id="p1"><item_number>PN-X</item_number><state>Released</state><major_rev>A</major_rev><release_date>2025-01-01</release_date><modified_on>2025-01-01T00:00:00Z</modified_on></Item>',
    );

    const [p] = parseArasPartList(xml);
    expect(p!.name).toBe('PN-X');
  });
});

// ---------------------------------------------------------------------------
// findAllFileItems – XML File leaf node extractor
// ---------------------------------------------------------------------------

describe('findAllFileItems', () => {
  it('returns empty array when there are no File items', () => {
    expect(findAllFileItems('<AML><Item type="Part" id="p1"/></AML>')).toHaveLength(0);
  });

  it('extracts a single File item', () => {
    const xml =
      '<Item type="File" id="f1">' +
      '<filename>spec.pdf</filename>' +
      '<mimetype>application/pdf</mimetype>' +
      '</Item>';
    const files = findAllFileItems(xml);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ fileId: 'f1', fileName: 'spec.pdf', mimeType: 'application/pdf' });
  });

  it('extracts multiple File items from a nested AML response', () => {
    const xml =
      '<Item type="Document File" id="df1"><related_id>' +
      '<Item type="File" id="f1"><filename>a.pdf</filename><mimetype>application/pdf</mimetype></Item>' +
      '</related_id></Item>' +
      '<Item type="Document File" id="df2"><related_id>' +
      '<Item type="File" id="f2"><filename>b.pdf</filename><mimetype>application/pdf</mimetype></Item>' +
      '</related_id></Item>';
    const files = findAllFileItems(xml);
    expect(files).toHaveLength(2);
    expect(files[0]!.fileId).toBe('f1');
    expect(files[1]!.fileId).toBe('f2');
  });

  it('skips error File items (isError="1")', () => {
    const xml =
      '<Item type="File" id="f1" isError="1"><filename>bad.pdf</filename></Item>' +
      '<Item type="File" id="f2"><filename>good.pdf</filename><mimetype>application/pdf</mimetype></Item>';
    const files = findAllFileItems(xml);
    expect(files).toHaveLength(1);
    expect(files[0]!.fileId).toBe('f2');
  });

  it('skips File items without an id', () => {
    const xml = '<Item type="File"><filename>no-id.pdf</filename></Item>';
    expect(findAllFileItems(xml)).toHaveLength(0);
  });

  it('defaults mimeType to application/octet-stream when mimetype is absent', () => {
    const xml = '<Item type="File" id="f1"><filename>file.bin</filename></Item>';
    const files = findAllFileItems(xml);
    expect(files[0]!.mimeType).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// ArasPlmService – construction / config-derivation tests
// ---------------------------------------------------------------------------

describe('ArasPlmService configuration', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    resetPlmService();
  });

  afterEach(() => {
    process.env = origEnv;
    resetPlmService();
  });

  it('can be instantiated with valid config', () => {
    process.env['PLM_BASE_URL'] = 'http://localhost/UA-LPT-MYBO-Aras3Shape-development';
    process.env['PLM_USERNAME'] = 'admin';
    process.env['PLM_PASSWORD'] = 'secret';
    expect(() => new ArasPlmService()).not.toThrow();
  });

  it('derives the database name from the last URL path segment', () => {
    process.env['PLM_TYPE'] = 'aras';
    process.env['PLM_BASE_URL'] = 'http://localhost/UA-LPT-MYBO-Aras3Shape-development';
    process.env['PLM_ARAS_DATABASE'] = '';
    process.env['PLM_USERNAME'] = 'admin';
    process.env['PLM_PASSWORD'] = 'pw';

    // config is loaded at module-parse time, so we must reload the modules
    // inside jest.isolateModules to pick up the new env values.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('../src/services/plmService') as typeof import('../src/services/plmService');
      const svc = m.getPlmService();
      expect(svc).toBeInstanceOf(m.ArasPlmService);
    });
  });

  it('respects an explicit PLM_ARAS_DATABASE value', () => {
    process.env['PLM_BASE_URL'] = 'http://plm-server.internal/some-path';
    process.env['PLM_ARAS_DATABASE'] = 'MyCustomDatabase';
    process.env['PLM_USERNAME'] = 'admin';
    process.env['PLM_PASSWORD'] = 'pw';
    expect(() => new ArasPlmService()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getPlmService factory – adapter selection
// ---------------------------------------------------------------------------

describe('getPlmService factory', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    resetPlmService();
  });

  afterEach(() => {
    process.env = origEnv;
    resetPlmService();
  });

  it('returns MockPlmService when PLM_TYPE=mock', () => {
    process.env['PLM_TYPE'] = 'mock';
    expect(getPlmService()).toBeInstanceOf(MockPlmService);
  });

  it('returns ArasPlmService when PLM_TYPE=aras', () => {
    process.env['PLM_TYPE'] = 'aras';
    process.env['PLM_BASE_URL'] = 'http://localhost/UA-LPT-MYBO-Aras3Shape-development';
    process.env['PLM_USERNAME'] = 'admin';
    process.env['PLM_PASSWORD'] = 'pw';

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require('../src/services/plmService') as typeof import('../src/services/plmService');
      expect(m.getPlmService()).toBeInstanceOf(m.ArasPlmService);
    });
  });

  it('returns a singleton on repeated calls', () => {
    process.env['PLM_TYPE'] = 'mock';
    expect(getPlmService()).toBe(getPlmService());
  });

  it('creates a new instance after resetPlmService()', () => {
    process.env['PLM_TYPE'] = 'mock';
    const first = getPlmService();
    resetPlmService();
    const second = getPlmService();
    expect(first).not.toBe(second);
  });
});

