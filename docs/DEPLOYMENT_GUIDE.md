# POS System Deployment Guide

## Overview
This guide provides comprehensive instructions for deploying the Point of Sale (POS) system to production environments.

## Prerequisites

### System Requirements
- **Node.js**: 18.x or higher
- **PostgreSQL**: 14.x or higher
- **Redis**: 6.x or higher (for session storage)
- **Nginx**: Latest stable version (for reverse proxy)
- **SSL Certificate**: Valid for production domains

### Infrastructure Requirements
- **Application Server**: 2 vCPUs, 4GB RAM minimum
- **Database Server**: 2 vCPUs, 8GB RAM minimum
- **Load Balancer**: Nginx or AWS ALB
- **Monitoring**: Prometheus + Grafana stack

## Environment Configuration

### Environment Variables
Create a `.env.production` file with the following variables:

```bash
# Database Configuration
DATABASE_URL=postgresql://pos_user:secure_password@db-host:5432/pet_products_pos
DB_SSL=true
DB_MAX_CONNECTIONS=20

# Application Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Security Configuration
JWT_SECRET=your-super-secure-jwt-secret-here
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12

# Session Configuration
SESSION_SECRET=your-session-secret-here
SESSION_MAX_AGE=86400000

# External Services
REDIS_URL=redis://redis-host:6379
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# File Storage (if needed)
AWS_S3_BUCKET=your-pos-bucket
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

### Database Setup

#### 1. Create Database User
```sql
CREATE USER pos_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE pet_products_pos TO pos_user;
```

#### 2. Database Configuration
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set proper permissions
GRANT USAGE ON SCHEMA public TO pos_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pos_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pos_user;

-- Configure connection limits
ALTER USER pos_user CONNECTION LIMIT 20;
```

#### 3. Run Migrations
```bash
# Apply database migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

## Application Deployment

### Docker Deployment (Recommended)

#### Dockerfile
```dockerfile
FROM node:18-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY drizzle.config.ts ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Build application
RUN npm run build

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S posapp -u 1001

# Set proper permissions
RUN chown -R posapp:nodejs /app
USER posapp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start application
CMD ["npm", "start"]
```

#### Docker Compose Configuration
```yaml
version: '3.8'

services:
  pos-app:
    build: .
    container_name: pet-products-pos
    environment:
      - DATABASE_URL=postgresql://pos_user:secure_password@postgres:5432/pet_products_pos
      - NODE_ENV=production
      - PORT=3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - pos-network

  postgres:
    image: postgres:15-alpine
    container_name: pos-postgres
    environment:
      - POSTGRES_DB=pet_products_pos
      - POSTGRES_USER=pos_user
      - POSTGRES_PASSWORD=secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql
    ports:
      - "5432:5432"
    restart: unless-stopped
    networks:
      - pos-network

  redis:
    image: redis:7-alpine
    container_name: pos-redis
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped
    networks:
      - pos-network

  nginx:
    image: nginx:alpine
    container_name: pos-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl/certs
    depends_on:
      - pos-app
    restart: unless-stopped
    networks:
      - pos-network

volumes:
  postgres_data:
  redis_data:

networks:
  pos-network:
    driver: bridge
```

### Manual Deployment

#### 1. Install Dependencies
```bash
npm ci --only=production
npm run build
```

#### 2. Configure Process Manager (PM2)
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'pet-products-pos',
    script: 'dist/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
```

#### 3. Start Application
```bash
# Using PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# Or using Node directly
NODE_ENV=production npm start
```

## Nginx Configuration

### nginx.conf
```nginx
upstream pos_app {
    server localhost:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Static files
    location /assets/ {
        alias /var/www/pos/public/assets/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API endpoints
    location /api/ {
        proxy_pass http://pos_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Rate limiting
        limit_req zone=api burst=10 nodelay;
        limit_req_status 429;
    }

    # Main application
    location / {
        proxy_pass http://pos_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
```

## Monitoring Setup

### Application Monitoring
```bash
# Install monitoring dependencies
npm install --save-dev @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node

# Configure monitoring
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const sdk = new NodeSDK({
  serviceName: 'pet-products-pos',
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### Database Monitoring
```sql
-- Create monitoring user
CREATE USER monitor WITH PASSWORD 'monitor_password';
GRANT pg_monitor TO monitor;

-- Key monitoring queries
SELECT * FROM pg_stat_activity;
SELECT * FROM pg_stat_database;
SELECT * FROM pg_stat_user_tables;
```

### Log Aggregation
```javascript
// Winston logger configuration
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'pos-system' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});
```

## Backup Strategy

### Database Backup
```bash
#!/bin/bash
# Daily database backup script

BACKUP_DIR="/var/backups/pos"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/pos_backup_$DATE.sql"

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Perform backup
pg_dump -h localhost -U pos_user -d pet_products_pos -f $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Keep only last 30 days of backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

