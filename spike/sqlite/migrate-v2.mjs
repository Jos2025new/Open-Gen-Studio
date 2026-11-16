// The migration lives in server/sqlite so production does not import this spike folder.
import { canonicalStateText, migrateFromV2, migrateToSqlite, stateSha } from '../../server/sqlite/migrate.js';
export { canonicalStateText, migrateFromV2, migrateToSqlite, stateSha };

if (process.argv[2] === '--child') {
  const dir = process.argv[3];
  const killPoint = process.argv[4] || 'globals';
  await migrateFromV2(dir, {
    fault: (point) => {
      if (point === killPoint) {
        process.stdout.write(`fault ${point}\n`);
        process.kill(process.pid, 'SIGKILL');
      }
    },
  });
}
