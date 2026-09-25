/**
 * Deletes the `task_lists` and `tasks` collections created by setup-collections.mjs.
 * This drops the collections and every record in them — there is no undo.
 *
 * Usage (needs `npm install pocketbase`):
 *   PB_URL=https://your-server.com:xxxx node delete-collections.mjs <superuser-email> <superuser-password> --yes
 *
 * Re-running is safe: collections that are already gone are reported and skipped.
 */
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL;
const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const [email, password] = args.filter((arg) => arg !== '--yes');

if (!PB_URL || !email || !password || !confirmed) {
  console.error(
    'Usage: PB_URL=https://your-server.com:xxxx node delete-collections.mjs <superuser-email> <superuser-password> --yes\n' +
      'The --yes flag is required: this deletes both collections and all their records.'
  );
  process.exit(1);
}

// `tasks` first: its `taskListId` relation points at `task_lists`, which cannot
// be deleted while that relation still exists.
const names = ['tasks', 'task_lists'];

const pb = new PocketBase(PB_URL);

try {
  await pb.collection('_superusers').authWithPassword(email, password);
} catch (err) {
  console.error(`Superuser login at ${PB_URL} failed: ${err.message}`);
  process.exit(1);
}

for (const name of names) {
  try {
    await pb.collections.delete(name);
    console.log(`deleted  ${name}`);
  } catch (err) {
    if (err.status === 404) {
      console.log(`skipped  ${name} (does not exist)`);
    } else {
      console.error(`failed   ${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
