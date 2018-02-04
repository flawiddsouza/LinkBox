require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const db = require('../db')

const fs = require('fs')

var sql = fs.readFileSync('schema.sql').toString()

db.none(sql)
.then(result => db.$pool.end())
.catch(e => console.error(e.stack))