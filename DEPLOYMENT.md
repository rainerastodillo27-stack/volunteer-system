# Deployment Guide

This guide explains how to deploy your Volcre backend to a cloud server.

## Quick Start

### 1. Create Deployment Bundle (Local Machine)

Run the deployment bundle script:

```powershell
.\scripts\create-deployment-bundle.ps1
```

This creates a `backend-deploy-[timestamp].tar.gz` file containing:
- `backend/` folder with all FastAPI code
- `.env` configuration
- `requirements.txt` Python dependencies
- Documentation

The script will output the bundle path and size.

### 2. Upload to Cloud Server

Upload the bundle using SCP:

```bash
scp backend-deploy-*.tar.gz your-user@your-instance.com:/path/to/app/
```

Or use SFTP/cloud provider's file upload interface.

### 3. Extract and Setup on Server

SSH into your server:

```bash
ssh your-user@your-instance.com
cd /path/to/app
tar -xzf backend-deploy-*.tar.gz
```

### 4. Install Python Dependencies

```bash
python3 -m pip install -r requirements.txt
```

Or if using a virtual environment:

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 5. Configure Environment

Edit the `.env` file on the server:

```bash
nano .env
```

Key variables to configure:

```env
# Database (required)
SUPABASE_DB_URL=postgresql://user:password@host:port/database

# API binding
ALLOWED_ORIGINS=https://your-frontend-url.com

# Security
DB_STRICT_POSTGRES=true
VOLCRE_PROTECT_SHARED_DB=false  # Only if not sharing database
```

Save and exit (Ctrl+X, Y, Enter in nano).

### 6. Start the API Server

Using Uvicorn directly:

```bash
python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000
```

Or use a process manager for production (Gunicorn + Uvicorn):

```bash
pip install gunicorn
gunicorn -w 4 -k uvicorn.workers.UvicornWorker backend.api:app --bind 0.0.0.0:8000
```

Or use PM2 (Node.js-based process manager):

```bash
npm install -g pm2
pm2 start "python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000" --name "volcre-api"
pm2 save
pm2 startup
```

### 7. Enable HTTPS (Recommended for Production)

Option A: Using Nginx as reverse proxy:

```bash
# Install Nginx
sudo apt-get install nginx

# Create Nginx config at /etc/nginx/sites-available/volcre
sudo nano /etc/nginx/sites-available/volcre
```

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_upgrade_connections on;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/volcre /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Option B: Using Certbot for free SSL/TLS:

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 8. Update Client Configuration

On your local development machine, update `.env`:

```env
VOLCRE_API_BASE_URL=https://your-instance.com
VOLCRE_WEB_API_BASE_URL=https://your-instance.com
VOLCRE_AUTO_START_BACKEND=false
```

Restart Expo:

```powershell
npm run start
```

## Troubleshooting

### Connection refused on port 8000

The API server isn't running. Check if it's still running:

```bash
lsof -i :8000  # On Linux/Mac
netstat -an | findstr :8000  # On Windows
```

Restart if needed:

```bash
pm2 restart volcre-api
```

### 502 Bad Gateway (Nginx)

Backend might be down or Nginx can't reach it. Check:

```bash
# Is API running?
ps aux | grep uvicorn

# Can you reach it locally?
curl http://127.0.0.1:8000/health
```

### Database connection errors

Check environment variables:

```bash
echo $SUPABASE_DB_URL
```

Test connection:

```bash
python -c "from backend.db import get_postgres_connection; conn = get_postgres_connection(); print('✓ Connected')"
```

## Monitoring

### Check API status

```bash
curl https://your-instance.com/health
```

### View API logs

```bash
# If using PM2
pm2 logs volcre-api

# If running directly
tail -f /var/log/volcre-api.log
```

### Monitor server resources

```bash
top  # CPU and memory usage
df -h  # Disk space
htop  # Interactive process monitor
```

## Updating Deployment

When you make changes locally:

1. Create new bundle: `.\scripts\create-deployment-bundle.ps1`
2. Upload to server
3. Stop old API: `pm2 stop volcre-api`
4. Extract bundle: `tar -xzf backend-deploy-*.tar.gz`
5. Install dependencies: `pip install -r requirements.txt`
6. Restart API: `pm2 start volcre-api`

Or use a simple update script:

```bash
#!/bin/bash
# deploy.sh on server

pkill -f "uvicorn backend.api"
sleep 2
tar -xzf backend-deploy-*.tar.gz
pip install -r requirements.txt
python -m uvicorn backend.api:app --host 0.0.0.0 --port 8000 &
echo "✓ Deployment complete"
```

## Production Checklist

- [ ] Database URL configured and tested
- [ ] HTTPS/SSL certificate installed
- [ ] Nginx or reverse proxy configured
- [ ] Process manager (PM2/Supervisor) configured for auto-restart
- [ ] Firewall rules allow port 443 (HTTPS) and 80 (HTTP)
- [ ] Backups configured for database
- [ ] Monitoring/alerting set up
- [ ] Client `.env` updated with server URL
- [ ] Health check endpoint accessible
- [ ] Logs are being written and monitored

## Questions?

Check the README.md in the bundle or the main project repository for more information.
