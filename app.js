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
            var requestId = receivedJSON.requestId
            const user = checkAuth(authToken)
            if(user) {
                const userId = user.id
                // assign the key value to itself if it exists, else assign an empty array
                authenticatedClients[userId] = authenticatedClients[userId] || []
                if(authenticatedClients[userId].length == 0) {
                    authenticatedClients[userId].push(client)
                }
                var clientAlreadyExists = false
                authenticatedClients[userId].forEach(preExistingClient => {
                    if(client.id == preExistingClient.id) {
                        clientAlreadyExists = true
                    }
                })
                if(!clientAlreadyExists) {
                    authenticatedClients[userId].push(client)
                }
                // remember which user this socket belongs to for cleanup
                client.userId = userId
                if(method) {
                    switch(method) {
                        case 'get-links':
                            winston.info({ method: 'get-links', client: client.id })
                            getLinks(client, userId)
                            break
                        case 'add-link':
                            winston.info({ method: 'add-link', payload: payload, client: client.id })
                            addLink(payload, userId, requestId)
                            break
                        case 'add-links':
                            winston.info({ method: 'add-links', payload: payload, client: client.id })
                            addLinks(payload, userId, requestId)
                            break
                        case 'delete-link':
                            winston.info({ method: 'delete-link', payload: payload, client: client.id })
                            deleteLink(payload, client, userId)
                            break
                        case 'change-link-group':
                            winston.info({ method: 'change-link-group', payload: payload, client: client.id })
                            changeLinkGroup(payload, client, userId)
                            break
                        case 'rename-link-group':
                            winston.info({ method: 'rename-link-group', payload: payload, client: client.id })
                            renameLinkGroup(payload, client, userId)
                            break
                        case 'create-group-with-links':
                            winston.info({ method: 'create-group-with-links', payload: payload, client: client.id })
                            createGroupWithLinks(payload, client, userId)
                            break
                        case 'merge-groups':
                            winston.info({ method: 'merge-groups', payload: payload, client: client.id })
                            mergeGroups(payload, client, userId)
                            break
                        case 'move-links':
                            winston.info({ method: 'move-links', payload: payload, client: client.id })
                            moveLinks(payload, client, userId)
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
        if (client.userId && authenticatedClients[client.userId]) {
            authenticatedClients[client.userId] = authenticatedClients[client.userId].filter(preExistingClient => preExistingClient.id !== client.id)
        }
    })

    // need this so the server doesn't crash
    // see: https://github.com/websockets/ws/issues/1256#issuecomment-352288884
    // also useful when close isn't sent by the client
    client.on('error', error => {
        if (client.userId && authenticatedClients[client.userId]) {
            authenticatedClients[client.userId] = authenticatedClients[client.userId].filter(preExistingClient => preExistingClient.id !== client.id)
        }
    })

})

function checkAuth(authToken, middlewareRequestBody=null) {
    if(authToken) {
        try {
            var decoded = jwt.verify(authToken, process.env.JWT_SECRET)
            if(middlewareRequestBody) {
                middlewareRequestBody.authUser = decoded
            }
            return decoded
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

function getLinks(client, userId) {
    db.query('SELECT * FROM links WHERE user_id = $1 ORDER BY updated_at DESC', [userId])
    .then(rows => {
        var group_to_values = rows.reduce((obj, item) => {
            obj[item.link_group_id] = obj[item.link_group_id] || []
            obj[item.link_group_id].push(item)
            return obj;
        }, {})

        var groups = Object.keys(group_to_values).map(key => {
            return { linkGroup: { id: key }, links: group_to_values[key] }
        })

        db.query('SELECT * FROM link_groups WHERE user_id = $1', [userId])
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
async function addLink(payload, userId, requestId = null) {
    if(!userId) {
        throw new Error('userId required')
    }

    try {
        // Determine the most recent link_group for this user by creation time.
        // If none exists OR if the most recent group is older than 3 days,
        // create a fresh group and use that for the new link.
        let linkGroupId = null
        try {
            const lastGroup = await db.one('SELECT id, (NOW() - created_at) > interval \'3 days\' AS is_old FROM link_groups WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [userId])
            if (lastGroup.is_old) {
                const newGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [userId])
                linkGroupId = newGroup.id
            } else {
                linkGroupId = lastGroup.id
            }
        } catch(error) {
            // No existing group found → create one
            if(error.name === 'QueryResultError') {
                const newGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [userId])
                linkGroupId = newGroup.id
            } else {
                winston.error(error)
                throw error
            }
        }
        await db.none('INSERT INTO links(title, link, link_group_id, user_id) VALUES ($1, $2, $3, $4)', [payload.title, payload.link, linkGroupId, userId])
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                client.sendJSON({ event: 'link-added', payload: requestId ? { requestId } : undefined })
            })
        }
    } catch(error) {
        winston.error(error)
    }
}

// payload == linkObject Array
async function addLinks(payload, userId, requestId = null) {
    if(!userId) {
        throw new Error('userId required')
    }

    try {
        var linkGroup = await db.one('INSERT INTO link_groups(user_id) VALUES ($1) RETURNING id', [userId])
        for(let link of payload) {
            await db.none('INSERT INTO links(title, link, link_group_id, user_id) VALUES ($1, $2, $3, $4)', [link.title, link.link, linkGroup.id, userId])
        }
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                client.sendJSON({ event: 'links-added', payload: requestId ? { requestId } : undefined })
            })
        }
    } catch(error) {
        winston.error(error)
    }
}

