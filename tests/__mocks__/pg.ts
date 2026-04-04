// Manual mock for the `pg` module used in tests.
const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
const mockClient = { query: mockQuery, release: jest.fn() };

export class Pool {
  query = mockQuery;
  connect = jest.fn().mockResolvedValue(mockClient);
  end = jest.fn().mockResolvedValue(undefined);
}

export default { Pool };
