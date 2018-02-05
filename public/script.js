const ws = new ReconnectingWebSocket(`ws://${document.location.host}`)

ws.addEventListener('message', e => {
    try {
        var receivedJSON = JSON.parse(e.data)
        var event = receivedJSON.event
        var payload = receivedJSON.payload
        if(event) {
            switch(event) {
                case 'receive-links':
                    onReceiveLinks(payload)
                    break
                case 'need-valid-token':
                    onNeedValidToken(payload)
                    break
                case 'link-added':
                    getLinks()
                    break
                case 'links-added':
                    getLinks()
                    break
                case 'link-deleted':
                    app.$store.state.links.forEach((linkGroup, index) => {
                        var newLinkGroupLinks = linkGroup.links.filter(link => link.id !== payload)
                        linkGroup.links = newLinkGroupLinks
                        if(linkGroup.links.length == 0) { // if a linkGroup is empty
                            app.$store.state.links.splice(index, 1) // remove it from the array
                        }
                        app.$store.commit('updateLinkCount', app.$store.state.linkCount - 1)
                    })
                    break
                case 'link-already-deleted':
                    // console.log('link already deleted')
                    break
            }
        }
    } catch(err) {
        if(err instanceof SyntaxError) {
            console.log('Invalid JSON received:', e.data)
        } else {
            console.log(err)
        }
    }
})

ws.addEventListener('close', () => {
    app.$store.commit('updateWebSocketDisconnected', true)
})

ws.addEventListener('open', () => {
    app.$store.commit('updateWebSocketDisconnected', false)
})

// payload == links
function onReceiveLinks(payload) {
    app.$store.commit('updateNeedLogin', false)
    app.$store.commit('updateLinks', payload.linkGroups)
    app.$store.commit('updateLinkCount', payload.linkCount)
}

// payload == { method, payload }
function onNeedValidToken(payload) {
    console.log('needvalidtoken')
    if(!localStorage.getItem('authToken')) { // show login form only if token is absent from localStorage
        app.$store.commit('updateNeedLogin', true)
    } else { // if it is present, time to renew it
        var username = localStorage.getItem('username')
        var password = localStorage.getItem('password')
        if(username && password) {
            if(payload) {
                app.loginUser(username, password, () => wsSendJSON(payload))
            } else {
                app.loginUser(username, password)
            }
        } else {
            app.$store.commit('updateNeedLogin', true)
        }
    }
}

ws.addEventListener('open', OnWebSocketOpen)

function wsSendJSON(obj) {
    if(ws.readyState === WebSocket.OPEN) {
        var authToken = localStorage.getItem('authToken')
        Object.assign(obj, { authToken: authToken }) // attach authToken to the send
        ws.send(JSON.stringify(obj))
    } else {
        console.log('wsSendJSON failed because WebSocket is not open')
    }
}

function getLinks() {
    wsSendJSON({ method: 'get-links' })
}

function addLink(title, link) {
    wsSendJSON({ method: 'add-link', payload: { title: title, link: link } })
}

function addLinks(linkArray) {
    wsSendJSON({ method: 'add-links', payload: linkArray })
}

function deleteLink(id) {
    wsSendJSON({ method: 'delete-link', payload: id })
}

function OnWebSocketOpen() {
    getLinks()
}

const store = new Vuex.Store({
    state: {
        links: [],
        linkCount: 0,
        needLogin: false,
        webSocketDisconnected: false
    },
    mutations: {
        updateLinks: (state, links) => {
            state.links = links
        },
        updateLinkCount: (state, linkCount) => {
            state.linkCount = linkCount
        },
        updateNeedLogin: (state, needLogin) => {
            state.needLogin = needLogin
        },
        updateWebSocketDisconnected: (state, webSocketDisconnected) => {
            state.webSocketDisconnected = webSocketDisconnected
        }
    }
})

