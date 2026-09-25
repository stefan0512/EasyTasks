/// <reference path="../pb_data/types.d.ts" />

/**
 * Sends a push notification when a task is created, to every user who has
 * `PushNotifications` enabled and a `PushOverUser` key set — except the user
 * who created the task. Tasks on a private list only reach the list's owner.
 *
 * Copy this file into the `pb_hooks` folder of the PocketBase server.
 */
onRecordAfterCreateSuccess((e) => {
  e.next(); // must be called, otherwise the hook chain stops

  try {
    const list = e.app.findRecordById('task_lists', e.record.getString('taskListId'));

    // Opted-in users with a key, never the creator of the task.
    let filter = "PushNotifications = true && PushOverUser != '' && id != {:creator}";
    const params = { creator: e.record.getString('user') };
    if (list.getString('visibility') !== 'public') {
      filter += ' && id = {:owner}';
      params.owner = list.getString('user');
    }
    const users = e.app.findRecordsByFilter('users', filter, '', 0, 0, params);

    const createdBy = e.record.getString('createdBy');
    const message =
      `New task in "${list.getString('title')}": ${e.record.getString('title')}` +
      (createdBy ? ` (by ${createdBy})` : '');

    // One notification per key, even if several users share one.
    const keys = [...new Set(users.map((u) => u.getString('PushOverUser').trim()))];

    for (const key of keys) {
      try {
        const res = $http.send({
          url: 'https://<your-server>/notify',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: key, message }),
          timeout: 10, // seconds
        });
        if (res.statusCode >= 400) {
          e.app.logger().warn('push notify failed', 'status', res.statusCode, 'body', res.raw);
        }
      } catch (err) {
        // One failed recipient must not stop the others.
        e.app.logger().error('push notify error', 'error', String(err));
      }
    }
  } catch (err) {
    // A failed notification must never break task creation.
    e.app.logger().error('push notify error', 'error', String(err));
  }
}, 'tasks');
