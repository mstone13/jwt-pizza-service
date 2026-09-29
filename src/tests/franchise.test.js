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

afterAll(async () => {
  if (!adminUser) {
    return;
  }

  const connection = await DB.getConnection();
  try {
    const users = await DB.query(connection, 'SELECT id FROM user WHERE email=?', [adminUser.email]);
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

test('admin can get a user franchises through the franchise router', async () => {
  const franchises = [{ id: 12, name: 'Test Franchise' }];
  const getUserFranchises = jest.spyOn(DB, 'getUserFranchises').mockResolvedValue(franchises);

  try {
    const response = await request(app)
      .get('/api/franchise/42')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(franchises);
    expect(getUserFranchises).toHaveBeenCalledWith(42);
  } finally {
    getUserFranchises.mockRestore();
  }
});

test("admin can create and delete a store named World's Greatest Pizza", async () => {
  const franchiseName = `Pizza ${randomName()}`;
  const storeName = "World's Greatest Pizza";
  const createStore = jest.spyOn(DB, 'createStore');
  const deleteStore = jest.spyOn(DB, 'deleteStore');
  let franchiseId;

  try {
    const franchiseRes = await request(app)
      .post('/api/franchise')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: franchiseName, admins: [{ email: adminUser.email }] });

    expect(franchiseRes.status).toBe(200);
    franchiseId = franchiseRes.body.id;

    const storeRes = await request(app)
      .post(`/api/franchise/${franchiseId}/store`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: storeName });

    expect(storeRes.status).toBe(200);
    expect(storeRes.body.name).toBe(storeName);
    expect(createStore).toHaveBeenCalledWith(franchiseId, { name: storeName });

    const deleteRes = await request(app)
      .delete(`/api/franchise/${franchiseId}/store/${storeRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteStore).toHaveBeenCalledWith(franchiseId, storeRes.body.id);
  } finally {
    createStore.mockRestore();
    deleteStore.mockRestore();
    if (franchiseId) {
      await DB.deleteFranchise(franchiseId);
    }
  }
});

