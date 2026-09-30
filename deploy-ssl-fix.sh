#!/bin/bash
# ══════════════════════════════════════════════════════════════════
# Whatomate – SSL Fix & Deploy Script
# Fixes: ECDSA/ISRG Root X2 trust issue on desktop browsers
# Run this on the production server as root
# ══════════════════════════════════════════════════════════════════
set -e

DOMAIN="whatomatestack.duckdns.org"
NGINX_CONF="/root/whatomate/w1/nginx-whatomate.conf"
NGINX_DEST="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo "════════════════════════════════════════════════"
echo "  Whatomate SSL Fix & Deploy"
echo "════════════════════════════════════════════════"

# ── Step 1: Install certbot if not present ───────────────────────
echo ""
echo "[1/6] Checking certbot..."
if ! command -v certbot &> /dev/null; then
    echo "  → Installing certbot..."
    apt-get update -qq && apt-get install -y certbot python3-certbot-nginx
else
    echo "  → certbot already installed ✓"
fi

# ── Step 2: Stop nginx to free port 80 ──────────────────────────
echo ""
echo "[2/6] Stopping Nginx temporarily..."
systemctl stop nginx 2>/dev/null || true
echo "  → Nginx stopped ✓"

# ── Step 3: Get RSA certificate (fixes desktop browser trust) ────
echo ""
echo "[3/6] Obtaining RSA certificate (fixes desktop browser trust)..."
echo "  → Current cert uses ECDSA/ISRG Root X2 (not trusted by some desktop browsers)"
echo "  → Getting RSA cert with ISRG Root X1 chain (universally trusted)..."

# Revoke old ECDSA cert if it exists (optional, ignore errors)
certbot revoke --cert-name ${DOMAIN} --non-interactive --no-delete-after-revoke 2>/dev/null || true

# Delete old cert to start fresh
certbot delete --cert-name ${DOMAIN} --non-interactive 2>/dev/null || true

# Get a new certificate forcing RSA key type and preferred chain
# --key-type rsa: Use RSA instead of ECDSA
# --preferred-chain "ISRG Root X1": Use the universally trusted chain
certbot certonly --standalone \
    -d ${DOMAIN} \
    --non-interactive \
    --agree-tos \
    --email admin@whatomatestack.duckdns.org \
    --key-type rsa \
    --rsa-key-size 2048 \
    --preferred-chain "ISRG Root X1" \
    --force-renewal

echo "  → RSA certificate obtained ✓"

# Verify the new cert is RSA
echo ""
echo "  New certificate info:"
openssl x509 -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem -noout -subject -dates -text 2>/dev/null | grep -E 'subject=|notBefore|notAfter|Public Key Algorithm' | head -4 | sed 's/^/    /'

# ── Step 4: Remove old/conflicting nginx configs ─────────────────
echo ""
echo "[4/6] Deploying Nginx configuration..."

# Remove old configs
rm -f /etc/nginx/sites-enabled/default 2>/dev/null
rm -f /etc/nginx/sites-enabled/whatomate 2>/dev/null
rm -f /etc/nginx/sites-enabled/${DOMAIN} 2>/dev/null
rm -f /etc/nginx/sites-available/whatomate 2>/dev/null
rm -f /etc/nginx/sites-available/${DOMAIN} 2>/dev/null

# Deploy new config
cp "${NGINX_CONF}" "${NGINX_DEST}"
ln -sf "${NGINX_DEST}" "${NGINX_ENABLED}"
echo "  → Config deployed ✓"

# ── Step 5: Test and start Nginx ─────────────────────────────────
echo ""
echo "[5/6] Testing and starting Nginx..."
nginx -t
if [ $? -eq 0 ]; then
    systemctl start nginx
    echo "  → Nginx started successfully ✓"
else
    echo "  ✗ Nginx config test FAILED!"
    echo "  Fix the errors above before starting."
    exit 1
fi

# ── Step 6: Setup auto-renewal cron ──────────────────────────────
echo ""
echo "[6/6] Setting up auto-renewal..."
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --preferred-chain 'ISRG Root X1' --post-hook 'systemctl reload nginx'") | crontab -
    echo "  → Auto-renewal cron added (3 AM daily) ✓"
else
    echo "  → Auto-renewal cron already exists ✓"
fi

# ── Final verification ───────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════"
echo "  Verifying SSL..."
echo "════════════════════════════════════════════════"
sleep 2

# Test HTTPS
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://${DOMAIN}/ 2>/dev/null || echo "FAIL")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
    echo "  ✓ HTTPS is working! (HTTP ${HTTP_CODE})"
else
    echo "  ⚠ Got HTTP ${HTTP_CODE} — site may still be starting up"
fi

# Show cert chain
echo ""
echo "  Certificate chain:"
echo | openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} 2>/dev/null | grep -E '^\s+[0-9]+ s:' | sed 's/^/    /'

echo ""
echo "════════════════════════════════════════════════"
echo "  ✓ DONE! Test your site at:"
echo "    https://${DOMAIN}"
echo ""
echo "  IMPORTANT: Clear your browser cache or test"
echo "  in an incognito/private window first!"
echo "════════════════════════════════════════════════"
