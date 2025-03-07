
# Pet Products ERP - Ubuntu VM Deployment Guide

This guide provides step-by-step instructions for deploying the Pet Products ERP system on an Ubuntu Virtual Machine that already has another application running (Python Flask).

## Prerequisites

- Ubuntu Virtual Machine (already running)
- Node.js 18+ and npm (will be installed in the steps below)
- PostgreSQL 14+ (will be installed in the steps below)
- Git (for cloning the repository)

## 1. Update System Packages

```bash
sudo apt update
sudo apt upgrade -y
```

## 2. Install Node.js and npm

Check if Node.js is already installed:
```bash
node -v
npm -v
```

If not installed or version is below 18, install Node.js 18:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Install PostgreSQL

Check if PostgreSQL is already installed:
```bash
psql --version
```

If not installed or if you need a newer version:
```bash
sudo apt install -y postgresql postgresql-contrib
```

Start PostgreSQL service:
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## 4. Set Up PostgreSQL Database

```bash
# Connect to PostgreSQL as postgres user
sudo -u postgres psql

# Create a new database and user (in PostgreSQL prompt)
CREATE DATABASE petproductserp;
CREATE USER erpuser WITH PASSWORD 'securepassword';
GRANT ALL PRIVILEGES ON DATABASE petproductserp TO erpuser;

# Exit PostgreSQL
\q
```

## 5. Clone the Repository

```bash
cd /opt
sudo mkdir pet-products-erp
sudo chown $USER:$USER pet-products-erp
cd pet-products-erp
git clone https://github.com/YOUR_USERNAME/pet-products-erp.git .
```

## 6. Install Dependencies

```bash
npm install
```

## 7. Set Up Environment Variables

Create a `.env` file in the project root:
```bash
touch .env
```

Add the following environment variables:
```
DATABASE_URL=postgres://erpuser:securepassword@localhost:5432/petproductserp
SESSION_SECRET=your_secure_session_secret
PORT=5000
NODE_ENV=production
```

## 8. Build the Application

```bash
npm run build
```

## 9. Configure Application to Run on Different Port

Since there's already a Flask application running, make sure this application uses a different port by configuring it in the `.env` file (already done in step 7 with PORT=5000).

## 10. Set Up PM2 Process Manager

Install PM2 globally:
```bash
sudo npm install -g pm2
```

Create a PM2 configuration file (ecosystem.config.js):
```bash
touch ecosystem.config.js
```

Add the following content:
```javascript
module.exports = {
  apps: [{
    name: "pet-products-erp",
    script: "npm",
    args: "run start",
    env: {
      NODE_ENV: "production",
    },
    watch: false
  }]
};
```

## 11. Start the Application with PM2

```bash
pm2 start ecosystem.config.js
```

Set PM2 to start on system boot:
```bash
pm2 startup
pm2 save
```

## 12. Set Up Nginx as a Reverse Proxy (Optional)

If you want to serve your application on a domain or subdomain:

Install Nginx:
```bash
sudo apt install -y nginx
```

Create a new Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/pet-products-erp
```

Add the following configuration:
```
server {
    listen 80;
    server_name your-domain.com; # Replace with your domain or server IP

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

Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/pet-products-erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 13. Firewall Configuration (if enabled)

If UFW is enabled, allow the necessary ports:
```bash
sudo ufw allow 5000/tcp
sudo ufw allow 'Nginx Full'
```

## 14. Verify Deployment

Open your browser and navigate to:
- http://your-server-ip:5000 (if accessing directly)
- http://your-domain.com (if using Nginx)

## Troubleshooting

### Logs
- Check application logs: `pm2 logs pet-products-erp`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`

### Common Issues
- Port conflicts: Ensure the port is not being used by another application
- Database connection issues: Verify PostgreSQL is running and credentials are correct
- Permission issues: Check file permissions for the application directory

## Updates and Maintenance

To update the application:
```bash
cd /opt/pet-products-erp
git pull
npm install
npm run build
pm2 restart pet-products-erp
```
