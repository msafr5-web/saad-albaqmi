// Creates the project database ("saad_albaqmi" by default) if it does not exist.
//   ADMIN_DATABASE_URL  connection to an existing database with CREATEDB rights (default: DATABASE_URL pointing at "postgres")
//   DB_NAME             database to create (default: saad_albaqmi)
import pg from "pg";

const name = process.env.DB_NAME ?? "saad_albaqmi";
if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
const adminUrl = process.env.ADMIN_DATABASE_URL ?? (() => {
  if (!process.env.DATABASE_URL) throw new Error("Set ADMIN_DATABASE_URL or DATABASE_URL");
  const u = new URL(process.env.DATABASE_URL); u.pathname = "/postgres"; return u.toString();
})();

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
  if (rowCount) console.log(`Database "${name}" already exists.`);
  else {
    await client.query(`create database "${name}" encoding 'UTF8' template template0`);
    console.log(`Database "${name}" created.`);
  }
} finally {
  await client.end();
}
