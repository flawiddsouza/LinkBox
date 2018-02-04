const pgp = require('pg-promise')()

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
}

const db = pgp(dbConfig)

module.exports = db