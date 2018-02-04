const router = require('express').Router()

const db = require('../db')

const bcrypt = require('bcrypt')
const saltRounds = 10

const jwt = require('jsonwebtoken')

router.post('/authenticate', validateUsernameAndPassword, (req, res) => {
    db.one('SELECT * FROM users WHERE username = $1', [req.body.username])
    .then(user => {
        bcrypt.compare(req.body.password, user.password).then(passed => {
            if(!passed) {
                return res.json({
                    success: false,
                    message: 'Authentication failed. Invalid password.'
                }) 
            }
            const payload = {
                id: user.id,
                username: user.username
            }

            var token = jwt.sign(payload, process.env.JWT_SECRET, {
                expiresIn: '1 day'
            })

            return res.json({
                success: true,
                token: token
            })
        })
    })
    .catch(error => {
        if(error instanceof db.$config.pgp.errors.QueryResultError) {
            return res.json({
                success: false,
                message: 'Authentication failed. No such user found.'
            })
        } else {
            console.error(error)
        }
    })
})

router.post('/register', validateUsernameAndPassword, (req, res) => {
    db.one('SELECT * FROM users WHERE username = $1', [req.body.username])
    .then(user => {
        return res.json({
            success: false,
            message: 'Registration failed. User already exists.'
        }) 
    })
    .catch(error => {
        if(error instanceof db.$config.pgp.errors.QueryResultError) {
            bcrypt.hash(req.body.password, saltRounds).then(passwordHash => {
                db.none('INSERT INTO users(username, password) VALUES($1, $2)', [req.body.username, passwordHash])
                .then(result => {
                    return res.json({
                        success: true,
                        message: "Registration complete."
                    })
                })  
            })
        } else {
            console.error(error)
        }
    })
})

function validateUsernameAndPassword(req, res, next) {
    if(!req.body.username && !req.body.password) {
        return res.json({
            success: false,
            message: 'Authentication failed. No username & password provided.'
        })
    }
    if(!req.body.username) {
        return res.json({
            success: false,
            message: 'Authentication failed. No username provided.'
        })
    }
    if(!req.body.password) {
        return res.json({
            success: false,
            message: 'Authentication failed. No password provided.'
        })
    }
    next()
}

module.exports = router