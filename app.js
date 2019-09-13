const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '.env') })

const winston = require('winston')
winston.level = process.env.LOG_LEVEL
// { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }
// setting level to error will show only winston.error()
// setting level to info will show winston.info(), winston.warn() and winston. error()
// setting level to debug will show winston.info(), winston.verbose(), winston.info(), winston.warn() and winston.error()
// you get the idea

const db = require('./db')

const express = require('express')
const app = express()
var server = app.listen(9886)
const WebSocketServer = require('ws').Server
const wss = new WebSocketServer({ server : server })

app.use(express.static(path.join(__dirname, 'public')))

var bodyParser = require('body-parser')
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

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
                        case 'change-link-group':
                            winston.info({ method: 'change-link-group', payload: payload, client: client.id })
                            changeLinkGroup(payload, client)
                            break
                        case 'rename-link-group':
                            winston.info({ method: 'rename-link-group', payload: payload, client: client.id })
                            renameLinkGroup(payload, client)
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

function checkAuth(authToken, middlewareRequestBody=null) {
    if(authToken) {
        try {
            var decoded = jwt.verify(authToken, process.env.JWT_SECRET)
            authUser = decoded
            if(middlewareRequestBody) {
                middlewareRequestBody.authUser = decoded
            }
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

// payload == linkObject { title: title, link: link }
async function addLink(payload) {
    try {
        var linkGroupId = null
        try {
            var lastAddedLink = await db.one('SELECT link_group_id FROM links WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [authUser.id])
            linkGroupId = lastAddedLink.link_group_id
        } catch(error) {
            if(error.name === 'QueryResultError') {
                var newLinkGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [authUser.id])
                linkGroupId = newLinkGroup.id
            } else {
                winston.error(error)
            }
        }
        await db.none('INSERT INTO links(title, link, link_group_id, user_id) VALUES ($1, $2, $3, $4)', [payload.title, payload.link, linkGroupId, authUser.id])
        authenticatedClients[authUser.id].forEach(client => {
            client.sendJSON({ event: 'link-added' })
        })
    } catch(error) {
        winston.error(error)
    }
}

// payload == linkObject Array
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

// payload == { linkId: linkId, oldLinkGroupId: oldLinkGroupId, newLinkGroupId: newLinkGroupId }
async function changeLinkGroup(payload, client) {
    try {
        await db.none('UPDATE links SET link_group_id = $1 WHERE id = $2 AND user_id = $3', [payload.newLinkGroupId, payload.linkId, authUser.id])
        authenticatedClients[authUser.id].forEach(client => {
            winston.info({ event: 'link-updated', payload: payload.linkId, client: client.id })
            client.sendJSON({ event: 'link-updated', payload: payload.linkId })
        })
        // housekeeping by deleting linkGroup of the just updated link if there's no other links associated to it
        var linkGroupAssociatedLinks = await db.result('SELECT EXISTS (SELECT 1 FROM links WHERE link_group_id = $1)', [payload.oldLinkGroupId])
        if(!linkGroupAssociatedLinks.rows[0].exists) {
            db.none('DELETE from link_groups WHERE id = $1', [payload.oldLinkGroupId])
        }
        // housekeeping by deleting linkGroup of the just updated link if there's no other links associated to it
    } catch(error) {
        winston.error(error)
    }
}

// payload == { linkGroupId: linkGroupId, linkGroupName:linkGroupName }
async function renameLinkGroup(payload, client) {
    try {
        await db.none('UPDATE link_groups SET title = $1 WHERE id = $2 AND user_id = $3', [payload.linkGroupName, payload.linkGroupId, authUser.id])
        authenticatedClients[authUser.id].forEach(client => {
            winston.info({ event: 'link-group-updated', payload: payload, client: client.id })
            client.sendJSON({ event: 'link-group-updated', payload: payload })
        })
    } catch(error) {
        winston.error(error)
    }
}

function checkAuthMiddleware(req, res, next) {
    if(!checkAuth(req.header('authToken'), req.body)) {
        return res.json({
            success: false,
            message: 'Authentication failed'
        })
    }
    next()
}

var apiKeyRoutes = require('./routes/api-key')
app.use('/api-key', checkAuthMiddleware, apiKeyRoutes)

async function checkIfValidAPIToken(req) {
    if(req.body.username && req.body.apiKey) {
        try {
            let user = await db.one('SELECT id FROM users WHERE username = $1', [req.body.username])
            await db.one('SELECT id FROM api_keys WHERE api_key = $1 and user_id = $2', [req.body.apiKey, user.id])
        } catch(error) {
            return false
        }
        return true
    }
    return false
}

// request body must be of the format { username: username, apiKey: apiKey, title: title, link: link }
app.post('/add-link', async(req, res, next) => {
    try {
        if(await checkIfValidAPIToken(req)) {
            if(req.body.title && req.body.link) {
                await addLink(req.body)
                res.send('Success')
            } else {
                res.send('Invalid link format')
            }
        } else {
            res.send('Invalid API Key or Username')
        }
        next()
    } catch(error) {
        next(error)
    }
})
