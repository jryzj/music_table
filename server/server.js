import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

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

function loadCredentials() {
  try {
    const credPath = path.join(__dirname, 'credentials.json')
    const credData = fs.readFileSync(credPath, 'utf8')
    return JSON.parse(credData)
  } catch (err) {
    return {}
  }
}

function authenticate(req) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Basic ')) return false
  const base64 = authHeader.slice(6)
  const decoded = Buffer.from(base64, 'utf8').toString()
  const [username, password] = decoded.split(':')
  const credentials = loadCredentials()
  return credentials[username] === password
}

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true })
  console.log(`[Server] Created music directory: ${MUSIC_DIR}`)
}

const app = express()
app.use(cors())

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

app.post('/api/login', (req, res) => {
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization || ''
    const base64 = authHeader.startsWith('Basic ')
      ? authHeader.slice(6)
      : Buffer.from(authHeader).toString('base64')
    const decoded = Buffer.from(base64, 'base64').toString('utf8')
    const [username, password] = decoded.split(':')
    const credentials = loadCredentials()
    if (credentials[username] === password) {
      const token = crypto.randomBytes(32).toString('hex')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: true, token }))
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify({ success: false }))
    }
  } else {
    res.writeHead(404)
    res.end()
  }
})

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
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ available: true }))
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
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ success: true, filename }))
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