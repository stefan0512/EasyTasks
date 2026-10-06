/// <reference path="../pb_data/types.d.ts" />

/**
 * `GET /api/easytasks/users`: id and display name of every verified user, for logged-in
 * users only. The app uses it to pick who a task is assigned to. The `users` collection
 * itself stays private, because its records also hold everybody's Pushover key.
 *
 * Copy this file into the `pb_hooks` folder of the PocketBase server.
 */
routerAdd(
  'GET',
  '/api/easytasks/users',
  (e) => {
    const records = e.app.findRecordsByFilter('users', 'verified = true', '+name', 0, 0);
    return e.json(
      200,
      records.map((record) => ({
        id: record.id,
        name: record.getString('name') || record.getString('email'),
      })),
    );
  },
  $apis.requireAuth(),
);
