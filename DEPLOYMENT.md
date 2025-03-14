# Deployment Guide for Pet Products ERP System

## System Requirements
- Ubuntu Server (20.04 LTS or later)
- Node.js 20.x
- PostgreSQL 15 or later
- Nginx (for reverse proxy)
- PM2 (for process management)

## 1. Initial Server Setup

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git nginx postgresql postgresql-contrib

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Create application directory
sudo mkdir -p /var/www/peterp.sourceperfect.net
sudo chown -R $USER:$USER /var/www/peterp.sourceperfect.net
sudo chmod -R 755 /var/www/peterp.sourceperfect.net
```

## 2. PostgreSQL Setup

```bash
# Start PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql
postgres=# CREATE DATABASE pet_erp;
postgres=# CREATE USER pet_user WITH PASSWORD 'your_secure_password';
postgres=# GRANT ALL PRIVILEGES ON DATABASE pet_erp TO pet_user;
postgres=# \q
```

## 3. GitHub Configuration and Code Deployment

```bash
# Navigate to application directory
cd /var/www/peterp.sourceperfect.net

# Clone the repository
git clone https://github.com/manaoutlook/pet-products-erp.git .

# Install dependencies
npm install

# Create and secure environment file
touch .env
chmod 600 .env
```

Edit `.env` file with the following content:
```env
# Server Configuration
PORT=80
NODE_ENV=production

# Database Configuration (Required for Drizzle ORM)
DATABASE_URL="postgresql://pet_user:your_secure_password@localhost:5432/pet_erp"

# Session Configuration
SESSION_SECRET=`openssl rand -hex 32`  # Run this command to generate a secure secret
REPL_ID=pet-products-erp-prod

# Other Application Settings
LOG_LEVEL=info
API_TIMEOUT=30000
UPLOAD_DIR=/var/www/peterp.sourceperfect.net/uploads

# Create required directories
mkdir -p /var/www/peterp.sourceperfect.net/uploads
chmod 755 /var/www/peterp.sourceperfect.net/uploads
```

## 4. Database Backup Process

Since we're working in a Replit environment where pg_dump isn't available, follow these steps to backup your database:

### On Development Server (Replit)

1. First, let's create the schema backup. Run this in your PostgreSQL console:

```sql
-- Generate CREATE TABLE statements
SELECT 
    'CREATE TABLE IF NOT EXISTS ' || table_schema || '.' || table_name || ' (' ||
    array_to_string(
        array_agg(
            column_name || ' ' || data_type || 
            CASE 
                WHEN character_maximum_length IS NOT NULL 
                THEN '(' || character_maximum_length || ')'
                ELSE ''
            END || 
            CASE 
                WHEN is_nullable = 'NO' THEN ' NOT NULL'
                ELSE ''
            END
        ), 
        ', '
    ) || ');'
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_schema, table_name;
```

2. Save the output as `schema.sql`.

3. Next, generate the data INSERT statements for each table. Run this for each table:

```sql
-- For each table, run:
SELECT 
    'INSERT INTO ' || table_name || ' (' ||
    string_agg(column_name, ', ') || ') SELECT ' ||
    string_agg(
        CASE 
            WHEN data_type IN ('timestamp', 'date') 
                THEN 'COALESCE(' || column_name || '::text, NULL)'
            WHEN data_type = 'boolean'
                THEN 'COALESCE(' || column_name || '::text, false)'
            WHEN data_type IN ('integer', 'numeric', 'bigint')
                THEN 'COALESCE(' || column_name || '::text, 0)'
            ELSE 'COALESCE(' || column_name || '::text, NULL)'
        END,
        ', '
    ) || ' FROM ' || table_name || ';'
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'your_table_name'
GROUP BY table_schema, table_name;
```

4. Save all INSERT statements to `data.sql`.

### On Production Server

1. Create the database and user:

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE pet_erp;
CREATE USER pet_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE pet_erp TO pet_user;
\q

# Test the connection
psql -U pet_user -d pet_erp -c "\conninfo"
```

2. Import the schema and data:

```bash
# Import schema first
psql -U pet_user -d pet_erp -f schema.sql

# Then import data
psql -U pet_user -d pet_erp -f data.sql

# Verify the import
psql -U pet_user -d pet_erp -c "\dt"
psql -U pet_user -d pet_erp -c "SELECT COUNT(*) FROM users;"
```

## 5. Nginx and SSL Configuration

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Configure Nginx
sudo nano /etc/nginx/sites-available/peterp.sourceperfect.net
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name peterp.sourceperfect.net;

    root /var/www/peterp.sourceperfect.net/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

Enable the site and configure SSL:
```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/peterp.sourceperfect.net /etc/nginx/sites-enabled/

# Remove default site if exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Get SSL certificate
sudo certbot --nginx -d peterp.sourceperfect.net

# Test SSL renewal
sudo certbot renew --dry-run

# Restart Nginx
sudo systemctl restart nginx
```

## 6. Application Deployment

```bash
# Build the frontend
npm run build

# Start the application with PM2
pm2 start npm --name "pet-erp" -- start
pm2 save

# Setup PM2 startup script
pm2 startup

# Set up log rotation for PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5

# Verify the application
pm2 list
curl http://localhost:3000
```

## 7. Security Setup

```bash
# Configure UFW firewall
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Verify firewall status
sudo ufw status
```

## 8. Monitoring and Maintenance

```bash
# View application logs
pm2 logs pet-erp

# Monitor application
pm2 monit

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Monitor system resources
sudo apt install -y htop
htop
```

## 9. Automated Backups

Create a backup script:
```bash
# Create backup script
sudo nano /var/www/peterp.sourceperfect.net/backup.sh
```

Add the following content:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/peterp"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database 
cp schema.sql $BACKUP_DIR/schema_$TIMESTAMP.sql
cp data.sql $BACKUP_DIR/data_$TIMESTAMP.sql


# Backup application files
tar -czf $BACKUP_DIR/app_backup_$TIMESTAMP.tar.gz /var/www/peterp.sourceperfect.net

# Keep only last 5 backups
find $BACKUP_DIR -name "schema_*" -type f -mtime +5 -delete
find $BACKUP_DIR -name "data_*" -type f -mtime +5 -delete
find $BACKUP_DIR -name "app_backup_*" -type f -mtime +5 -delete
```

Configure backup automation:
```bash
# Make script executable
chmod +x /var/www/peterp.sourceperfect.net/backup.sh

# Add to crontab (runs daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/peterp.sourceperfect.net/backup.sh") | crontab -
```

## 10. Troubleshooting

Common issues and solutions:

1. If the application doesn't start:
   - Check PM2 logs: `pm2 logs pet-erp`
   - Verify environment variables: `pm2 env pet-erp`
   - Check Node.js version: `node --version`

2. If database connection fails:
   - Verify PostgreSQL is running: `sudo systemctl status postgresql`
   - Check database credentials: `psql -U pet_user -d pet_erp -c "\conninfo"`
   - Verify DATABASE_URL in .env

3. If SSL certificate renewal fails:
   - Check certbot logs: `sudo certbot certificates`
   - Manually trigger renewal: `sudo certbot renew --force-renewal`

4. If Nginx shows 502 Bad Gateway:
   - Check if application is running: `pm2 list`
   - Verify Nginx configuration: `sudo nginx -t`
   - Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`