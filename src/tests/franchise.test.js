const request = require('supertest');
const app = require('../service');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

const { Role, DB } = require('../database/database.js');

let adminToken;
let adminUser;

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  await DB.addUser(user);
  user.password = 'toomanysecrets';

  return user;
}

beforeAll(async () => {
  adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  adminToken = loginRes.body.token;
});

test('admin can create, list, and delete franchises', async () => {
  const franchiseName = `Pizza ${randomName()}`;

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: franchiseName,
      admins: [{ email: adminUser.email }],
    });

  expect(createRes.status).toBe(200);
  expect(createRes.body.name).toBe(franchiseName);

  const listRes = await request(app)
    .get('/api/franchise')
    .query({ page: 0, limit: 10, name: '*' })
    .set('Authorization', `Bearer ${adminToken}`);

  expect(listRes.status).toBe(200);
  expect(listRes.body.more).toBeDefined();
  expect(listRes.body.franchises).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: franchiseName,
        admins: expect.arrayContaining([
          expect.objectContaining({ email: adminUser.email }),
        ]),
      }),
    ])
  );

  const deleteRes = await request(app)
    .delete(`/api/franchise/${createRes.body.id}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'franchise deleted' });
});

