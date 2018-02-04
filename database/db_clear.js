require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const db = require('../db')

db.none(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO postgres;
    GRANT ALL ON SCHEMA public TO public;
`)
.then(result => db.$pool.end())
.catch(e => console.error(e.stack))