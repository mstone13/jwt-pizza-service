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

test ('get user from database', async () => {
  const userRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(userRes.status).toBe(200);
  expect(userRes.body.email).toBe(testUser.email);
});

test('non-admin user cannot update another user', async () => {
  const registerRes = await request(app).post('/api/auth').send(testUser);
  expect(registerRes.status).toBe(200);

  const updateRes = await request(app)
    .put(`/api/user/${registerRes.body.user.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'hacked name' });

  expect(updateRes.status).toBe(403);
  expect(updateRes.body).toEqual({ message: 'unauthorized' });
});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users', async () => {
  const [, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(200);
});

test('delete user unauthorized', async () => {
  const deleteRes = await request(app)
    .delete('/api/user/USER_ID');

  expect(deleteRes.status).toBe(401);
});

async function registerUser(service) {
  const testUser = {
    name: 'pizza diner',
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}