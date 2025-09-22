const ws = new ReconnectingWebSocket(`${document.location.protocol === 'https:' ? 'wss' : 'ws'}://${document.location.host}`)

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
                        linkGroup.links = linkGroup.links.filter(link => link.id !== payload)
                        if(linkGroup.links.length === 0) { // if a linkGroup is empty
                            app.$store.state.links.splice(index, 1) // remove it from the array
                        }
                    })
                    app.$store.commit('updateLinkCount', app.$store.state.linkCount - 1)
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

function changeLinkGroup(linkId, newLinkGroupId) {
    wsSendJSON({ method: 'change-link-group', payload: { linkId: linkId, newLinkGroupId: newLinkGroupId } })
}

function renameLinkGroup(linkGroupId, linkGroupName) {
    wsSendJSON({ method: 'rename-link-group', payload: { linkGroupId, linkGroupName } })
}

function mergeGroups(targetGroupId, sourceGroupIds) {
    wsSendJSON({ method: 'merge-groups', payload: { targetGroupId, sourceGroupIds } })
}

function OnWebSocketOpen() {
    getLinks()
}

function createGroupWithLinks(linkIds, title = null) {
    wsSendJSON({ method: 'create-group-with-links', payload: { linkIds, title } })
}

function moveLinks(targetGroupId, linkIds) {
    wsSendJSON({ method: 'move-links', payload: { targetGroupId, linkIds } })
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

Vue.use(window['vue-js-modal'].default)

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
                <div v-if="!needLogin">
                    <a @click="viewAPIKeys" class="mr-1em">View API Keys</a>
                    <a @click="logout" class="logout">Logout</a>
                </div>
            </header>
            <main v-if="!needLogin && links.length > 0">
                <div v-for="linkGroup in links" class="link-group">
                    <div class="link-group-header">
                        <div class="title" v-if="linkGroup.linkGroup.title" @click="renameLinkGroup(linkGroup.linkGroup)">{{ linkGroup.linkGroup.title }}</div>
                        <div class="count" @click="renameLinkGroup(linkGroup.linkGroup)">{{ linkGroup.links.length }} Links</div>
                        <div>
                            <div class="creation-datetime">Created {{ momentDateTime(linkGroup.linkGroup.created_at) }}</div>
                            <div class="actions">
                                <a @click="openAllInGroup(linkGroup)">Restore All</a>
                                <a @click="deleteAllInGroup(linkGroup)">Delete All</a>
                                <a @click="copyAllInGroupToClipboard(linkGroup)">Copy All To Clipboard</a>
                                <a @click="openMergeModal(linkGroup)" title="Merge other groups into this one">Merge…</a>
                                <span class="host-group-action">
                                    <a @click="toggleHostMenu(linkGroup)">Create new group with…</a>
                                    <select v-if="linkGroup.showHostMenu" @change="createNewGroupWithHost(linkGroup, $event)" @blur="hideHostMenu(linkGroup)">
                                        <option value="" disabled selected>Select host…</option>
                                        <option v-for="host in uniqueHosts(linkGroup.links)" :value="host">{{ host }}</option>
                                    </select>
                                </span>
                                <span class="move-matching-action">
                                    <a @click="openMoveMatching(linkGroup)">Move matching...</a>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="drag-box" @dragover.prevent @drop="onDrop(linkGroup, $event)">
                        <div v-for="link in linkGroup.links" class="link-holder" draggable="true" @dragstart="onDrag(link, $event)">
                            <img src="images/cross.png" @click="deleteLink(link.id)" class="delete-link">
                            <img :src="'https://www.google.com/s2/favicons?domain=' + link.link" class="favicon">
                            <a :href="link.link" target="_blank" @click="deleteLink(link.id)">{{ link.title ? link.title : link.link }}</a>
                        </div>
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
            <modal name="view-api-keys" height="auto">
                <section class="p-1em" style="max-height: 30em; overflow-y: auto">
                    <div class="d-f flex-jc-sb flex-ai-fs">
                        <h2>API Keys</h2>
                        <button v-if="!generatingAPIKey" @click="generateAPIKey">Generate API Key</button>
                        <button disabled v-else>Generating API Key...</button>
                    </div>
                    <table class="mt-1em">
                        <thead>
                            <tr>
                                <th>API Key</th>
                                <th>Generated On</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="apiKey in apiKeys">
                                <td>{{ apiKey.api_key }}</td>
                                <td>{{ momentDateTime(apiKey.created_at) }}</td>
                                <td><button @click="deleteAPIKey(apiKey.id)">Delete</button></td>
                            </tr>
                            <tr v-if="apiKeys.length === 0">
                                <td colspan="100%">No API Keys Have Been Generated Yet</td>
                        </tbody>
                    </table>
                </section>
            </modal>
            <modal name="merge-groups" height="auto">
                <section class="p-1em" style="max-width: 28em;">
                    <h2>Merge groups into target</h2>
                    <div class="mt-1em mb-1em" v-if="mergeModal.targetGroupId">
                        Target Group ID: <strong>{{ mergeModal.targetGroupId }}</strong>
                    </div>
                    <div class="mb-1em">
                        <label style="display:block; margin:.25em 0;">
                            <input type="radio" value="intoTarget" v-model="mergeModal.mode">
                            <span style="margin-left:.5em">Merge selected groups into this target</span>
                        </label>
                        <label style="display:block; margin:.25em 0;">
                            <input type="radio" value="intoSelected" v-model="mergeModal.mode">
                            <span style="margin-left:.5em">Merge this target into a selected group</span>
                        </label>
                    </div>
                    <div v-if="mergeModal.mode === 'intoTarget'" style="max-height: 16em; overflow-y: auto; border: 1px solid #ddd; padding: .5em;">
                        <label v-for="g in mergeSourceCandidates" :key="g.linkGroup.id" style="display:block; margin:.25em 0;">
                            <input type="checkbox" :value="g.linkGroup.id" v-model="mergeModal.selectedSourceIds">
                            <span style="margin-left:.5em">#{{ g.linkGroup.id }} — {{ g.linkGroup.title || 'Untitled' }} ({{ g.links.length }} links)</span>
                        </label>
                        <div v-if="mergeSourceCandidates.length === 0">No other groups to merge.</div>
                    </div>
                    <div v-else style="max-height: 16em; overflow-y: auto; border: 1px solid #ddd; padding: .5em;">
                        <label v-for="g in mergeDestCandidates" :key="g.linkGroup.id" style="display:block; margin:.25em 0;">
                            <input type="radio" name="merge-dest" :value="g.linkGroup.id" v-model="mergeModal.selectedDestId">
                            <span style="margin-left:.5em">#{{ g.linkGroup.id }} — {{ g.linkGroup.title || 'Untitled' }} ({{ g.links.length }} links)</span>
                        </label>
                        <div v-if="mergeDestCandidates.length === 0">No other groups available.</div>
                    </div>
                    <div class="mt-1em d-f flex-jc-fe">
                        <button @click="$modal.hide('merge-groups')">Cancel</button>
                        <button class="ml-1em" :disabled="!canConfirmMerge" @click="confirmMerge">Merge</button>
                    </div>
                </section>
            </modal>
            <modal name="move-matching" height="auto">
                <section class="p-1em" style="max-width: 28em;">
                    <h2>Move matching...</h2>
                    <div class="mt-1em mb-0_5em" v-if="moveMatching.sourceGroupId"><strong>From group:</strong> #{{ moveMatching.sourceGroupId }}</div>
                    <div class="mb-1em">
                        <label class="label" for="mm-host">Host</label>
                        <select id="mm-host" v-model="moveMatching.host">
                            <option disabled value="">Select host…</option>
                            <option v-for="host in moveMatching.hosts" :value="host">{{ host }}</option>
                        </select>
                    </div>
                    <div class="mb-1em">
                        <label class="label">Target group</label>
                        <div style="max-height: 16em; overflow-y: auto; border: 1px solid #ddd; padding: .5em;">
                            <label v-for="g in moveMatchingTargetCandidates" :key="g.linkGroup.id" style="display:block; margin:.25em 0;">
                                <input type="radio" name="mm-target" :value="g.linkGroup.id" v-model.number="moveMatching.selectedTargetId">
                                <span style="margin-left:.5em">#{{ g.linkGroup.id }} — {{ g.linkGroup.title || 'Untitled' }} ({{ g.links.length }} links)</span>
                            </label>
                            <div v-if="moveMatchingTargetCandidates.length === 0">No other groups available.</div>
                        </div>
                    </div>
                    <div class="mt-1em d-f flex-jc-fe">
                        <button @click="$modal.hide('move-matching')">Cancel</button>
                        <button class="ml-1em" :disabled="!canConfirmMoveMatching" @click="confirmMoveMatching">Move</button>
                    </div>
                </section>
            </modal>
        </div>
    `,
    data: {
        username: null,
        password: null,
        authError: null,
        register: false,
    apiKeys: [],
    generatingAPIKey: false
        ,
            mergeModal: { targetGroupId: null, selectedSourceIds: [], mode: 'intoTarget', selectedDestId: null },
        moveMatching: { sourceGroupId: null, host: '', hosts: [], selectedTargetId: null }
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
        },
        mergeSourceCandidates() {
            if(!this.mergeModal.targetGroupId) return []
            return this.links.filter(g => g.linkGroup.id != this.mergeModal.targetGroupId)
        },
        mergeDestCandidates() {
            // same as source candidates; kept separate for clarity
            return this.mergeSourceCandidates
        },
        canConfirmMerge() {
            if(this.mergeModal.mode === 'intoTarget') {
                return this.mergeModal.selectedSourceIds && this.mergeModal.selectedSourceIds.length > 0
            } else {
                return !!this.mergeModal.selectedDestId
            }
        },
        moveMatchingTargetCandidates() {
            if(!this.moveMatching.sourceGroupId) return []
            return this.links.filter(g => g.linkGroup.id != this.moveMatching.sourceGroupId)
        },
        canConfirmMoveMatching() {
            return !!this.moveMatching.host && !!this.moveMatching.selectedTargetId
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
            if(confirm('Are you sure you want to logout?')) {
                localStorage.clear()
                getLinks()
            }
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
        copyAllInGroupToClipboard(linkGroup) {
            var clipboardText = ''
            linkGroup.links.forEach(linkObj => {
                clipboardText += linkObj.link + '\n'
            })
            navigator.clipboard.writeText(clipboardText)
            alert(`${linkGroup.links.length} links copied to clipboard`)
        },
        toggleHostMenu(linkGroup) {
            this.$set(linkGroup, 'showHostMenu', !linkGroup.showHostMenu)
        },
        hideHostMenu(linkGroup) {
            this.$set(linkGroup, 'showHostMenu', false)
        },
        uniqueHosts(links) {
            const hosts = new Set()
            links.forEach(l => {
                try {
                    const u = new URL(l.link)
                    hosts.add(u.host)
                } catch(e) { /* ignore invalid urls */ }
            })
            return Array.from(hosts).sort()
        },
        createNewGroupWithHost(linkGroup, event) {
            const host = event.target.value
            if(!host) return
            const linkIds = linkGroup.links.filter(l => {
                try { return new URL(l.link).host === host } catch(e) { return false }
            }).map(l => l.id)
            const defaultTitle = `${host}`
            const title = prompt('New Group Name (optional)', defaultTitle)
            if (title === null) { // user cancelled -> do nothing
                event.target.value = ''
                this.$set(linkGroup, 'showHostMenu', false)
                return
            }
            createGroupWithLinks(linkIds, title)
            this.$set(linkGroup, 'showHostMenu', false)
            event.target.value = ''
        },
        momentDateTime(dateTime) {
            return moment.utc(dateTime).local().format('DD-MMM-YY h:mm A')
        },
        onDrag(link, event) {
            event.dataTransfer.setData('link', JSON.stringify(link))
        },
        onDrop(linkGroup, event) {
            var link = JSON.parse(event.dataTransfer.getData('link'))
            changeLinkGroup(link.id, linkGroup.linkGroup.id)
            if(linkGroup.linkGroup.id !== link.link_group_id) { // ensures the link isn't added back to the same group as it was dragged from
                this.$store.state.links.forEach((linkGroup, index) => {
                    if(linkGroup.linkGroup.id == link.link_group_id) {
                        linkGroup.links = linkGroup.links.filter(aLink => aLink.id !== link.id)
                    }
                    if(linkGroup.links.length == 0) { // if a linkGroup is empty
                        app.$store.state.links.splice(index, 1) // remove it from the array
                    }
                })
                link.link_group_id = linkGroup.linkGroup.id
                linkGroup.links.unshift(link)
            }
        },
        viewAPIKeys() {
            this.fetchAPIKeys()
            this.$modal.show('view-api-keys')
        },
        fetchAPIKeys(callback=null) {
            let authToken = localStorage.getItem('authToken')
            fetch('/api-key/list', {
                method: 'get',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'authToken': authToken
                }
            })
            .then(response => response.json())
            .then(response => {
                if(response.hasOwnProperty('success') && !response.success) {
                    alert('Auth failed')
                } else {
                    this.apiKeys = response
                    if(callback) {
                        callback()
                    }
                }
            })
        },
        generateAPIKey() {
            this.generatingAPIKey = true
            let authToken = localStorage.getItem('authToken')
            fetch('/api-key/generate', {
                method: 'post',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'authToken': authToken
                }
            })
            .then(response => response.json())
            .then(response => {
                if(response.hasOwnProperty('success') && !response.success) {
                    alert('Auth failed')
                } else {
                    this.fetchAPIKeys()
                }
                this.generatingAPIKey = false
            })
        },
        createLoader(loaderMessage) {
            let loader = document.createElement('div')
            loader.style.cssText = `
                position: fixed;
                background-color: #00000036;
                height: 100vh;
                width: 100vw;
                z-index: 1000;
                top: 0;
            `
            loader.innerHTML = `
                <div style="height: 100vh; display: flex; justify-content: center; align-items: center; color: white; font-size: 2em;">${loaderMessage}</div>
            `
            document.body.appendChild(loader)
            return loader
        },
        deleteAPIKey(id) {
            let loader = this.createLoader('Deleting...')
            let authToken = localStorage.getItem('authToken')
            fetch(`/api-key/delete/${id}`, {
                method: 'delete',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'authToken': authToken
                }
            }).then(() => {
                this.fetchAPIKeys(() => loader.remove())
            })
        },
        renameLinkGroup(linkGroup) {
            let linkGroupName = prompt('Link Group Name', linkGroup.title ? linkGroup.title : '')

            if(linkGroupName || linkGroupName === '') {
                renameLinkGroup(linkGroup.id, linkGroupName)
                linkGroup.title = linkGroupName
            }
        },
        openMergeModal(linkGroup) {
            this.mergeModal = { targetGroupId: linkGroup.linkGroup.id, selectedSourceIds: [], mode: 'intoTarget', selectedDestId: null }
            this.$modal.show('merge-groups')
        },
        confirmMerge() {
            if(this.mergeModal.mode === 'intoTarget') {
                if(this.mergeModal.selectedSourceIds.length === 0) return
                mergeGroups(this.mergeModal.targetGroupId, this.mergeModal.selectedSourceIds.map(id => Number(id)))
            } else {
                const dest = Number(this.mergeModal.selectedDestId)
                if(!dest) return
                mergeGroups(dest, [Number(this.mergeModal.targetGroupId)])
            }
            this.$modal.hide('merge-groups')
            this.mergeModal = { targetGroupId: null, selectedSourceIds: [], mode: 'intoTarget', selectedDestId: null }
        },
        openMoveMatching(linkGroup) {
            const hosts = this.uniqueHosts(linkGroup.links)
            this.moveMatching = { sourceGroupId: linkGroup.linkGroup.id, host: hosts[0] || '', hosts, selectedTargetId: null }
            this.$modal.show('move-matching')
        },
        confirmMoveMatching() {
            const fromGroup = this.links.find(g => g.linkGroup.id === this.moveMatching.sourceGroupId)
            if(!fromGroup) return
            const linkIds = fromGroup.links.filter(l => {
                try { return new URL(l.link).host === this.moveMatching.host } catch(e) { return false }
            }).map(l => l.id)
            // linkIds should be > 0 as host is derived from existing links; extra safety not needed
            moveLinks(this.moveMatching.selectedTargetId, linkIds)
            this.$modal.hide('move-matching')
            this.moveMatching = { sourceGroupId: null, host: '', hosts: [], selectedTargetId: null }
        }
    },
})

window.addEventListener('keydown', e => {
    if(e.ctrlKey && e.code == 'KeyZ') {
        console.log('undo delete')
    }
})
