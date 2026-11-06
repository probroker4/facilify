# Put Facilify online (Oracle Cloud Always Free server)

This gives you a permanent `https://` address for judges, with every feature working: accounts, uploads, certificates,
Google Drive, Gmail sending, SMTP, tickets and the verify pages. Allow about 45 minutes the first time.

You will do steps 1-5 in your browser and terminal. Step 6 onward is quick.

## 1. Create the Oracle Cloud account
Go to <https://www.oracle.com/cloud/free/> and sign up. A credit or debit card is needed to verify who you are; the
"Always Free" resources below are not charged. Choose a **home region close to you**, because you cannot change it later.

## 2. Create the server
Compute > Instances > **Create instance**.
- **Image:** Canonical Ubuntu 24.04 (22.04 also works).
- **Shape:** Ampere **VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory. (Always Free allows up to 4 OCPUs / 24 GB in total.)
  If Oracle says *Out of capacity*, try again later or in another availability domain, or choose the AMD
  **VM.Standard.E2.1.Micro** (1 GB). The micro works too, but the first build takes longer.
- **Networking:** keep the default network and make sure **Assign a public IPv4 address** is on.
- **SSH keys:** choose *Generate a key pair* and **download the private key** (a `.key` file). Keep it safe.

Write down the instance's **Public IP address** when it is running.

## 3. Open the web ports in Oracle's cloud firewall
Instance details > the **Subnet** link > the **Security List** > **Add Ingress Rules**. Add two rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(The setup script opens the server's own firewall. Both layers must be open or the site will not load.)

## 4. Make the upload package (on your computer)
From the `hackathon` folder:
```bash
bash deploy/pack.sh
```
This creates `facilify-deploy.tar.gz` (source code only, no secrets or data).

## 5. Upload and run the installer
Replace `KEYFILE` with the downloaded key and `IP` with the server's public IP (the login name is `ubuntu`):
```bash
chmod 600 KEYFILE
scp -i KEYFILE facilify-deploy.tar.gz deploy/bootstrap.sh ubuntu@IP:~
ssh -i KEYFILE ubuntu@IP
sudo bash bootstrap.sh
```
It installs Node, builds the app, sets up automatic HTTPS and starts Facilify. When it finishes it prints the address,
which looks like `https://132-145-10-20.sslip.io`. It also tells you whether SMTP sending (port 587) works from this server.

To use your own name instead, create a free one at <https://www.duckdns.org>, point it at the server IP, and run
`sudo bash bootstrap.sh yourname.duckdns.org`.

## 6. Sign in with Google
Facilify has no passwords: you and the judges sign in with Google, and that same sign-in gives Facilify permission to send
from Gmail and save to Drive. This needs step 8 (Google keys) done first, so do step 8, then open the address and press
**Sign in with Google**.

The installer turns on *open sign-in*, so any Google account can sign in and gets its own private workspace (its own
batches, settings and Drive). To allow only certain people instead, edit `/etc/facilify.env`, delete the
`CERTFLOW_OPEN_SIGNIN=1` line, list their addresses in `ORGANIZER_EMAILS`, then `sudo systemctl restart facilify`.

## 7. Check the basics
1. Run the sample sheet (Home > *Download a sample sheet*) through the wizard with the **Test outbox** sender. The files
   land in `/var/lib/facilify/outbox` on the server.
2. In Settings choose a real sender (step 8) and send a test message to yourself.

## 8. Turn on Gmail and Google Drive
1. In <https://console.cloud.google.com> create a project and enable the **Gmail API** and **Google Drive API**.
2. APIs & Services > OAuth consent screen (now called *Audience*): type *External*. While it says **Testing**, only
   accounts listed under **Test users** can sign in (max 100, and logins expire after 7 days). For judges, press
   **Publish app** so it says **In production**: then any Google account can sign in. Google shows an
   "unverified app" warning once: click **Advanced**, then **Continue**. (Up to 100 people can do this until Google verifies the app.)
3. Credentials > Create OAuth client ID > *Web application*. Add this **Authorized redirect URI** (use your address):
   `https://YOUR-ADDRESS/api/auth/google/callback`
4. On the server, edit the settings file and fill in the Google lines:
   ```bash
   sudo nano /etc/facilify.env      # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ORGANIZER_EMAILS
   sudo systemctl restart facilify
   ```
5. In Facilify > Settings > **Connect Google**. Then choose *My Gmail account* as the sender and *Google Drive* for storage.

Gmail free accounts allow roughly 500 sends per day; Facilify pauses and lets you continue when it reaches the limit.

SMTP (a school or company mail server) works only if the installer printed *OPEN* for port 587. If it printed *BLOCKED*,
use Gmail. You can re-check any time with `timeout 8 bash -c '</dev/tcp/smtp.gmail.com/587' && echo open`.

## Day-to-day
| What | Command (on the server) |
|---|---|
| See what is happening | `sudo journalctl -u facilify -f` |
| Restart | `sudo systemctl restart facilify` |
| Update the site | on your computer run `bash deploy/pack.sh`, `scp` the new file, then `sudo bash bootstrap.sh` again |
| Back up everything | copy `/var/lib/facilify` and `/etc/facilify.env` (keep the secret: saved Google and SMTP logins cannot be decrypted without it) |

## If something goes wrong
- **The page does not load:** re-check both firewalls (step 3 and the installer's own step). Then `sudo systemctl status caddy facilify`.
- **A certificate error right after install:** wait a minute; Caddy is still getting the HTTPS certificate. If it keeps
  failing with the `sslip.io` name, use a DuckDNS name instead (some shared domains hit certificate rate limits).
- **Google says "redirect_uri_mismatch":** the address in step 8.3 must match the address in `CERTFLOW_BASE_URL` exactly.
- **Oracle can reclaim idle Always Free servers.** Log in to the instance now and then, and keep backups.
