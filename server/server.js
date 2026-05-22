import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { expressjwt } from 'express-jwt'
import { expressJwtSecret } from 'jwks-rsa'
import { initDb, closeDb, logUserAccess, logGeneration, queryUserAccess, queryGenerationLog, insertMusicManagement, updateMusicStatus, deleteMusicRecord, getMusicFilename, queryMusicManagement } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MUSIC_DIR = path.join(__dirname, 'local_music')

let serverConfig = { cache_mode: 'server' }
try {
  const configPath = path.join(__dirname, 'config.json')
  const configData = fs.readFileSync(configPath, 'utf8')
  serverConfig = JSON.parse(configData)
} catch (err) {
  console.error('[Server] config.json not found, using defaults')
}

const TOKEN = serverConfig.token || ''
const TARGET_HOST = serverConfig.api_url ? serverConfig.api_url.replace(/^https?:\/\//, '') : 'localhost'
const PORT = serverConfig.port || 55175

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true })
  console.log(`[Server] Created music directory: ${MUSIC_DIR}`)
}

initDb()

const adminCache = new Map()
let mgmtTokenCache = { token: null, expiresAt: 0 }

async function getMgmtAccessToken() {
  if (mgmtTokenCache.token && Date.now() < mgmtTokenCache.expiresAt) {
    return mgmtTokenCache.token
  }
  const mgmtId = process.env.AUTH0_MGMT_CLIENT_ID || serverConfig.auth0_mgmt_client_id
  const mgmtSecret = process.env.AUTH0_MGMT_CLIENT_SECRET || serverConfig.auth0_mgmt_client_secret
  if (!mgmtId || !mgmtSecret) throw new Error('Management API not configured')
  const domain = serverConfig.auth0_domain
  const res = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: mgmtId,
      client_secret: mgmtSecret,
      audience: `https://${domain}/api/v2/`,
      grant_type: 'client_credentials'
    })
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(data.error_description || 'Failed to get management token')
  mgmtTokenCache.token = data.access_token
  mgmtTokenCache.expiresAt = Date.now() + (data.expires_in || 86400) * 1000 - 60000
  return data.access_token
}

const app = express()
app.use(cors())

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

// Auth0 JWT 验证中间件
const AUTH0_DOMAIN = serverConfig.auth0_domain
const AUTH0_AUDIENCE = serverConfig.auth0_audience
const ADMIN_EMAILS = serverConfig.admin_emails || []
if (AUTH0_DOMAIN && AUTH0_AUDIENCE) {
  const checkJwt = expressjwt({
    secret: expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
    }),
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
  })
  const adminMiddleware = async (req, res, next) => {
    try {
      const sub = req.auth?.sub
      if (!sub) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      if (adminCache.has(sub)) {
        if (adminCache.get(sub)) { next(); return }
        res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }
      const mgmtToken = await getMgmtAccessToken()
      const userRes = await fetch(`https://${AUTH0_DOMAIN}/api/v2/users/${sub}`, {
        headers: { Authorization: `Bearer ${mgmtToken}` }
      })
      if (userRes.ok) {
        const userData = await userRes.json()
        const isAdmin = ADMIN_EMAILS.includes(userData.email)
        adminCache.set(sub, isAdmin)
        if (isAdmin) { next(); return }
      }
      res.writeHead(403, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: 'Forbidden' }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: err.message }))
    }
  }
  app.use('/music-save', checkJwt)
  app.use('/music-files', checkJwt)
  app.use('/music', checkJwt)
  app.use('/api/log-access', checkJwt)
  app.use('/api/log-generation', checkJwt)
  app.use('/api/admin', checkJwt, adminMiddleware)
}

app.get('/api/config', (req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ cache_mode: serverConfig.cache_mode || 'server' }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

app.get('/api/system_stats', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ available: true }))
})

