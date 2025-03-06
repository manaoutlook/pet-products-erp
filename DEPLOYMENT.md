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
- Nginx (already installed)

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

# Install build essentials
sudo apt install -y build-essential

# Install PM2 globally
sudo npm install -g pm2

# Navigate to project directory
cd /var/www/pet-products-erp

# Install required dependencies
npm install drizzle-orm postgres dotenv tsx
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

## Database Migration

### In Development Environment
```bash
# Export current schema and data
cd pet-products-erp  # Make sure you're in the project root
npm run dev

# This will create a database_dump.json file in the project root
npx tsx scripts/db-dump.ts

# Copy necessary files to production server
scp db/schema.ts scripts/db-dump.ts scripts/db-import.ts database_dump.json .env user@your-server:/var/www/pet-products-erp/
```

### In Production Environment
```bash
# Navigate to project directory
cd /var/www/pet-products-erp

# Ensure dependencies are installed
npm install drizzle-orm postgres dotenv tsx

# Make sure environment variables are set correctly in .env file
# DATABASE_URL should point to your production database

# Run the import script
npx tsx scripts/db-import.ts
```

Note: The import script uses Drizzle ORM with TypeScript for better type safety and data integrity during the import process. No separate schema.js file is needed as we import directly from the TypeScript schema file.

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
      PORT: 5001  // Changed from 5000 to avoid conflicts
    }
  }]
}
```

### 3. Configure Nginx for Multiple Applications
Create `/etc/nginx/sites-available/pet-products-erp`:
```nginx
# Add new server block for Pet Products ERP
server {
    listen 80;
    server_name erp.your-domain.com;  # Use a different subdomain

    location / {
        proxy_pass http://localhost:5001;  # Updated port
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

# Enable new nginx configuration
sudo ln -s /etc/nginx/sites-available/pet-products-erp /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# If test passes, reload nginx (safer than restart)
sudo nginx -s reload
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
npx tsx scripts/db-dump.ts "$BACKUP_DIR/backup_$TIMESTAMP.json"' > /usr/local/bin/backup-erp-db.sh

# Make script executable
chmod +x /usr/local/bin/backup-erp-db.sh

# Add to crontab (daily backup at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-erp-db.sh") | crontab -
```

## Troubleshooting

### Common Issues

1. Port Conflicts
```bash
# Check which process is using a specific port
sudo lsof -i :5001
sudo lsof -i :5000  # For Flask app
```

2. Database Connection Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check database logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

3. Application Logs
```bash
# View PM2 logs
pm2 logs pet-products-erp

# View specific error logs
pm2 logs pet-products-erp --err
```

4. Nginx Issues
```bash
# Check nginx configuration
sudo nginx -t

# View nginx error logs
sudo tail -f /var/log/nginx/error.log

# View nginx access logs
sudo tail -f /var/log/nginx/access.log
```

### Reverting Changes (If Needed)
```bash
# Restore nginx configuration
sudo cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf
sudo cp -r /etc/nginx/sites-available.backup/* /etc/nginx/sites-available/

# Reload nginx
sudo nginx -s reload
```

## Security Considerations

1. Firewall Setup
```bash
# Configure UFW (if not already configured)
sudo ufw status
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
```

2. SSL Certificate (using Let's Encrypt)
```bash
# Add new domain to existing certificate
sudo certbot --nginx -d erp.your-domain.com
```

3. Regular Updates
```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Update Node.js packages
npm audit
npm update