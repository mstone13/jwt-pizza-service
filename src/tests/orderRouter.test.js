const request = require('supertest');
const app = require('../service');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;

  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
});

test ('get order from database', async () => {
    const orderRes = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body).toEqual(expect.objectContaining({ orders: expect.any(Array) }));
});