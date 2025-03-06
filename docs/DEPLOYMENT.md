# Deployment Guide - Pet Products Distribution ERP System

## System Requirements

### Hardware Requirements
- CPU: 2+ cores
- RAM: 4GB minimum (8GB recommended)
- Storage: 20GB minimum

### Software Requirements
- Ubuntu 20.04 LTS or newer
- Node.js 20.x
- PostgreSQL 15+
- Git
- PM2 (for process management)
- Nginx (for reverse proxy)

## Pre-deployment Setup

### 1. Install Required Software
```bash
# Update package list
sudo apt update
sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx
sudo apt install -y nginx

# Install PM2
sudo npm install -g pm2

# Install build essentials
sudo apt install -y build-essential
```

### 2. Configure PostgreSQL
```bash
# Switch to postgres user
sudo -i -u postgres

# Create database and user
psql -c "CREATE DATABASE pet_products_erp;"
psql -c "CREATE USER erp_user WITH ENCRYPTED PASSWORD 'your_strong_password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE pet_products_erp TO erp_user;"

# Exit postgres user
exit
```

## GitHub Setup and Deployment

### 1. Repository Setup
```bash
# Create a new repository on GitHub
# Initialize git in your local development environment
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/pet-products-erp.git
git push -u origin main
```

### 2. Environment Variables
Create a `.env` file in the production server:
```env
# Database
DATABASE_URL=postgresql://erp_user:your_strong_password@localhost:5432/pet_products_erp

# Application
NODE_ENV=production
PORT=5000
SESSION_SECRET=your_session_secret_here

# Other configurations
VITE_API_URL=/api
```

### 3. Database Migration

#### Export Development Data
```bash
# In development environment
npm run db:dump > database_dump.sql

# Copy schema and data to production server
scp database_dump.sql user@your-server:/tmp/
```

#### Import Data in Production
```bash
# In production environment
psql -U erp_user -d pet_products_erp -f /tmp/database_dump.sql
```

## Application Deployment

### 1. Clone and Setup
```bash
# Clone repository
git clone https://github.com/yourusername/pet-products-erp.git
cd pet-products-erp

# Install dependencies
npm install

# Build the application
npm run build
```

### 2. Configure PM2
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'pet-products-erp',
    script: 'server/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    }
  }]
}
```

### 3. Configure Nginx
Create `/etc/nginx/sites-available/pet-products-erp`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4. Start Application
```bash
# Start application with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup

# Enable and start Nginx
sudo ln -s /etc/nginx/sites-available/pet-products-erp /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

## Maintenance and Updates

### Updating the Application
```bash
# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Rebuild the application
npm run build

# Restart the application
pm2 restart pet-products-erp
```

### Database Backups
```bash
# Create backup script
echo '#!/bin/bash
BACKUP_DIR="/path/to/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
pg_dump -U erp_user pet_products_erp > "$BACKUP_DIR/backup_$TIMESTAMP.sql"' > /usr/local/bin/backup-erp-db.sh

# Make script executable
chmod +x /usr/local/bin/backup-erp-db.sh

# Add to crontab (daily backup at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-erp-db.sh") | crontab -
```

## Troubleshooting

### Common Issues

1. Database Connection Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check database logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

2. Application Logs
```bash
# View PM2 logs
pm2 logs pet-products-erp

# View specific error logs
pm2 logs pet-products-erp --err
```

3. Nginx Issues
```bash
# Check Nginx status
sudo systemctl status nginx

# Test Nginx configuration
sudo nginx -t

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

## Security Considerations

1. Firewall Setup
```bash
# Configure UFW
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable
```

2. SSL Certificate (using Let's Encrypt)
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com
```

3. Regular Updates
```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Update Node.js packages
npm audit
npm update
```
