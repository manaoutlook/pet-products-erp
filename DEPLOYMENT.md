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
sudo apt install -y curl git nginx

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally
sudo npm install -g pm2
```

## 2. GitHub Configuration

```bash
# Install Git
sudo apt install -y git

# Configure Git
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Set up SSH key for GitHub
ssh-keygen -t ed25519 -C "your.email@example.com"
cat ~/.ssh/id_ed25519.pub
```

Add the SSH key to your GitHub account settings, then clone the repository:

```bash
git clone git@github.com:your-username/pet-products-erp.git
cd pet-products-erp
```

## 3. Application Setup

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `.env` file to include:
```env
PORT=3000
DATABASE_URL=postgresql://username:password@localhost:5432/pet_erp
NODE_ENV=production
```

## 4. Database Backup and Restore

Since pg_dump isn't available in the development environment, we'll use SQL queries to backup and restore the database.

### On Development Server (Replit)
Create a new file `backup_schema.sql`:

```sql
-- Get all table creation commands
SELECT 'CREATE TABLE IF NOT EXISTS ' || schemaname || '.' || tablename || ' (' ||
    array_to_string(
        array_agg(
            column_name || ' ' ||  type || ' '|| CASE 
                WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')'
                ELSE ''
            END || CASE 
                WHEN is_nullable = 'NO' THEN ' NOT NULL'
                ELSE ''
            END
        ), ', '
    ) || ');'
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY schemaname, tablename;

-- Get all table data
SELECT 'INSERT INTO ' || table_schema || '.' || table_name || ' (' ||
    array_to_string(array_agg(column_name), ', ') || ') VALUES ' ||
    string_agg('(' || 
        array_to_string(
            array_agg(
                CASE 
                    WHEN data_type IN ('character varying', 'text', 'timestamp', 'date')
                    THEN '''' || REPLACE(COALESCE(column_default, ''), '''', '''''') || ''''
                    ELSE COALESCE(column_default, '')
                END
            ),
            ', '
        ) || ')',
        ', '
    ) || ';'
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_schema, table_name;
```

Save both schema and data as SQL files through the API endpoints.

### On Production Server

```bash
# Create database
sudo -u postgres psql
CREATE DATABASE pet_erp;
\q

# Restore schema and data
psql -U postgres -d pet_erp -f backup_schema.sql
psql -U postgres -d pet_erp -f backup_data.sql
```

## 5. Nginx and SSL Configuration

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Configure Nginx
sudo nano /etc/nginx/sites-available/pet-erp
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name pet.sourceperfect.net;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and get SSL certificate:

```bash
sudo ln -s /etc/nginx/sites-available/pet-erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d pet.sourceperfect.net
```

## 6. Application Deployment

```bash
# Start the application with PM2
pm2 start npm --name "pet-erp" -- start
pm2 save

# Setup PM2 startup script
pm2 startup
```

## 7. Monitoring and Logs

```bash
# View application logs
pm2 logs pet-erp

# Monitor application
pm2 monit

# View Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Deployment Updates

To update the application:

```bash
# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Rebuild the application
npm run build

# Restart the application
pm2 restart pet-erp