var app = new Vue({
    el: '#app',
    store: store,
    template: `
        <div>
            <header>
                <h1>LinkBox</h1>
                <div v-if="!needLogin">Total: {{ linkCount }} Links</div>
                <span v-if="!needLogin && webSocketDisconnected">Disconnected</span>
                <span v-else-if="!needLogin && !webSocketDisconnected">Connected</span>
                <a @click="logout" class="logout" v-if="!needLogin">Logout</a>
            </header>
            <main v-if="!needLogin && links.length > 0">
                <div v-for="linkGroup in links" class="link-group">
                    <div class="link-group-header">
                        <div class="title" v-if="linkGroup.linkGroup.title">{{ linkGroup.linkGroup.title }}</div>
                        <div class="count">{{ linkGroup.links.length }} Links</div>
                        <div>
                            <div class="creation-datetime">Created {{ momentDateTime(linkGroup.linkGroup.created_at) }}</div>
                            <div class="actions">
                                <a @click="openAllInGroup(linkGroup)">Restore All</a>
                                <a @click="deleteAllInGroup(linkGroup)">Delete All</a>
                            </div>
                        </div>
                    </div>
                    <div v-for="link in linkGroup.links" class="link-holder">
                        <img src="images/cross.png" @click="deleteLink(link.id)" class="delete-link">
                        <img :src="'https://www.google.com/s2/favicons?domain=' + link.link" class="favicon">
                        <a :href="link.link" target="_blank" @click="deleteLink(link.id)">{{ link.title ? link.title : link.link }}</a>
                    </div>
                </div>
            </main>
            <main class="no-links" v-else-if="!needLogin && links.length == 0">
                Hi, your LinkBox is empty. Add some links to brighten things up.
            </main>
            <main class="login" v-else-if="needLogin">
                <div class="message is-danger" v-if="authError">
                    <div class="message-header">Error!</div>
                    <div class="message-body">{{ authError }}</div>
                </div>
                <form v-on:submit.prevent="loginUser" v-if="!register">
                    <label class="label" for="username">Username</label>
                    <input type="text" id="username" v-model="username">
                    <label class="label" for="password">Password</label>
                    <input type="password" id="password" v-model="password">
                    <button type="submit">Login</button>
                    <div class="user-helper">New to LinkBox? <a @click="switchToRegistrationForm">Create an account.</a></div>
                </form>
                <form v-on:submit.prevent="registerUser" v-else>
                    <label class="label" for="username">Username</label>
                    <input type="text" name="username" v-model="username">
                    <label class="label" for="password">Password</label>
                    <input type="password" name="password" v-model="password">
                    <button type="submit">Register</button>
                    <div class="user-helper">Already have an account? <a @click="switchToLoginForm">Click to Login instead</a></div>
                </form>
            </main>
        </div>
    `,
    data: {
        username: null,
        password: null,
        authError: null,
        register: false
    },
    computed: {
        links() {
          return this.$store.state.links
        },
        linkCount() {
            return this.$store.state.linkCount
        },
        needLogin() {
            return this.$store.state.needLogin
        },
        webSocketDisconnected() {
            return this.$store.state.webSocketDisconnected
        }
    },
    methods: {
        deleteLink(id) {
            deleteLink(id)
        },
        switchToRegistrationForm() {
            this.authError = false
            this.register = true
        },
        switchToLoginForm() {
            this.authError = false
            this.register = false
        },
        loginUser(username = null, password = null, callback = null) {
            if(!username || !password) {
                username = this.username
                password = this.password
                // console.log('loginUser', 'fresh')
            } else {
                // console.log('loginUser', 'renew token')
            }

            fetch('/authenticate', {
                method: 'post',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: username, password: password })
            })
            .then(res => res.json())
            .then(res => {
                if(res.success) {
                    localStorage.setItem('authToken', res.token)
                    if(callback) {
                        callback()
                    } else {
                        getLinks()
                    }
                    localStorage.setItem('username', username)
                    localStorage.setItem('password', password)
                    this.authError = null
                    this.username = null
                    this.password = null
                } else {
                    this.authError = res.message
                }
            })
        },
        registerUser() {
            fetch('/register', {
                method: 'post',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: this.username, password: this.password })
            })
            .then(res => res.json())
            .then(res => {
                if(res.success) {
                    this.loginUser()
                    this.authError = null
                    this.username = null
                    this.password = null
                } else {
                    this.authError = res.message.replace('Authentication', 'Registration')
                }
            })
        },
        logout() {
            localStorage.clear()
            getLinks()
        },
        openAllInGroup(linkGroup) {
            var popupBlocked = false
            linkGroup.links.forEach(linkObj => {
                var popup = window.open(linkObj.link)
                if(popup) {
                    this.deleteLink(linkObj.id)
                } else {
                    popupBlocked = true
                }
            })
            if(popupBlocked) {
                alert("Please allow popups for this site in your site settings")
            }
        },
        deleteAllInGroup(linkGroup) {
            if(confirm("Are you sure?")) {
                linkGroup.links.forEach(linkObj => {
                    this.deleteLink(linkObj.id)
                })
            }
        },
        momentDateTime(dateTime) {
            return moment.utc(dateTime).local().format('DD-MMM-YY h:mm A')
        }
    },
})

window.addEventListener('keydown', e => {
    if(e.ctrlKey && e.code == 'KeyZ') {
        console.log('undo delete')
    }
})