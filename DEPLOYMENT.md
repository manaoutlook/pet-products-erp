# Deployment Guide for Pet Products Distribution ERP

This guide provides step-by-step instructions for deploying the Pet Products Distribution ERP system on an Ubuntu server.

## System Requirements

- Ubuntu 22.04 LTS or newer
- Minimum 2GB RAM
- 20GB storage
- Root or sudo access

## Prerequisites Installation

1. Update system packages:
```bash
sudo apt update
sudo apt upgrade -y
```

2. Install Node.js and npm:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

3. Install PostgreSQL:
```bash
sudo apt install -y postgresql postgresql-contrib
```

4. Install required build tools:
```bash
sudo apt install -y build-essential python3-pip
```

## Project Setup

1. Create application directory:
```bash
sudo mkdir -p /var/www/pet-erp
sudo chown -R $USER:$USER /var/www/pet-erp
```

2. Clone the repository:
```bash
cd /var/www/pet-erp
git clone [repository-url] .
```

3. Install project dependencies:
```bash
npm install
```

## Database Configuration

1. Create a new PostgreSQL user and database:
```bash
sudo -u postgres psql

CREATE USER pet_erp WITH PASSWORD 'your_secure_password';
CREATE DATABASE pet_erp_db OWNER pet_erp;
\q
```

2. Configure database connection:
Create a `.env` file in the project root:
```bash
DATABASE_URL="postgresql://pet_erp:your_secure_password@localhost:5432/pet_erp_db"
```

3. Run database migrations:
```bash
npm run db:push
```

## Environment Setup

1. Install PM2 for process management:
```bash
sudo npm install -g pm2
```

2. Build the application:
```bash
npm run build
```

## Application Deployment

1. Start the application with PM2:
```bash
pm2 start dist/index.js --name pet-erp
```

2. Configure PM2 startup script:
```bash
pm2 startup
pm2 save
```

## Nginx Server Configuration

1. Install Nginx:
```bash
sudo apt install -y nginx
```

2. Create Nginx configuration:
```bash
sudo nano /etc/nginx/sites-available/pet-erp
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your_domain.com;

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

3. Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/pet-erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## SSL Configuration (Optional but Recommended)

1. Install Certbot:
```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

2. Obtain SSL certificate:
```bash
sudo certbot --nginx -d your_domain.com
```

## Security Considerations

1. Configure UFW firewall:
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

2. Set up fail2ban (optional):
```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Monitoring and Maintenance

1. Monitor application logs:
```bash
pm2 logs pet-erp
```

2. Monitor system resources:
```bash
pm2 monit
```

3. Regular updates:
```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Update application
git pull
npm install
npm run build
pm2 restart pet-erp
```

## Troubleshooting

1. Check application status:
```bash
pm2 status
```

2. View Nginx error logs:
```bash
sudo tail -f /var/log/nginx/error.log
```

3. Check PostgreSQL status:
```bash
sudo systemctl status postgresql
```

## Backup Procedures

1. Database backup:
```bash
pg_dump -U pet_erp pet_erp_db > backup.sql
```

2. Restore database:
```bash
psql -U pet_erp pet_erp_db < backup.sql
```

## Support

For any deployment issues or questions, please refer to:
- Project documentation
- System logs
- Contact system administrator

Remember to replace placeholders:
- `your_secure_password` with a strong password
- `your_domain.com` with your actual domain name
- `[repository-url]` with your Git repository URL
