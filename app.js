const winston = require('winston')
winston.level = 'info'
// { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }
// setting level to error will show only winston.error()
// setting level to info will show winston.info(), winston.warn() and winston. error()
// setting level to debug will show winston.info(), winston.verbose(), winston.info(), winston.warn() and winston.error()
// you get the idea

const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const db = require('./db')

const express = require('express')
const app = express()
var server = app.listen(9886)
const WebSocketServer = require('ws').Server
const wss = new WebSocketServer({ server : server })

app.use(express.static(path.join(__dirname, 'public')))

var bodyParser = require('body-parser')
app.use(bodyParser.json())

var auth = require('./routes/auth')
app.use('/', auth)

const jwt = require('jsonwebtoken')

var authUser = {}
var authenticatedClients = {}

// from: https://stackoverflow.com/a/46878342/4932305
wss.getUniqueID = () => {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
    }
    return s4() + s4() + '-' + s4()
}

wss.on('connection', client => {

    client.id = wss.getUniqueID()

    client.sendJSON = obj => {
        client.send(JSON.stringify(obj))
    }

    client.on('message', message => {
        try {
            var receivedJSON = JSON.parse(message)
            winston.verbose(receivedJSON)
            var authToken = receivedJSON.authToken
            var method = receivedJSON.method
            var payload = receivedJSON.payload
            if(checkAuth(authToken)) {
                // assign the key value to itself if it exists, else assign an empty array
                authenticatedClients[authUser.id] = authenticatedClients[authUser.id] || []
                if(authenticatedClients[authUser.id].length == 0) {
                    authenticatedClients[authUser.id].push(client)
                }
                var clientAlreadyExists = false
                authenticatedClients[authUser.id].forEach(preExistingClient => {
                    if(client.id == preExistingClient.id) {
                        clientAlreadyExists = true
                    }
                })
                if(!clientAlreadyExists) {
                    authenticatedClients[authUser.id].push(client)
                }
                if(method) {
                    switch(method) {
                        case 'get-links':
                            winston.info({ method: 'get-links', client: client.id })
                            getLinks(client)
                            break
                        case 'add-link':
                            winston.info({ method: 'add-link', payload: payload, client: client.id })
                            addLink(payload)
                            break
                        case 'add-links':
                            winston.info({ method: 'add-links', payload: payload, client: client.id })
                            addLinks(payload)
                            break
                        case 'delete-link':
                            winston.info({ method: 'delete-link', payload: payload, client: client.id })
                            deleteLink(payload, client)
                            break
                    }
                }
            } else {
                if(method && payload) {
                    client.sendJSON({ event: 'need-valid-token', payload: { method: method, payload: payload } })
                } else if(method && !payload) {
                    client.sendJSON({ event: 'need-valid-token', payload: { method: method } })
                } else {
                    client.sendJSON({ event: 'need-valid-token' })
                }
            }
        } catch(err) {
            if(err instanceof SyntaxError) {
                winston.warn('Invalid JSON received:', message)
            } else {
                winston.error(err)
            }
        }
    })

    client.on('close', () => {
        if(Object.keys(authUser).length !== 0) {
            authenticatedClients[authUser.id] = authenticatedClients[authUser.id].filter(preExistingClient => preExistingClient.id !== client.id)
        }
    })

    // need this so the server doesn't crash
    // see: https://github.com/websockets/ws/issues/1256#issuecomment-352288884
    // also useful when close isn't sent by the client
    client.on('error', error => {
        if(Object.keys(authUser).length !== 0) {
            authenticatedClients[authUser.id] = authenticatedClients[authUser.id].filter(preExistingClient => preExistingClient.id !== client.id)
        }
    })

})

function checkAuth(authToken) {
    if(authToken) {
        try {
            var decoded = jwt.verify(authToken, process.env.JWT_SECRET)
            authUser = decoded
            return true
        } catch(err) {
            if(err.name == 'JsonWebTokenError') {
                return false
            } else if(err.name == 'TokenExpiredError') {
                winston.info('JWT Token Expired')
            } else {
                winston.error(err)
            }
        }
    }
}

// WebSocket Methods

function getLinks(client) {
    db.query('SELECT * FROM links WHERE user_id = $1 ORDER BY updated_at DESC', [authUser.id])
    .then(rows => {
        var group_to_values = rows.reduce((obj, item) => {
            obj[item.link_group_id] = obj[item.link_group_id] || []
            obj[item.link_group_id].push(item)
            return obj;
        }, {})

        var groups = Object.keys(group_to_values).map(key => {
            return { linkGroup: { id: key }, links: group_to_values[key] }
        })

        db.query('SELECT * FROM link_groups WHERE user_id = $1', [authUser.id])
        .then(rows2 => {
            rows2.forEach(row => {
                groups.forEach(group => {
                    if(group.linkGroup.id == row.id) {
                        group.linkGroup = row
                    }
                })
            })
            // payload == links
            client.sendJSON({ event: 'receive-links', payload: { linkGroups: groups.reverse(), linkCount: rows.length } })
        })
        .catch(error => winston.error(error.stack))
    })
    .catch(error => winston.error(error.stack))
}

// payload == linkObject
async function addLink(payload) {
    try {
        var linkGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [authUser.id])
        await db.none('INSERT INTO links(title, link, link_group_id, user_id) VALUES ($1, $2, $3, $4)', [payload.title, payload.link, linkGroup.id, authUser.id])
        authenticatedClients[authUser.id].forEach(client => {
            client.sendJSON({ event: 'link-added' })
        })
    } catch(error) {
        winston.error(error)
    }
}

// payload == linkArray
async function addLinks(payload) {
    try {
        var linkGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [authUser.id])
        for(let link of payload) {
            await db.none('INSERT INTO links(title, link, link_group_id, user_id) VALUES ($1, $2, $3, $4)', [link.title, link.link, linkGroup.id, authUser.id])
        }
        authenticatedClients[authUser.id].forEach(client => {
            client.sendJSON({ event: 'links-added' })
        })
    } catch(error) {
        winston.error(error)
    }
}

// payload == linkId
async function deleteLink(payload, client) {
    try {
        var result = await db.result('DELETE FROM links WHERE id = $1 AND user_id = $2 RETURNING link_group_id', [payload, authUser.id])
        if(result.rowCount !== 0) {
            authenticatedClients[authUser.id].forEach(client => {
                winston.info({ event: 'link-deleted', payload: payload, client: client.id })
                client.sendJSON({ event: 'link-deleted', payload: payload })
            })
            // housekeeping by deleting linkGroup of the just deleted link if there's no other links associated to it
            var linkGroupId = result.rows[0].link_group_id
            var linkGroupAssociatedLinks = await db.result('SELECT EXISTS (SELECT 1 FROM links WHERE link_group_id = $1)', [linkGroupId])
            if(!linkGroupAssociatedLinks.rows[0].exists) {
                db.none('DELETE from link_groups WHERE id = $1', [linkGroupId])
            }
            // housekeeping by deleting linkGroup of the just deleted link if there's no other links associated to it
        } else {
            winston.info({ event: 'link-already-deleted', payload: payload, client: client.id })
            client.sendJSON({ event: 'link-already-deleted', payload: payload })
        }
    } catch(error) {
        winston.error(error)
    }
}