# Send notification (optional)
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"POS Database backup completed"}' \
  YOUR_SLACK_WEBHOOK_URL
```

### Application Backup
```bash
#!/bin/bash
# Application backup script

APP_DIR="/var/www/pos"
BACKUP_DIR="/var/backups/pos/app"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup application files
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz -C $APP_DIR .

# Backup logs
tar -czf $BACKUP_DIR/logs_backup_$DATE.tar.gz -C /var/log/pos .

# Clean old backups
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
```

## Scaling Considerations

### Horizontal Scaling
```javascript
// Cluster configuration for PM2
module.exports = {
  apps: [{
    name: 'pos-app',
    script: 'dist/index.js',
    instances: 'max', // CPU core count
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Load balancing
    listen_timeout: 3000,
    kill_timeout: 5000,
    // Health checks
    health_check: {
      enabled: true,
      max_memory_restart: '1G'
    }
  }]
};
```

### Database Scaling
```sql
-- Read replica configuration
-- Create publication for logical replication
CREATE PUBLICATION pos_publication FOR ALL TABLES;

-- On replica server
CREATE SUBSCRIPTION pos_subscription
  CONNECTION 'host=primary-server port=5432 user=replica_user dbname=pet_products_pos'
  PUBLICATION pos_publication;
```

## Performance Optimization

### Database Optimization
```sql
-- Create indexes for POS performance
CREATE INDEX CONCURRENTLY idx_sales_transactions_store_date
  ON sales_transactions(store_id, transaction_date);

CREATE INDEX CONCURRENTLY idx_sales_transaction_items_product
  ON sales_transaction_items(product_id);

CREATE INDEX CONCURRENTLY idx_inventory_store_product
  ON inventory(store_id, product_id);

-- Analyze tables for query optimization
ANALYZE sales_transactions;
ANALYZE sales_transaction_items;
ANALYZE inventory;
```

### Application Optimization
```javascript
// Enable gzip compression
const compression = require('compression');
app.use(compression());

// Cache static assets
app.use(express.static('public', {
  maxAge: '1y',
  etag: false
}));

// Database connection pooling
const { Pool } = require('pg');
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

## Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check database connectivity
psql -h localhost -U pos_user -d pet_products_pos -c "SELECT 1;"

# Check connection pool
psql -h localhost -U pos_user -d pet_products_pos -c "SELECT * FROM pg_stat_activity;"
```

#### Application Performance Issues
```bash
# Check memory usage
pm2 monit

# Check logs
pm2 logs pos-app --lines 100

# Restart application
pm2 restart pos-app
```

#### SSL Certificate Issues
```bash
# Test SSL certificate
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Check certificate expiration
openssl x509 -in /etc/ssl/certs/fullchain.pem -text -noout | grep "Not After"
```

## Rollback Procedures

### Application Rollback
```bash
# Using PM2
pm2 stop pos-app
pm2 delete pos-app

# Restore from backup
cp /var/backups/app/app_backup_20241201.tar.gz /var/www/
cd /var/www && tar -xzf app_backup_20241201.tar.gz

# Restart application
pm2 start ecosystem.config.js --env production
```

### Database Rollback
```bash
# Stop application first
pm2 stop pos-app

# Restore database from backup
gunzip /var/backups/db/pos_backup_20241201.sql.gz
psql -h localhost -U pos_user -d pet_products_pos < /var/backups/db/pos_backup_20241201.sql

# Restart application
pm2 start pos-app
```

## Maintenance Procedures

### Regular Maintenance Tasks
```bash
# Weekly tasks
# 1. Update dependencies
npm audit fix
npm update

# 2. Rotate logs
logrotate /etc/logrotate.d/pos

# 3. Clean old sessions
# (Implement session cleanup logic)

# Monthly tasks
# 1. Security updates
apt update && apt upgrade

# 2. Database maintenance
VACUUM ANALYZE;

# 3. Backup verification
# Test backup restoration in staging environment
```

### Monitoring Dashboards
- **Application metrics**: Response times, error rates, throughput
- **Database metrics**: Connection count, slow queries, disk usage
- **System metrics**: CPU, memory, disk I/O
- **Business metrics**: Daily sales, transaction volume, inventory levels

## Support and Contact

### Emergency Contacts
- **Technical Lead**: [Name] - [Email] - [Phone]
- **Database Administrator**: [Name] - [Email] - [Phone]
- **Security Officer**: [Name] - [Email] - [Phone]

### Documentation Links
- [API Documentation](./api-docs.md)
- [User Manual](./user-manual.md)
- [Troubleshooting Guide](./troubleshooting.md)

---

**Deployment Date**: [Date]
**Version**: 1.0.0
**Last Updated**: December 10, 2025
