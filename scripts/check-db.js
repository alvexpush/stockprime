const db = require("../database");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const result = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count]));
console.table(result);
