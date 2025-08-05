#!/bin/bash
# Generate RS384 private key and X.509 certificate
openssl genrsa -out privatekey_rs384.pem 2048
openssl req -new -x509 -key privatekey_rs384.pem -out publickey509_rs384.pem -subj '/CN=myapp' -sha384
echo "RS384 keys generated!"
echo "Use publickey509_rs384.pem for Epic upload" 