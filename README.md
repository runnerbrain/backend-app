# Epic FHIR Lab Report Processor

A Node.js application that processes lab reports from Epic's FHIR Bulk Data API and sends formatted HTML reports via email.

## Features

- ✅ Epic FHIR JWT authentication
- ✅ FHIR Bulk Data API integration
- ✅ Lab result categorization (normal vs abnormal)
- ✅ Beautiful HTML report generation
- ✅ Email notification system
- ✅ Patient data linking and processing

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate SSL Keys
You need to generate your own SSL private/public key pair:

```bash
# Generate private key
openssl genrsa -out privatekey.pem 2048

# Generate public certificate
openssl req -new -x509 -key privatekey.pem -out publickey509.pem -subj '/CN=myapp' -sha256
```

### 3. Configure Epic App
1. Create an Epic app in the Epic developer portal
2. Upload your `publickey509.pem` to the app configuration
3. Note your Client ID

### 4. Set Environment Variables
```bash
export EMAIL_USER="your-ethereal-email@ethereal.email"
export EMAIL_PASS="your-ethereal-password"
```

### 5. Update Configuration
Edit `index.js` and update:
- `clientId` with your Epic app Client ID
- Email settings with your preferred email service

## Security Notes

⚠️ **IMPORTANT**: Never commit private keys to Git!
- The `.gitignore` file excludes `*.pem` files
- Keep your `privatekey.pem` secure and local
- Only upload the public certificate to Epic

## Usage

```bash
node index.js
```

This will:
1. Authenticate with Epic using JWT
2. Fetch lab reports via FHIR Bulk Data API
3. Process and categorize results
4. Generate HTML report
5. Send email notification

## Project Structure

```
├── index.js              # Main application
├── scripts/              # Helper scripts
│   ├── 1_manual_keys.sh  # Key generation
│   ├── 2_generate_keys.js # Alternative key generation
│   └── 3_serve_keys.js   # JWKS server (not used)
├── package.json          # Dependencies
├── .gitignore           # Git exclusions
└── README.md            # This file
```

## Authentication Method

This project uses **static X.509 certificates** for Epic authentication rather than dynamic JWKS (JSON Web Key Set). This approach was chosen because:

- More reliable than JWKS with tunneling services
- Simpler setup and maintenance
- Works consistently with Epic's authentication requirements

## License

This project is for educational purposes. 