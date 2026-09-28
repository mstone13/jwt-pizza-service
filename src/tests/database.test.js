const request = require('supertest');
const app = require('../service');
const { DB } = require('../database/database');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  await request(app).post('/api/auth').send(testUser);

  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
});

afterAll(async () => {
  const connection = await DB.getConnection();
  try {
    const users = await DB.query(connection, 'SELECT id FROM user WHERE email=?', [testUser.email]);
    if (users.length > 0) {
      const userId = users[0].id;
      await DB.query(connection, 'DELETE FROM auth WHERE userId=?', [userId]);
      await DB.query(connection, 'DELETE FROM userRole WHERE userId=?', [userId]);
      await DB.query(connection, 'DELETE FROM user WHERE id=?', [userId]);
    }
  } finally {
    connection.end();
  }
});

test('getUserFranchises returns the franchises assigned to a user', async () => {
  const connection = { end: jest.fn() };
  const getConnection = jest.spyOn(DB, 'getConnection').mockResolvedValue(connection);
  const query = jest.spyOn(DB, 'query')
    .mockResolvedValueOnce([{ objectId: 7 }])
    .mockResolvedValueOnce([{ id: 7, name: 'Test Franchise' }]);
  const getFranchise = jest.spyOn(DB, 'getFranchise').mockResolvedValue();

  try {
    const franchises = await DB.getUserFranchises(42);

    expect(query).toHaveBeenNthCalledWith(1, connection, "SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?", [42]);
    expect(query).toHaveBeenNthCalledWith(2, connection, 'SELECT id, name FROM franchise WHERE id in (7)');
    expect(getFranchise).toHaveBeenCalledWith({ id: 7, name: 'Test Franchise' });
    expect(franchises).toEqual([{ id: 7, name: 'Test Franchise' }]);
    expect(connection.end).toHaveBeenCalled();
  } finally {
    getConnection.mockRestore();
    query.mockRestore();
    getFranchise.mockRestore();
  }
});
