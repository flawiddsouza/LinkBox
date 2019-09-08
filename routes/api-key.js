const router = require('express').Router()

const db = require('../db')

function shuffle(string) {
    var parts = string.split('')
    for (var i = parts.length; i > 0;) {
        var random = parseInt(Math.random() * i)
        var temp = parts[--i]
        parts[i] = parts[random]
        parts[random] = temp
    }
    return parts.join('')
}

router.post('/generate', (req, res) => {
    let apiKey = shuffle('abcdefghijklmnopqrstuvwxyz0123456789');
    db.none('INSERT INTO api_keys(api_key, user_id) VALUES($1, $2)', [apiKey, req.body.authUser.id])
    .then(() => {
        return res.json({
            success: true,
            message: 'API Key Generated'
        })
    })
    .catch(() => {
        return res.json({
            success: false,
            message: 'API Key Could Not Be Generated'
        })
    })
})

router.get('/list', (req, res) => {
    db.query('SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at ASC', [req.body.authUser.id]).then(rows => res.send(rows))
})

router.delete('/delete/:id', (req, res) => {
    db.none('DELETE FROM api_keys WHERE id = $1 and user_id = $2', [req.params.id, req.body.authUser.id]).then(() => {
        res.send('Success')
    }).catch(() => {
        res.send('Error')
    })
})

module.exports = router
