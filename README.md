# Curtin Canvas Course Timeline

A live dashboard that pulls course data from the Canvas LMS API and displays an interactive Gantt-style timeline.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your Canvas API token:

```
CANVAS_URL=https://curtin.instructure.com
CANVAS_TOKEN=your_token_here
ACCOUNT_IDS=229,121,123,114,224,226
CACHE_MINUTES=15
PORT=3000
```

**To generate a token:** In Canvas, go to Account → Settings → + New Access Token.

### 3. Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

- The server fetches courses from all configured Canvas accounts via the REST API
- Results are cached in memory (default 15 minutes) to avoid hammering the API
- The frontend auto-filters out sandbox/test/template courses
- Click "↻ Refresh now" to force a fresh pull
- The `/api/courses` endpoint returns raw JSON if you need it elsewhere

## Deployment Options

### Render (free tier)

1. Push to a GitHub repo
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo
4. Set environment variables (CANVAS_TOKEN, etc.)
5. Deploy — it'll give you a public URL

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t canvas-timeline .
docker run -p 3000:3000 --env-file .env canvas-timeline
```

### University server (PM2)

```bash
npm install -g pm2
pm2 start server.js --name canvas-timeline
pm2 save
pm2 startup
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Timeline dashboard |
| `GET /api/courses` | JSON array of all courses |
| `GET /api/refresh` | Force cache refresh |

## Security Notes

- The Canvas API token is stored server-side only — never sent to the browser
- The token should have the minimum permissions needed (read-only account access)
- Consider restricting access to the app via your university's SSO or VPN
- Rotate the token periodically (Canvas → Settings → Approved Integrations)
