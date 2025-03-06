# Environment Variables Checklist for Production Deployment

## Required Environment Variables

### Database Configuration
- [ ] `DATABASE_URL`: PostgreSQL connection string
  - Format: `postgresql://user:password@host:port/database`
  - Example: `postgresql://erp_user:your_password@localhost:5432/pet_products_erp`

### Session Configuration
- [ ] `SESSION_SECRET`: Secret key for session management
  - Must be a strong random string
  - Minimum 32 characters recommended

### Server Configuration
- [ ] `NODE_ENV`: Set to 'production' in production environment
- [ ] `PORT`: Application port (default: 5000)

## Optional Environment Variables

### Logging Configuration
- [ ] `LOG_LEVEL`: Logging level (default: 'info')
  - Options: 'debug', 'info', 'warn', 'error'

### Security Configuration
- [ ] `CORS_ORIGIN`: Allowed CORS origins
  - Format: comma-separated URLs
  - Example: `https://your-domain.com,https://api.your-domain.com`

## Steps to Configure

1. Create a `.env` file in the production server
2. Copy the above variables and set appropriate values
3. Ensure the file has restricted permissions:
   ```bash
   chmod 600 .env
   ```
4. Verify all required variables are set before starting the application

## Security Notes

- Never commit `.env` file to version control
- Use different values for development and production
- Regularly rotate sensitive credentials
- Keep backups of the configuration in a secure location
