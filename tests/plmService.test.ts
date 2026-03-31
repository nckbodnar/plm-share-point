import { MockPlmService } from '../src/services/plmService';

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
  });
});