// payload == linkId
async function deleteLink(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        var result = await db.result('DELETE FROM links WHERE id = $1 AND user_id = $2 RETURNING link_group_id', [payload, userId])
        if(result.rowCount !== 0) {
            if (authenticatedClients[userId]) {
                authenticatedClients[userId].forEach(client => {
                    winston.info({ event: 'link-deleted', payload: payload, client: client.id })
                    client.sendJSON({ event: 'link-deleted', payload: payload })
                })
            }
            // housekeeping by deleting linkGroup of the just deleted link if there's no other links associated to it
            var linkGroupId = result.rows[0].link_group_id
            var linkGroupAssociatedLinks = await db.result('SELECT EXISTS (SELECT 1 FROM links WHERE link_group_id = $1 AND user_id = $2)', [linkGroupId, userId])
            if(!linkGroupAssociatedLinks.rows[0].exists) {
                db.none('DELETE from link_groups WHERE id = $1 AND user_id = $2', [linkGroupId, userId])
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

// payload == { linkId: linkId, newLinkGroupId: newLinkGroupId }
async function changeLinkGroup(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        // Ensure destination group belongs to this user
        await db.one('SELECT id FROM link_groups WHERE id = $1 AND user_id = $2', [payload.newLinkGroupId, userId])

        // Derive old group id from DB
        const existing = await db.one('SELECT link_group_id FROM links WHERE id = $1 AND user_id = $2', [payload.linkId, userId])
        const oldGroupId = existing.link_group_id

        // Perform the update scoped to this user
        await db.none('UPDATE links SET link_group_id = $1 WHERE id = $2 AND user_id = $3', [payload.newLinkGroupId, payload.linkId, userId])
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                winston.info({ event: 'link-updated', payload: payload.linkId, client: client.id })
                client.sendJSON({ event: 'link-updated', payload: payload.linkId })
            })
        }
        // housekeeping by deleting linkGroup of the just updated link if there's no other links associated to it
        var linkGroupAssociatedLinks = await db.result('SELECT EXISTS (SELECT 1 FROM links WHERE link_group_id = $1 AND user_id = $2)', [oldGroupId, userId])
        if(!linkGroupAssociatedLinks.rows[0].exists) {
            db.none('DELETE from link_groups WHERE id = $1 AND user_id = $2', [oldGroupId, userId])
        }
        // housekeeping by deleting linkGroup of the just updated link if there's no other links associated to it
    } catch(error) {
        winston.error(error)
    }
}

// payload == { linkGroupId: linkGroupId, linkGroupName:linkGroupName }
async function renameLinkGroup(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        await db.none('UPDATE link_groups SET title = $1 WHERE id = $2 AND user_id = $3', [payload.linkGroupName, payload.linkGroupId, userId])
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                winston.info({ event: 'link-group-updated', payload: payload, client: client.id })
                client.sendJSON({ event: 'link-group-updated', payload: payload })
            })
        }
    } catch(error) {
        winston.error(error)
    }
}

