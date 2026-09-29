const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;

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

test ('get order from database', async () => {
    const orderRes = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body).toEqual(expect.objectContaining({ orders: expect.any(Array) }));
});


test('user can order an existing menu pizza', async () => {
  let orderId;
  let menuId;

  const connection = await DB.getConnection();

  const factoryFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      reportUrl: 'https://example.test/report',
      jwt: 'test-jwt',
    }),
  });

  try {
    const menuResult = await DB.query(
      connection,
      'INSERT INTO menu (title, image, price, description) VALUES (?, ?, ?, ?)',
      [
        'Test Pizza',
        'https://example.com/test-pizza.jpg',
        10.99,
        'A test pizza for the order test',
      ]
    );

    menuId = menuResult.insertId;

    const menuResponse = await request(app).get('/api/order/menu');

    expect(menuResponse.status).toBe(200);
    expect(menuResponse.body.length).toBeGreaterThan(0);

    const menuItem = menuResponse.body.find(
      item => item.id === menuId
    );

    expect(menuItem).toBeDefined();

    const response = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${testUserAuthToken}`)
      .send({
        franchiseId: 1,
        storeId: 1,
        items: [
        {
            menuId: menuItem.id,
            description: menuItem.title,
            price: menuItem.price,
          },
        ],
      });

    expect(response.status).toBe(200);

    expect(response.body.order).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            menuId: menuItem.id,
            description: menuItem.title,
          }),
        ],
      })
    );

    orderId = response.body.order.id;
  } finally {
    factoryFetch.mockRestore();

    if (orderId) {
      await DB.query(
        connection,
        'DELETE FROM orderItem WHERE orderId=?',
        [orderId]
      );

      await DB.query(
        connection,
        'DELETE FROM dinerOrder WHERE id=?',
        [orderId]
      );
    }

    if (menuId) {
      await DB.query(
        connection,
        'DELETE FROM menu WHERE id=?',
        [menuId]
      );
    }

    connection.end();
  }
});



test("admin can add 'Spiciest pizza' to the menu", async () => {
  const menuTitle = 'Spiciest pizza';
  const adminEmail = `${Math.random().toString(36).substring(2, 12)}@admin.com`;
  const admin = {
    name: 'menu test admin',
    email: adminEmail,
    password: 'test-password',
    roles: [{ role: Role.Admin }],
  };
  let existingMenuIds;
  let adminId;

  try {
    const createdAdmin = await DB.addUser(admin);
    adminId = createdAdmin.id;

    const loginRes = await request(app).put('/api/auth').send(admin);
    expect(loginRes.status).toBe(200);

    existingMenuIds = (await DB.getMenu())
      .filter((item) => item.title === menuTitle)
      .map((item) => item.id);

    const response = await request(app)
      .put('/api/order/menu')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({ title: menuTitle, description: 'Extra spicy pizza', image: 'spicy.png', price: 0.01 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([expect.objectContaining({ title: menuTitle })]));
  } finally {
    const connection = await DB.getConnection();
    try {
      if (existingMenuIds) {
        const menuItems = await DB.query(connection, 'SELECT id FROM menu WHERE title=?', [menuTitle]);
        for (const item of menuItems) {
          if (!existingMenuIds.includes(item.id)) {
            await DB.query(connection, 'DELETE FROM menu WHERE id=?', [item.id]);
          }
        }
      }

      if (adminId) {
        await DB.query(connection, 'DELETE FROM auth WHERE userId=?', [adminId]);
        await DB.query(connection, 'DELETE FROM userRole WHERE userId=?', [adminId]);
        await DB.query(connection, 'DELETE FROM user WHERE id=?', [adminId]);
      }
    } finally {
      connection.end();
    }
  }
});