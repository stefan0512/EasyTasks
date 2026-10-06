/// <reference path="../pb_data/types.d.ts" />

/**
 * Sends push notifications about tasks. Every user picks the events in the app's
 * Settings; the choices are stored on their `users` record:
 *
 * - `PushTaskNew`: a task was created
 * - `PushTaskDone`: a task was completed, or deleted while still open
 * - `PushTaskChanged`: a task was edited
 * - `PushOnlyAssigned`: only for tasks assigned to the user (otherwise for every task)
 *
 * Nobody is notified about their own actions, and tasks on a private list only reach
 * the list's owner. See `push_notify.js` for who exactly receives a message.
 *
 * Copy this file and `push_notify.js` into the `pb_hooks` folder of the PocketBase
 * server.
 */

onRecordAfterCreateSuccess((e) => {
  e.next(); // must be called, otherwise the hook chain stops

  try {
    require(`${__hooks}/push_notify.js`).notifyAboutTask(e.app, $http, e.record, {
      optIn: 'PushTaskNew',
      headline: 'New task in',
      actorId: e.record.getString('user'),
      actorEmail: e.record.getString('createdBy'),
    });
  } catch (err) {
    // A failed notification must never break task creation.
    e.app.logger().error('push notify error', 'error', String(err));
  }
}, 'tasks');

// Updates and deletes use the request hooks, because only these know who made the
// change (`e.auth`); the model hooks above and below would not.
onRecordUpdateRequest((e) => {
  // The stored version, to tell a completion from an edit.
  const before = e.record.original();
  e.next(); // saves the task; if that fails, it throws and nothing is sent

  try {
    const after = e.record;
    const completed =
      before.getString('status') !== 'complete' && after.getString('status') === 'complete';
    // Only what the user sees counts, not the edit date and editor alone.
    const changed = ['title', 'summary', 'status', 'dueDate', 'imagePath', 'taskListId', 'assignee'].some(
      (field) => before.getString(field) !== after.getString(field),
    );
    if (!completed && !changed) {
      return;
    }
    require(`${__hooks}/push_notify.js`).notifyAboutTask(e.app, $http, after, {
      optIn: completed ? 'PushTaskDone' : 'PushTaskChanged',
      headline: completed ? 'Task completed in' : 'Task changed in',
      actorId: e.auth ? e.auth.id : '',
      actorEmail: e.auth ? e.auth.getString('email') : '',
    });
  } catch (err) {
    e.app.logger().error('push notify error', 'error', String(err));
  }
}, 'tasks');

onRecordDeleteRequest((e) => {
  e.next(); // deletes the task; e.record still holds its data afterwards

  try {
    // A completed task was announced when it was completed. This also keeps deleting
    // a finished task list quiet: the app removes its completed tasks first.
    if (e.record.getString('status') === 'complete') {
      return;
    }
    require(`${__hooks}/push_notify.js`).notifyAboutTask(e.app, $http, e.record, {
      optIn: 'PushTaskDone',
      headline: 'Task deleted in',
      actorId: e.auth ? e.auth.id : '',
      actorEmail: e.auth ? e.auth.getString('email') : '',
    });
  } catch (err) {
    e.app.logger().error('push notify error', 'error', String(err));
  }
}, 'tasks');