// payload == { linkIds: [..], title?: string }
async function createGroupWithLinks(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        if(!payload || !Array.isArray(payload.linkIds) || payload.linkIds.length === 0) {
            return
        }
        // create new group, optionally titled
        const newGroup = await db.one('INSERT INTO link_groups(user_id, title) VALUES ($1, $2) RETURNING id', [userId, payload.title || null])
        // move each link to the new group for this user
        // update in reverse order so that ORDER BY updated_at DESC preserves original order
        for (let i = payload.linkIds.length - 1; i >= 0; i--) {
            const linkId = payload.linkIds[i]
            await db.none('UPDATE links SET link_group_id = $1 WHERE id = $2 AND user_id = $3', [newGroup.id, linkId, userId])
        }
        // notify clients; reuse existing event to minimize client changes
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                winston.info({ event: 'links-added', payload: { newGroupId: newGroup.id, moved: payload.linkIds.length }, client: client.id })
                client.sendJSON({ event: 'links-added' })
            })
        }
    } catch(error) {
        winston.error(error)
    }
}

// payload == { targetGroupId: number, sourceGroupIds: number[] }
async function mergeGroups(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        if(!payload || !payload.targetGroupId || !Array.isArray(payload.sourceGroupIds) || payload.sourceGroupIds.length === 0) {
            return
        }
        // filter out any accidental inclusion of target in sources and dedupe
        const targetId = Number(payload.targetGroupId)
        const sourceIds = Array.from(new Set(payload.sourceGroupIds.map(Number))).filter(id => id !== targetId)
        if(sourceIds.length === 0) {
            return
        }
        // ensure the target group belongs to the user (no-op result throws if not found)
        await db.one('SELECT id FROM link_groups WHERE id = $1 AND user_id = $2', [targetId, userId])

        // fetch links from source groups in current visual order (updated_at DESC)
        const sourceLinks = await db.any('SELECT id FROM links WHERE user_id = $1 AND link_group_id IN ($2:csv) ORDER BY updated_at DESC', [userId, sourceIds])
        // update in reverse order so ORDER BY updated_at DESC preserves original order
        for (let i = sourceLinks.length - 1; i >= 0; i--) {
            const linkId = sourceLinks[i].id
            await db.none('UPDATE links SET link_group_id = $1 WHERE id = $2 AND user_id = $3', [targetId, linkId, userId])
        }

        // delete emptied source groups that belong to this user
        await db.none('DELETE FROM link_groups WHERE user_id = $1 AND id IN ($2:csv)', [userId, sourceIds])

        // notify clients; reuse existing event to trigger a refresh on clients
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                winston.info({ event: 'links-added', payload: { mergedInto: targetId, mergedFrom: sourceIds }, client: client.id })
                client.sendJSON({ event: 'links-added' })
            })
        }
    } catch(error) {
        winston.error(error)
    }
}

// payload == { targetGroupId: number, linkIds: number[] }
async function moveLinks(payload, client, userId) {
    if(!userId) {
        throw new Error('userId required')
    }
    try {
        if(!payload || !payload.targetGroupId || !Array.isArray(payload.linkIds) || payload.linkIds.length === 0) {
            return
        }
        const targetId = Number(payload.targetGroupId)
        const linkIds = Array.from(new Set(payload.linkIds.map(Number)))

        // ensure the target group belongs to the user
        await db.one('SELECT id FROM link_groups WHERE id = $1 AND user_id = $2', [targetId, userId])

        // Fetch existing links (scoped to user) to honor existing visual order
        const existing = await db.any('SELECT id FROM links WHERE user_id = $1 AND id IN ($2:csv) ORDER BY updated_at DESC', [userId, linkIds])

        // Update in reverse order so ORDER BY updated_at DESC preserves original order after move
        for (let i = existing.length - 1; i >= 0; i--) {
            const linkId = existing[i].id
            await db.none('UPDATE links SET link_group_id = $1 WHERE id = $2 AND user_id = $3', [targetId, linkId, userId])
        }

        // notify clients; reuse links-added to trigger a refresh
        if (authenticatedClients[userId]) {
            authenticatedClients[userId].forEach(client => {
                winston.info({ event: 'links-added', payload: { movedTo: targetId, count: existing.length }, client: client.id })
                client.sendJSON({ event: 'links-added' })
            })
        }
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
            return user.id
        } catch(error) {
            return false
        }
    }
    return false
}

// request body must be of the format { username: username, apiKey: apiKey, title: title, link: link }
app.post('/add-link', async(req, res, next) => {
    try {
        let userId = await checkIfValidAPIToken(req)
        if(userId) {
            if(req.body.title && req.body.link) {
                await addLink(req.body, userId)
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
