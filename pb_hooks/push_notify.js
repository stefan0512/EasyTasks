/// <reference path="../pb_data/types.d.ts" />

/**
 * Shared by the hooks in `notify_tasks.pb.js`. PocketBase runs every hook handler in
 * its own isolated context, so common code has to live in a module loaded with
 * `require()`. The app and `$http` are passed in rather than taken from globals.
 *
 * Not a `*.pb.js` file, so PocketBase does not load it as a hook by itself.
 */

/**
 * Sends a push notification about `task` to every user who ticked `optIn` and has a
 * `PushOverUser` key set — except `actorId`, the user who caused it. Tasks on a
 * private list only reach the list's owner. Users sharing a key get one message.
 *
 * Throws if the task list cannot be read; a failed recipient is only logged.
 */
function notifyAboutTask(app, http, task, { optIn, headline, actorId, actorEmail }) {
  const list = app.findRecordById('task_lists', task.getString('taskListId'));

  // Users who only want their own tasks are skipped unless the task is assigned to them.
  let filter = `${optIn} = true && PushOverUser != '' && id != {:actor} &&
    (PushOnlyAssigned != true || id = {:assignee})`;
  const params = { actor: actorId, assignee: task.getString('assignee') };
  if (list.getString('visibility') !== 'public') {
    filter += ' && id = {:owner}';
    params.owner = list.getString('user');
  }
  const users = app.findRecordsByFilter('users', filter, '', 0, 0, params);

  const message =
    `${headline} "${list.getString('title')}": ${task.getString('title')}` +
    (actorEmail ? ` (by ${actorEmail})` : '');

  const keys = [...new Set(users.map((u) => u.getString('PushOverUser').trim()))];

  for (const key of keys) {
    try {
      const res = http.send({
        url: 'https://push.cachat.ch/notify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: key, message }),
        timeout: 10, // seconds
      });
      if (res.statusCode >= 400) {
        app.logger().warn('push notify failed', 'status', res.statusCode, 'body', res.raw);
      }
    } catch (err) {
      // One failed recipient must not stop the others.
      app.logger().error('push notify error', 'error', String(err));
    }
  }
}

module.exports = { notifyAboutTask };