app.post('/api/log-access', (req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return }
  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    try {
      const { email } = JSON.parse(body)
      logUserAccess({
        userSub: req.auth?.sub,
        email,
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent']
      })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

app.post('/api/log-generation', (req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return }
  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    try {
      const data = JSON.parse(body)
      logGeneration({ userSub: req.auth?.sub, ...data })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

app.get('/api/admin/db/user-access', (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0
    const limit = parseInt(req.query.limit) || 50
    const sortBy = req.query.sortBy || 'created_at'
    const sortOrder = req.query.sortOrder || 'DESC'
    const search = req.query.search || ''
    const result = queryUserAccess({ offset, limit, sortBy, sortOrder, search })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.get('/api/admin/db/generation-log', (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0
    const limit = parseInt(req.query.limit) || 50
    const sortBy = req.query.sortBy || 'created_at'
    const sortOrder = req.query.sortOrder || 'DESC'
    const search = req.query.search || ''
    const result = queryGenerationLog({ offset, limit, sortBy, sortOrder, search })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.get('/api/admin/music', (req, res) => {
  try {
    const offset = parseInt(req.query.offset) || 0
    const limit = parseInt(req.query.limit) || 50
    const sortBy = req.query.sortBy || 'created_at'
    const sortOrder = req.query.sortOrder || 'DESC'
    const search = req.query.search || ''
    const result = queryMusicManagement({ offset, limit, sortBy, sortOrder, search })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.post('/api/admin/music/:id/status', (req, res) => {
  let body = ''
  req.on('data', chunk => body += chunk)
  req.on('end', () => {
    try {
      const id = parseInt(req.params.id)
      const { status } = JSON.parse(body)
      if (!['open', 'hidden', 'locked'].includes(status)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid status' }))
        return
      }
      updateMusicStatus(id, status)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

app.delete('/api/admin/music/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const filename = getMusicFilename(id)
    if (!filename) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }
    const filepath = path.join(MUSIC_DIR, filename)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
    deleteMusicRecord(id)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ success: true }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.get('/api/admin/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0
    const perPage = parseInt(req.query.perPage) || 50
    const search = req.query.search || ''
    const searchQuery = search ? `&q=${encodeURIComponent(`email:*${search}* OR name:*${search}* OR nickname:*${search}*`)}&search_engine=v3` : ''
    const mgmtToken = await getMgmtAccessToken()
    const userRes = await fetch(
      `https://${AUTH0_DOMAIN}/api/v2/users?page=${page}&per_page=${perPage}&include_totals=true${searchQuery}`,
      { headers: { Authorization: `Bearer ${mgmtToken}` } }
    )
    if (!userRes.ok) throw new Error('Failed to fetch users')
    const data = await userRes.json()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ users: data.users, total: data.total }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.post('/api/admin/users/:user_id/block', async (req, res) => {
  try {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { blocked } = JSON.parse(body)
        const mgmtToken = await getMgmtAccessToken()
        const patchRes = await fetch(`https://${AUTH0_DOMAIN}/api/v2/users/${req.params.user_id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${mgmtToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ blocked })
        })
        if (!patchRes.ok) throw new Error('Failed to update user')
        const data = await patchRes.json()
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ success: true, user: data }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.delete('/api/admin/users/:user_id', async (req, res) => {
  try {
    const mgmtToken = await getMgmtAccessToken()
    const delRes = await fetch(`https://${AUTH0_DOMAIN}/api/v2/users/${req.params.user_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${mgmtToken}` }
    })
    if (!delRes.ok) throw new Error('Failed to delete user')
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ success: true }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

app.post('/api/resend-verification', async (req, res) => {
  try {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body)
        if (!email) throw new Error('Email required')

        const mgmtId = serverConfig.auth0_mgmt_client_id
        const mgmtSecret = serverConfig.auth0_mgmt_client_secret
        if (!mgmtId || !mgmtSecret) throw new Error('Management API not configured')

        const domain = serverConfig.auth0_domain
        const tokenRes = await fetch(`https://${domain}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: mgmtId,
            client_secret: mgmtSecret,
            audience: `https://${domain}/api/v2/`,
            grant_type: 'client_credentials'
          })
        })
        const tokenData = await tokenRes.json()
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || 'Failed to get management token')
        }

        const userRes = await fetch(
          `https://${domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        )
        const users = await userRes.json()
        if (!Array.isArray(users) || users.length === 0) throw new Error('User not found')

        const jobRes = await fetch(`https://${domain}/api/v2/jobs/verification-email`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ user_id: users[0].user_id })
        })

        if (jobRes.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } else {
          throw new Error('Failed to send verification email')
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
      }
    })
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
})

app.post('/api/prompt', (req, res) => {
  if (req.method === 'POST') {
    const apiUrl = serverConfig.api_url ? serverConfig.api_url.replace(/^https?:\/\//, '') : TARGET_HOST
    const targetUrl = `https://${apiUrl}/api/prompt`
    const body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
      if (body.length > 0) {
        options.body = Buffer.concat(body)
      }
      fetch(targetUrl, options).then(async response => {
        const bodyData = await response.text()
        res.writeHead(response.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(bodyData)
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      })
    })
  } else {
    res.writeHead(404)
    res.end()
  }
})

app.get('/api/history/:promptId', (req, res) => {
  const promptId = req.params.promptId
  const apiUrl = serverConfig.api_url ? serverConfig.api_url.replace(/^https?:\/\//, '') : TARGET_HOST
  const targetUrl = `https://${apiUrl}/api/history/${promptId}`
  const options = {
    headers: {
      'Authorization': `Bearer ${TOKEN}`
    }
  }
  if (req.headers['range']) {
    options.headers['Range'] = req.headers['range']
  }
  fetch(targetUrl, options).then(async response => {
    const status = response.status
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    if (response.headers.get('Content-Range')) {
      headers['Content-Range'] = response.headers.get('Content-Range')
    }
    const bodyData = await response.text()
    res.writeHead(status, headers)
    res.end(bodyData)
  }).catch(err => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message, code: err.code }))
  })
})

app.use('/stream', (req, res) => {
  const apiUrl = serverConfig.api_url ? serverConfig.api_url.replace(/^https?:\/\//, '') : TARGET_HOST
  const url = `https://${apiUrl}${req.url}`
  const authToken = req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : TOKEN
  const options = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'audio/*, */*'
    }
  }
  if (req.headers['range']) {
    options.headers['Range'] = req.headers['range']
  }

  fetch(url, options).then(response => {
    if (!response.ok && response.status !== 206) {
      res.writeHead(response.status)
      res.end(`Backend error: ${response.status}`)
      return
    }
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
    res.writeHead(response.status === 206 ? 206 : 200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range'
    })
    if (req.method === 'OPTIONS') {
      res.end()
      return
    }
    const reader = response.body.getReader()
    const pump = () => reader.read().then(({ done, value }) => {
      if (done) { res.end(); return }
      if (value) res.write(value)
      pump()
    }).catch(() => res.end())
    pump()
  }).catch(() => {
    res.writeHead(500)
    res.end('Proxy error')
  })
})

app.use('/music-save', (req, res) => {
  if (req.method === 'POST') {
    if (serverConfig.cache_mode !== 'server') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: false, reason: 'browser_cache' }))
      return
    }
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
      try {
        const filename = `music_${Date.now()}_${Math.random().toString(36).substring(7)}.flac`
        const filepath = path.join(MUSIC_DIR, filename)
        fs.writeFileSync(filepath, Buffer.concat(body))
        const musicResult = insertMusicManagement({
          filename,
          userSub: req.auth?.sub,
          genres: req.query.genres,
          vocalType: req.query.vocalType,
          customTags: req.query.customTags,
          customLyrics: req.query.customLyrics,
          duration: req.query.duration ? parseInt(req.query.duration) : null,
          bpm: req.query.bpm ? parseInt(req.query.bpm) : null,
          effect: req.query.effect,
          effectIntensity: req.query.effectIntensity ? parseFloat(req.query.effectIntensity) : null,
          seed: req.query.seed ? parseInt(req.query.seed) : null
        })
        logGeneration({
          userSub: req.auth?.sub,
          genres: req.query.genres,
          vocalType: req.query.vocalType,
          customTags: req.query.customTags,
          customLyrics: req.query.customLyrics,
          duration: req.query.duration ? parseInt(req.query.duration) : null,
          bpm: req.query.bpm ? parseInt(req.query.bpm) : null,
          effect: req.query.effect,
          effectIntensity: req.query.effectIntensity ? parseFloat(req.query.effectIntensity) : null,
          seed: req.query.seed ? parseInt(req.query.seed) : null,
          status: 'success',
          trackId: String(musicResult.id),
          fileName: filename
        })
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ success: true, filename, musicId: musicResult.id }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: err.message }))
      }
    })
  } else {
    res.writeHead(404)
    res.end()
  }
})

app.get('/music-files', (req, res) => {
  if (req.method === 'GET') {
    try {
      const files = fs.readdirSync(MUSIC_DIR)
        .filter(f => f.endsWith('.flac') || f.endsWith('.mp3') || f.endsWith('.wav'))
        .map(f => ({
          name: f,
          url: `http://localhost:${PORT}/music/${f}`
        }))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(files))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else {
    res.writeHead(404)
    res.end()
  }
})

app.use('/music', express.static(MUSIC_DIR))

app.use(express.static(path.join(__dirname, '..', 'public')))

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Music app server running at http://0.0.0.0:${PORT}`)
  console.log(`[Server] Music directory: ${MUSIC_DIR}`)
  console.log(`[Server] Config: cache_mode=${serverConfig.cache_mode}`)
})

process.on('SIGINT', () => {
  console.log('[Server] Shutting down...')
  process.exit(0)
})