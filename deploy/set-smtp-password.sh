#!/usr/bin/env bash
# Stores the mailbox password for e-mail sign-in on the server WITHOUT it ever appearing in chat or shell history.
#   saad-set-smtp            (asks for the password, hidden)
# Then restarts the API and sends a test code to the owner address.
set -euo pipefail
ENVF=/etc/saad-albaqmi/api.env
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
read -r -s -p "كلمة مرور بريد $(grep ^SMTP_USER= $ENVF | cut -d= -f2): " PW; echo
[ -n "$PW" ] || { echo "empty"; exit 1; }
case "$PW" in *$'\n'*|*'#'*|*' '*) echo "avoid spaces and # in the password (or change it in the mail panel)"; exit 1;; esac
if grep -q '^SMTP_PASSWORD=' $ENVF; then sed -i "s#^SMTP_PASSWORD=.*#SMTP_PASSWORD=$PW#" $ENVF; else echo "SMTP_PASSWORD=$PW" >> $ENVF; fi
systemctl restart saad-albaqmi-api; sleep 3
curl -s http://127.0.0.1:3001/api/auth/mode; echo
echo "Done. Open the site, enter your e-mail, and the code should arrive."
