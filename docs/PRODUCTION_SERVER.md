# SmartERP — production install on the Ubuntu VPS

**Target:** the VinaHost VPS registered for this project — `61861.vpsvinahost.vn`,
IP `103.126.162.131`, Ubuntu 24.04 x86_64, 1 vCPU / 1 GB RAM / 25 GB SSD.

**Decision this guide implements:** the **whole application and PostgreSQL run on
that one server**, and both partners use it in a browser over HTTPS. The two
MacBooks are development machines only, each with its own local database.

Why not "database on the server, app on the laptops" — see
[Appendix C](#appendix-c--why-the-app-runs-on-the-server-not-on-a-laptop).

---

## Naming used by this guide

| Thing | Value |
| --- | --- |
| Application folder **on the server** | `/opt/SmartERP` |
| systemd service | `smart-erp` |
| Linux user that owns the app | `deploy` |
| PostgreSQL database | `smart_erp_prod` |
| PostgreSQL role (app login) | `erp` |
| App listens on | `127.0.0.1:5001` (nginx publishes it) |
| Public URL | `https://erp.smartlife-vn.com` |

Every path in this document is `/opt/SmartERP`.

---

## Before you start — collect these

| # | Item | Where it comes from |
| --- | --- | --- |
| 1 | Server IP `103.126.162.131` + root password | VinaHost control panel ("Password" row, eye icon) |
| 2 | DNS name `erp.smartlife-vn.com` | Registrar / DNS host of `smartlife-vn.com`; add an **A record** `erp` → `103.126.162.131` |
| 3 | The git remote your code lives on | `git remote -v` on your Mac |
| 4 | A dump of the current production data | `pg_dump` on your Mac (Step 7) |
| 5 | The current `uploads/` folder | `rsync` from your Mac (Step 7) |

> **Backups on the VPS are off ("Addon Backup: None").** Everything in Step 10 is
> not optional — that cron job is the only copy.

Order of the steps matters: system → Node → database → code → config → schema →
data → run → TLS → backups → verification.

### Two shells, two conventions

Every command block below is written with trailing `#` comments, e.g.

```bash
timedatectl set-timezone Asia/Ho_Chi_Minh     # keep it in your business timezone
free -h                                       # confirm the 2 GB swap file
```

That is safe **on the server** (Ubuntu's interactive `bash` treats `#` as a comment)
but **not** on macOS `zsh`, which does not — pasting such a line into your Mac's
terminal passes `# keep it…` as extra arguments and fails with
`Too many arguments` or `command not found`. Pick one:

- paste only the command part when running something on your Mac, or
- enable comments once: `setopt interactive_comments` (add that line to `~/.zshrc`
  to keep it).

Everything in this guide that runs *on the server* is unaffected.

### Paste multi-line blocks into a real terminal, not a web/GUI console

If a command block is pasted into a browser-based console or a terminal wrapper
that decorates the prompt, every pasted line can arrive **with prompt text glued
in front of it**, so bash tries to run things like

```
-bash: deploy'61861:opt/SmartERP$' (see below for file content): No such file or directory
-bash: 1:DATABASE_URL=postgresql://erp:...: No such file or directory
```

Symptoms to watch for: lines from an *earlier* paste being re-executed, variables
arriving empty (which is how a password can be silently cleared), and a command
seeming to "half run". When that happens:

- run blocks **one line at a time**, or paste multi-line blocks only after
  `ssh deploy@103.126.162.131` from Terminal.app/iTerm2, and
- re-check any state a mangled command may have touched. A line that vanished is
  harmless; a line that ran with an empty variable is not.

---

# Step 1 — Prepare the server

### 1.1 First login and update

From your Mac:

```bash
ssh root@103.126.162.131
```

> **Check you are on the right box** before changing anything: `curl -s ifconfig.me`
> must print `103.126.162.131`. If it prints another address, you connected to a
> different server — `exit` and reconnect before continuing.

On the server:

```bash
export DEBIAN_FRONTEND=noninteractive
apt update
apt -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" full-upgrade
apt install -y curl git ufw fail2ban unzip htop rclone rsync
timedatectl set-timezone Asia/Ho_Chi_Minh     # keep it in your business timezone
```

The two `Dpkg::Options` flags mean "on a config-file conflict, keep the version
already on disk, do not ask". That matters here:

> **If you ever see a purple "Package configuration" screen asking about
> `/etc/ssh/sshd_config`** (`A new version … is available, but the version installed
> currently has been locally modified`), always choose **"keep the local version
> currently installed"** and press `Enter`. The VinaHost image ships a pre-modified
> `sshd_config`; installing the package maintainer's version would restore Ubuntu's
> default `PermitRootLogin prohibit-password` and, because you are logged in as root
> with a **password** at this stage, the next `systemctl restart ssh` can lock you
> out. Step 1.3 hardens that file deliberately, after your key is in place.

### 1.2 Create the `deploy` user

Never run the app as `root`.

```bash
adduser --gecos "" deploy          # it will ask for a password - see note below
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh   # owner matters, see below
```

The password you type here is used for **`sudo` only**; SSH stays key-only (1.3 turns
password logins off), so it is never sent over the network. Do **not** use
`adduser --disabled-password`: a locked password cannot authenticate `sudo`, and every
`sudo` command from Step 2 onwards would fail with `Authentication failure`.

> **`/home/deploy/.ssh` must belong to `deploy`.** Creating it as root (`mkdir -p
> /home/deploy/.ssh && chmod 700 …`) leaves it `root:root`, and then `ssh-copy-id`
> fails with `cannot create .ssh/authorized_keys: Permission denied` — and sshd would
> ignore a root-owned `authorized_keys` anyway (`StrictModes`). Repair with
> `chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh`, then
> `ls -ld /home/deploy/.ssh` must show `deploy deploy`.

Then install your Mac's public key for it. Do this **from your Mac**, while root
login is still allowed (it is switched off in 1.3):

```bash
# 1. if you have no key at all, create one first (Enter = default path)
ls ~/.ssh/*.pub
ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"   # -C is only a label, e.g. manavazhagan@Manavazhagans-MacBook-Pro

# 2. either the familiar way (asks for deploy's password once)
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@103.126.162.131

# ...or push it as root, needed if deploy's password is locked/unset:
cat ~/.ssh/id_ed25519.pub | ssh root@103.126.162.131 '
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  cat > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys'

# 3. prove it works - this must NOT ask for a password
ssh deploy@103.126.162.131 'whoami'      # -> deploy
```

If your key has a passphrase, add it to the macOS Keychain once so you are not asked
every session: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.

> **`ssh-copy-id` prints `Operation timed out` / `Connection timed out` on port 22.**
> Nothing is wrong with the key — the Mac cannot reach sshd at all. Check, in this
> order:
>
> ```bash
> # on the server (you still have the root session)
> echo "public IP: $(curl -s ifconfig.me)"   # must match the IP you are connecting to
> ss -ltn | grep ':22'                       # sshd must be listening on 0.0.0.0:22
> sudo ufw status verbose                    # if active, 22/OpenSSH must be ALLOW
> sudo fail2ban-client status sshd           # your home IP in "Banned IP list"?
> ```
>
> - wrong public IP → you hardened the wrong server; stop and reconnect;
> - ufw active without 22 → `sudo ufw allow OpenSSH`;
> - banned → `sudo fail2ban-client set sshd unbanip <your-home-ip>`
>   (`curl -s ifconfig.me` on the Mac gives that IP).
>
> Workaround that needs no inbound SSH at all — install the key from the open root
> session: print `cat ~/.ssh/id_ed25519.pub` on the Mac, then on the server
>
> ```bash
> mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
> echo 'ssh-ed25519 AAAA…you@host' > /home/deploy/.ssh/authorized_keys
> chown -R deploy:deploy /home/deploy/.ssh
> chmod 600 /home/deploy/.ssh/authorized_keys
> ```

> **At `Enter file in which to save the key` just press `Enter`.** Typing a name there
> (e.g. `erp_server_key`) writes the pair into your home directory instead of
> `~/.ssh/`, and then `ssh`/`ssh-copy-id` won't find it. If you already did that, move
> it: `mkdir -p ~/.ssh && mv ~/erp_server_key ~/.ssh/id_ed25519 && mv ~/erp_server_key.pub ~/.ssh/id_ed25519.pub && chmod 600 ~/.ssh/id_ed25519`.
> A second empty passphrase prompt pair ("Passphrases do not match", then two Enters)
> also leaves the key **without** a passphrase — re-protect it with
> `ssh-keygen -p -f ~/.ssh/id_ed25519`.

Optional, saves typing for the rest of this guide — `~/.ssh/config` on your Mac:

```sshconfig
Host erp-vps
    HostName 103.126.162.131
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    AddKeysToAgent yes
    UseKeychain yes
    ServerAliveInterval 60
```

Then `ssh erp-vps` replaces every `ssh deploy@103.126.162.131` below.

### 1.3 Harden SSH

```bash
# on the server, as root
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart ssh
```

**Test in a second terminal** that `ssh deploy@103.126.162.131` works *before*
closing the root session.

### 1.4 Firewall and fail2ban

```bash
sudo -v                          # proves deploy's password works for sudo - do not skip
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
systemctl enable --now fail2ban
fail2ban-client status sshd
```

Keep a **second SSH session open** whenever you touch `ufw` or `sshd`, and test
`ssh deploy@…` again afterwards — an enabled firewall without the OpenSSH rule drops
port 22 silently (connection *times out* rather than being refused).

Port **5432 stays closed** and is never opened in this design. The database is
reached only from `localhost`.

### 1.5 Swap (required on 1 GB RAM)

`vite build` and `drizzle-kit push` both need more than 1 GB of headroom; without
swap the OOM killer takes them out mid-build.

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' >> /etc/sysctl.conf && sysctl -p
free -h          # Swap: 2.0Gi must be listed
```

**Verify:** `free -h` shows 2 GB swap; `ufw status` shows 22/80/443 only.

---

# Step 2 — Node.js

The app is ESM (`"type": "module"`), built by Vite + esbuild, and CI runs Node 20.
Ubuntu's own `nodejs` package is too old, so install **Node 22 LTS** from NodeSource.

```bash
# as root
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v          # v22.x
npm -v
```

Node 22's experimental `localStorage` only affects the *test* suite (see
`tests/frontend/theme/theme-provider.test.tsx`); the production build and server
are unaffected.

**Verify:**

```bash
node -e "console.log(process.version, typeof fetch)"   # v22..., function
which node                                             # /usr/bin/node
```

`/usr/bin/node` is the path the systemd unit uses later.

---

# Step 3 — PostgreSQL on the same server

### 3.1 Install

```bash
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql
psql --version          # psql (PostgreSQL) 16.x
```

### 3.2 Create the role and the (empty) database

Pick a long password and keep it — it goes into `.env` in Step 5 and nowhere else.
Generate it in **hex**, not base64: `/`, `+`, `=` and `@` would have to be
URL-encoded inside `DATABASE_URL`.

```bash
openssl rand -hex 24        # e.g. 9f3c…  <- use this below AND in Step 5
```

Set it through a variable — never inline, and never with a possibly-empty one:

```bash
# paste the hex from above between the quotes (no spaces)
DBPW='9f3c...'

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE erp LOGIN PASSWORD '${DBPW:?DBPW is empty - paste the hex value}';
CREATE DATABASE smart_erp_prod OWNER erp;
SQL
unset DBPW
```

`${DBPW:?…}` makes the command **fail** instead of silently setting an empty
password. If you ever see

```
NOTICE:  empty string is not a valid password, clearing password
ALTER ROLE
```

the variable was empty (usually because `set -a; source ./.env` did not run in
that shell, so `$PGPASS` expanded to nothing) and the role now has **no**
password — every connection fails with `password authentication failed`. Recover
with `ALTER ROLE erp PASSWORD '<value>'` using a variable guard as above.

Notes:

- The app user is `erp`, **not** the `postgres` superuser. `drizzle-kit push`
  only needs ownership of its own schema.
- `smart_erp_prod` must stay **empty** at this point. Step 7 restores the dump
  into it; restoring into a non-empty database fails on duplicate objects.

### 3.3 Tune for 1 GB RAM

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET shared_buffers = '128MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET work_mem = '8MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET maintenance_work_mem = '64MB';"
sudo -u postgres psql -c "ALTER SYSTEM SET max_connections = 20;"
sudo -u postgres psql -c "ALTER SYSTEM SET effective_cache_size = '512MB';"
systemctl restart postgresql
```

### 3.4 Keep it local-only (verify, do not change)

```bash
grep -E "^#?(listen_addresses|port)" /etc/postgresql/16/main/postgresql.conf
grep -vE "^\s*#|^\s*$" /etc/postgresql/16/main/pg_hba.conf
```

Expected: `listen_addresses` commented out or `= 'localhost'` (Postgres' own default
is localhost-only), and `host … 127.0.0.1/32 … scram-sha-256` in `pg_hba.conf`.
Nothing should say `0.0.0.0` or `::/0`.

### 3.5 Verify with a real connection

```bash
psql "postgresql://erp:CHANGE_ME_long_random_password@127.0.0.1:5432/smart_erp_prod" \
  -c "select current_database(), current_user, version();"
```

---

# Step 4 — Put the application code in `/opt/SmartERP`

### 4.1 Create the folder and clone

```bash
# as root
mkdir -p /opt/SmartERP
chown deploy:deploy /opt/SmartERP

su - deploy
git clone <YOUR_GIT_REMOTE_URL> /opt/SmartERP
cd /opt/SmartERP
git log --oneline -3
```

If the repo is private, give the `deploy` user its own read-only deploy key:

```bash
ssh-keygen -t ed25519 -C "smart-erp-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# paste into GitHub/GitLab → repository → Settings → Deploy keys (read-only is enough)
```

### 4.2 Folders that git does not track

`.gitignore` excludes `dist/`, `uploads/`, `logs/`, `backups/` and `.env`. Create
the runtime folders now so their ownership is right from the first write:

```bash
cd /opt/SmartERP
mkdir -p uploads logs backups
ls -la
```

### 4.3 Why the folder name matters

`server/index.ts` serves files from `path.resolve(process.cwd(), "uploads")`, and
`server/product-images.ts`, `server/delivery-note-documents.ts`,
`server/invoice-documents.ts` and `server/attachment-files.ts` write there. The
systemd unit in Step 8 sets `WorkingDirectory=/opt/SmartERP`, so product
pictures, signed delivery notes and archived invoices all land in
`/opt/SmartERP/uploads/`. Renaming that folder later orphans every stored file
path in the database.

**Verify:** `/opt/SmartERP` is owned by `deploy`, contains `package.json`, `db/`,
`server/`, `client/`, and an empty `uploads/`.

---

# Step 5 — Create `/opt/SmartERP/.env`

### 5.1 Generate the two secrets first

```bash
openssl rand -hex 32      # -> SESSION_SECRET
openssl rand -hex 32      # -> INTEGRATION_SECRET_KEY
```

### 5.2 Write the file

```bash
cd /opt/SmartERP
nano .env
```

```ini
# ---- Database (localhost only; never expose 5432) ----
DATABASE_URL=postgresql://erp:CHANGE_ME_long_random_password@127.0.0.1:5432/smart_erp_prod

# ---- Runtime ----
NODE_ENV=production
PORT=5001

# ---- Security ----
# 64 hex chars from `openssl rand -hex 32`. Production refuses to boot without it.
SESSION_SECRET=paste_first_generated_value_here
# Encrypts the WooCommerce API keys stored per shop (website-stock-sync).
# Rotating this makes stored keys unreadable until they are re-entered.
INTEGRATION_SECRET_KEY=paste_second_generated_value_here

# Behind nginx + Let's Encrypt the cookie MUST be Secure.
# (server/auth.ts defaults it to true in production; set it explicitly so the
# value is visible here and survives any future default change.)
COOKIE_SECURE=true
```

```bash
chmod 600 .env
ls -l .env          # -rw------- deploy deploy
```

Check for placeholders before going any further — a `.env` that *works* with a
copied placeholder password is worse than one that fails:

```bash
grep -nE 'CHANGE_ME|THE_NEW|YOUR_|paste_|_here' .env      # must print nothing
set -a; source ./.env; set +a
TMP="${DATABASE_URL#*://}"; TMP="${TMP%%@*}"; P="${TMP#*:}"
echo "user=${TMP%%:*}  pass-length=${#P}"                 # user=erp  pass-length=48
unset TMP P
psql "$DATABASE_URL" -c "select current_database();"      # smart_erp_prod
```

### 5.3 The one trap that already bit this project

`server/index.ts` starts with `import "dotenv/config"`, and **dotenv does not
override a variable that already exists in the environment** (documented in
`PRODUCTION.md`). The systemd unit therefore uses `EnvironmentFile=` so the
values are exported *before* Node starts — same effect as `set -a; source ./.env`
in `start_prod.sh`. Verify later with:

```bash
sudo systemctl show smart-erp -p Environment | tr ' ' '\n' | grep -E 'DATABASE_URL|NODE_ENV|PORT'
```

**Verify now:**

```bash
set -a; source ./.env; set +a
psql "$DATABASE_URL" -c "select current_database();"   # smart_erp_prod
```

---

# Step 6 — Install dependencies

```bash
cd /opt/SmartERP
NODE_ENV=development npm ci
```

Why not a bare `npm ci`: `drizzle-kit` (for `db:push`) and `vite`/`esbuild` (for
`build`) are **devDependencies**, and `npm ci` prunes them when `NODE_ENV=production`
is already set in the shell. This is the same trap `deploy.sh` warns about on
line 35–38 of that script.

If `npm ci` gets killed on 1 GB RAM (should not happen with the 2 GB swap from
Step 1.5), retry with an explicit heap cap:

```bash
NODE_ENV=development NODE_OPTIONS=--max-old-space-size=768 npm ci
```

**Verify:**

```bash
npx drizzle-kit --version
npx vite --version
npx tsx --version
```

---

# Step 7 — Bring the database schema and your data over

Pick **one** of the two branches. Your order is fixed by
`PRODUCTION.md` ("Importing data into a fresh database — the order"):

> restore the dump **first**, into an empty database → `db:push` **second**.

`pg_restore` recreates tables, data, sequences, indexes and constraints in
dependency order. `db:push` first would make the restore fail with
"relation already exists".

## 7A — You have production data on the Mac (the normal case)

### 7A.1 On the Mac — take a consistent dump

```bash
pg_dump --version                 # 16.x is ideal; a newer client is fine for plain SQL
```

> **Version trap — `-Fc` archives do not travel upward.** A custom-format archive
> carries an archive-format version (`pg_dump` 18 writes `1.16`) and the server's
> `pg_restore` 16 refuses it with `unsupported version (1.16) in file header`.
> Postgres.app ships only `latest` (18 here), so dump **plain SQL** — it has no
> archive header and restores with any `psql`:

```bash
pg_dump -h localhost -U postgres -Fp --no-owner --no-privileges smart_erp_prod \
  | gzip > /tmp/smart_erp_prod_$(date +%Y%m%d_%H%M).sql.gz
ls -lh /tmp/smart_erp_prod_*.sql.gz
gunzip -c /tmp/smart_erp_prod_*.sql.gz | head -20      # sanity check the SQL text
```

`--no-owner` / `--no-privileges` are the plain-SQL equivalent of the `pg_restore`
flags used below: no `OWNER TO postgres`, no `GRANT`s that reference roles which
do not exist on the server.

If you specifically need `-Fc` (e.g. for `--data-only` partial restores), use a
**16** client for the dump — `brew install postgresql@16` and run
`/opt/homebrew/opt/postgresql@16/bin/pg_dump …`, or
`docker run --rm postgres:16 pg_dump -h host.docker.internal -U postgres -Fc …`.

Stop using the Mac instance for real work from this point; anything entered on
the Mac after this dump does not exist on the server.

### 7A.2 On the Mac — copy the dump **and** the files

```bash
# the dump
scp /tmp/smart_erp_prod_YYYYMMDD_HHMM.sql.gz deploy@103.126.162.131:/tmp/

# the uploads (product pictures, signed delivery notes, archived invoices,
# attachments, inventory imports) - the database only stores their paths.
# Replace the source path with your local SmartERP-prod checkout.
rsync -av --progress \
  "/path/to/SmartERP-prod/uploads/" \
  deploy@103.126.162.131:/opt/SmartERP/uploads/
```

Both must arrive: a restored row pointing at a picture that is not on the server
shows as a broken image, and an invoice archive that is missing cannot be
reprinted.

### 7A.3 On the server — restore into the empty database

```bash
cd /opt/SmartERP
set -a; source ./.env; set +a

gunzip -c /tmp/smart_erp_prod_YYYYMMDD_HHMM.sql.gz \
  | grep -v '^SET transaction_timeout' \
  | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
```

`grep -v '^SET transaction_timeout'` is not optional when the dump came from a
**17/18** client: `pg_dump` 18 writes `SET transaction_timeout = 0;` (a GUC added
in PG 17) near the top of the file, and the PG 16 server answers
`ERROR: unrecognized configuration parameter "transaction_timeout"` — with
`ON_ERROR_STOP=1` the restore aborts there, before the first table. Dropping that
one `SET` line changes nothing about the data.

`ON_ERROR_STOP=1` is the plain-SQL equivalent of `--exit-on-error`: without it
`psql` prints `ERROR:` lines and keeps going, leaving a half-restored database
that looks fine until a page 500s.

**Verify the restore before moving on:**

```bash
psql "$DATABASE_URL" -c '\dt' | tail -3                 # table count
psql "$DATABASE_URL" -Atc 'select count(*) from users;'
psql "$DATABASE_URL" -Atc 'select count(*) from products;'
psql "$DATABASE_URL" -c 'delete from user_sessions;'    # sessions do not survive a new SESSION_SECRET
```

The row counts must match what the Mac reports for the same tables (run the same
`select count(*)` locally). A silent `0` means you restored into the wrong
database — check `psql "$DATABASE_URL" -Atc 'select current_database();'` again.

### 7A.4 On the server — reconcile the schema with the code

```bash
npm run db:push
```

If the dump came from the same commit this prints **"No changes detected"**. If
the code is newer, it adds the missing tables/columns. It is interactive and asks
before anything destructive — read the prompt.

Two outputs that look alarming but are not:

- **`[✓] Changes applied` on every run**, even when you have not changed anything.
  `drizzle-kit` compares its own generated constraint names against Postgres's
  truncated ones (identifiers are capped at 63 characters, and names like
  `sales_transaction_items_sales_transaction_id_sales_transactions_id_fk` are
  longer), so it drops and recreates those FKs each time. Confirm it is not
  duplicating anything:
  ```bash
  psql "$DATABASE_URL" -Atc "select count(*) from pg_constraint where conrelid='transfer_request_items'::regclass;"
  # must be the same number before and after a push (3 for that table)
  ```
- **`NOTICE: identifier "…_fk" will be truncated to "…"`** — Postgres telling you
  it shortened the name. Harmless, and it is the cause of the bullet above. Do not
  "fix" it by renaming constraints by hand.

Never accept a prompt that offers to drop a column or a table on a restored
production database — that prompt means the code and the dump disagree, which you
want to investigate, not confirm.

## 7B — You are starting with an empty database

Skip the dump/restore entirely and create the schema from the code:

```bash
cd /opt/SmartERP
set -a; source ./.env; set +a
npm run db:push
```

At the first boot the app itself creates the two licensed VAT companies
(`ensureVatCompanySeeds`) and the default `admin` / `admin123` user
(`setupAdmin`). Change that password immediately (Step 11.4).

## 7C — Both branches: drop development sessions

```bash
psql "$DATABASE_URL" -c 'DELETE FROM user_sessions;'
```

Sessions are stored in Postgres (`server/session-store.ts`, table
`user_sessions`). Copying them would carry Mac logins into production, and their
signatures are tied to the Mac's `SESSION_SECRET` anyway.

## 7D — Both branches: verify the data landed

```bash
psql "$DATABASE_URL" -Atc "
  select 'users='||count(*) from users;
  select 'products='||count(*) from products;
  select 'invoices='||count(*) from invoices;
  select 'inventory='||count(*) from inventory;
  select 'tables='||count(*) from information_schema.tables where table_schema='public';"

du -sh /opt/SmartERP/uploads
ls /opt/SmartERP/uploads
```

Expected: the numbers must equal what the Mac reports for the same queries. As of
the 2026-11-28 dump: `users=15`, `products=61`, `invoices=1`, `inventory=105`,
`tables=46`, and the uploads folders
`products/ delivery-notes/ invoices/ inventory-imports/ attachments/` present with
non-zero sizes (105 files, ~15 MB here).

> Older revisions of this guide said `users=14, products=56, tables=40` — copy
> those numbers only as an order of magnitude. What matters is *Mac == server*, and
> that `tables` is not `0`.

---

# Step 8 — Build and run under systemd

### 8.1 Build

```bash
cd /opt/SmartERP
NODE_ENV=development NODE_OPTIONS=--max-old-space-size=896 npm run build
ls -la dist/            # dist/index.js (server) + dist/public/ (client)
```

`npm run build` = `vite build && esbuild server/index.ts …` (see `package.json`).
It needs the devDependencies from Step 6; that is why the variable is set.

> **`NODE_OPTIONS=--max-old-space-size=896` is required on a 1 GB VPS, not a
> fallback.** V8 sizes its heap from installed RAM — roughly 470-500 MB here — and
> `vite build` of this client exceeds it within a minute:
>
> ```
> FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
> ...
> Aborted (core dumped)
> ```
>
> The 2 GB swap from Step 1.5 is what makes 896 MB safe. Because part of the heap
> can live in swap, the build takes **2-3 minutes** and looks stalled at
> `transforming...` — that is normal, do not `Ctrl-C`. A successful run ends with
> `dist/index.js  <n>kb` followed by `⚡ Done in <n>ms` from esbuild.
>
> Do not "cancel" a previous run with `pkill -f "vite build"` over ssh: the pattern
> also matches the ssh command line itself and kills your own session before the
> restart happens. Use `pgrep -af vite` to find the PID and kill that number.

### 8.2 Install the service unit

The unit is versioned in this repo at `deploy/smart-erp.service`:

```bash
sudo cp /opt/SmartERP/deploy/smart-erp.service /etc/systemd/system/smart-erp.service
sudo systemctl daemon-reload
sudo systemctl enable smart-erp
```

It contains, and why each line matters here:

| Line | Reason |
| --- | --- |
| `User=deploy` | the app owns `/opt/SmartERP`; root is never needed |
| `WorkingDirectory=/opt/SmartERP` | `uploads/` is resolved from `process.cwd()` |
| `EnvironmentFile=/opt/SmartERP/.env` | exports `DATABASE_URL`/`SESSION_SECRET` **before** Node boots, defeating the dotenv-does-not-override trap |
| `ExecStart=/usr/bin/node dist/index.js` | the compiled ESM server, not `tsx` |
| `Restart=always`, `RestartSec=5` | the app `process.exit(1)`s on unhandled rejections (`server/index.ts`), so a supervisor is mandatory |
| `After=postgresql.service` | start order only; the app also survives a DB restart |

### 8.3 Allow the deploy user to restart it without a root shell

```bash
sudo tee /etc/sudoers.d/smart-erp-deploy >/dev/null <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart smart-erp, \
                            /usr/bin/systemctl status smart-erp
EOF
sudo chmod 440 /etc/sudoers.d/smart-erp-deploy
sudo visudo -c            # must print "parsed OK"
```

### 8.4 Start it

```bash
sudo systemctl start smart-erp
sudo systemctl status smart-erp --no-pager
sudo journalctl -u smart-erp -n 40 --no-pager
```

### 8.5 Verify — do this before touching nginx

```bash
curl -s http://127.0.0.1:5001/api/health          # {"status":"ok","db":"up",...}

# the process must be pointing at the right database and port
sudo systemctl show smart-erp -p Environment | tr ' ' '\n' \
  | grep -E '^(DATABASE_URL|NODE_ENV|PORT)='

# the process must be the only listener on 5001
sudo ss -ltnp | grep 5001

# uploads must be served from /opt/SmartERP/uploads
curl -sI http://127.0.0.1:5001/uploads/ | head -1
```

`{"status":"ok","db":"up"}` is the required answer; anything else means Node is up
but `DATABASE_URL` is wrong (see `server/index.ts:65`).

> **Security note.** `server/index.ts` calls `server.listen(port, "0.0.0.0")`, so
> the Node process is reachable on every interface on port 5001. The only thing
> keeping it private is `ufw` from Step 1.4 — **never** run `ufw allow 5001`.
> nginx reaches it over loopback, the internet does not. Confirm nothing is
> published with `sudo ss -ltn | grep 5001` (it will show `0.0.0.0:5001`, which is
> expected) and `curl -m 3 http://103.126.162.131:5001/api/health` **failing**
> from your Mac.

---

# Step 9 — nginx + HTTPS

### 9.1 DNS first

At the DNS host for **`smartlife-vn.com`**: add an **A record**

| Type | Name / Host | Value | TTL |
| --- | --- | --- | --- |
| `A` | `erp` | `103.126.162.131` | 300 (or the lowest offered) |

Some panels want the full name (`erp.smartlife-vn.com`) instead of just `erp`; both
mean the same record. If the domain sits behind Cloudflare, set that record to
**DNS only** (grey cloud, not proxied) while you run certbot — the HTTP-01 challenge
needs to reach this server directly. You can re-enable the proxy afterwards if you
want, but this guide's nginx/TLS setup assumes it stays DNS-only.

Confirm before requesting a certificate — Let's Encrypt validates over port 80:

```bash
dig +short erp.smartlife-vn.com      # -> 103.126.162.131
```

Do not continue until that prints `103.126.162.131`. A wrong/absent A record is the
single most common cause of `certbot` failing with "no valid IP addresses found".

### 9.2 Install nginx and the site

```bash
sudo apt install -y nginx
sudo cp /opt/SmartERP/deploy/nginx-smart-erp.conf /etc/nginx/sites-available/smart-erp
sudo ln -sf /etc/nginx/sites-available/smart-erp /etc/nginx/sites-enabled/smart-erp
sudo rm -f /etc/nginx/sites-enabled/default
grep -n server_name /etc/nginx/sites-available/smart-erp   # must say erp.smartlife-vn.com
sudo nginx -t
sudo systemctl reload nginx
```

The shipped config already names `erp.smartlife-vn.com`, so no editing is needed
unless you change the hostname later (then change it here **and** in the certbot
command in 9.3).

The config proxies to `127.0.0.1:5001`, forwards `Host`, `X-Forwarded-For` and
`X-Forwarded-Proto`, and sets `client_max_body_size 12m` (bulk product import
posts up to 10 MB of JSON — `server/index.ts:42`).

`app.set("trust proxy", 1)` is already on in production (`server/auth.ts:219`), so
the login limiter sees real client IPs, not nginx's.

### 9.3 Certificates

```bash
sudo apt install -y certbot python3-certbot-nginx
# -m must be a mailbox you actually read: Let's Encrypt sends expiry warnings there
sudo certbot --nginx -d erp.smartlife-vn.com --redirect --agree-tos -m YOUR_EMAIL@smartlife-vn.com
sudo certbot renew --dry-run
```

The `--redirect` option adds the 80 → 443 redirect. `COOKIE_SECURE=true` from
Step 5.2 now applies to a real HTTPS connection; without TLS nobody could log in.

### 9.4 Verify from outside

```bash
# from your Mac
curl -s https://erp.smartlife-vn.com/api/health
open https://erp.smartlife-vn.com
```

---

# Step 10 — Nightly backup to OneDrive (03:00), with a local copy first

Two things must be saved **together**, because the database stores only paths into
`uploads/`: a dump without the files restores rows that point at missing pictures
and unsigned invoices.

### 10.1 What the nightly job produces

One cron entry at **03:00 server time** runs `deploy/backup.sh`, which writes:

| Where | File | Retention | Why |
| --- | --- | --- | --- |
| `/opt/SmartERP/backups/` | `db_<stamp>.dump` | 14 days | `pg_dump -Fc`, the whole database |
| `/opt/SmartERP/backups/` | `uploads_<stamp>.tgz` | 14 days | every file the app stored |
| `OneDrive:SmartERP-backups/` | `db_<stamp>.dump` | 30 days | survives the VPS dying |
| `OneDrive:SmartERP-backups/uploads/` | the files themselves | current state | incremental mirror, no 14× multiplication |
| `/opt/SmartERP/backups/last_backup.txt` | text | — | `status=ok|failed`, timestamp, sizes, remote state of the last run |

The dumps are small (a few MB); the file tree is not. That is why the database is
versioned 30 deep in the cloud while `uploads/` is mirrored once (adds and updates
only, never deletes) — on a 5 GB OneDrive plan, 14 daily tarballs of product photos
alone would fill it.

### 10.2 Install the script

```bash
chmod +x /opt/SmartERP/deploy/backup.sh /opt/SmartERP/deploy-server.sh
mkdir -p /opt/SmartERP/backups
```

Run it once locally before adding the cloud leg:

```bash
/opt/SmartERP/deploy/backup.sh
ls -lh /opt/SmartERP/backups
cat /opt/SmartERP/backups/last_backup.txt
```

The first run prints `off-site: skipped (BACKUP_RCLONE_REMOTE not set in .env)` —
that is expected until Step 10.5.

### 10.3 rclone comes with the server

`rclone` was installed in Step 1.1. Confirm:

```bash
rclone version        # v1.65 or newer on Ubuntu 24.04
```


### 10.4 Connect OneDrive (one-time, from a headless server)

rclone cannot open a browser on the VPS, so the Microsoft sign-in happens **on your
Mac** and only the resulting token is copied across.

**a) On your Mac** — install rclone and authorize:

```bash
brew install rclone
rclone authorize "onedrive"
```

A browser opens: sign in with the Microsoft account whose OneDrive should hold the
backups, accept the permissions, and the terminal prints a block like

```
---> {"access_token":"…","token_type":"Bearer","refresh_token":"…","expiry":"…"} <---
```

Copy that JSON (the `{…}` part only) — you paste it in step (b).

**b) On the server** — start the remote definition:

```bash
rclone config
```

Answer like this; for any prompt not listed, press Enter for the default:

| Prompt | Answer |
| --- | --- |
| `n) New remote` | `n` |
| `name>` | `onedrive` |
| `Storage>` | `onedrive` (Microsoft OneDrive) — type the number printed next to it |
| `client_id>` | blank — use rclone's built-in app registration |
| `client_secret>` | blank |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate rclone with remote?` | **`n`** ← the key answer on a headless server |
| it now says "execute `rclone authorize "onedrive"` on a machine with a browser" | paste the JSON from (a), then Enter |
| `Configure this as a SharePoint document library?` | `n` |
| drive list (`Choose a number…`) | the entry marked `personal` (or your tenant's `documentLibrary`), usually `1` |
| `root_folder_id>` | blank |
| `Keep this "onedrive" remote?` | `y` |
| `q) Quit config` | `q` |

**c) Test it before trusting it:**

```bash
rclone lsd onedrive:                 # your OneDrive folders
rclone mkdir onedrive:SmartERP-backups
rclone about onedrive:               # quota: OneDrive personal is 5 GB
echo hello > /tmp/rclone-test.txt
rclone copy /tmp/rclone-test.txt onedrive:SmartERP-backups/
rclone lsf onedrive:SmartERP-backups/
rclone delete onedrive:SmartERP-backups/rclone-test.txt && rm /tmp/rclone-test.txt
```

The credentials land in `~/.config/rclone/rclone.conf` (mode 600). That file is a
refresh token for **the whole OneDrive account**: never copy it into the repo, never
paste it into a chat, and revoke it from Microsoft → Account → "Apps and services"
if it ever leaks.

> Run `rclone config` **as the `deploy` user**, not as root. Cron runs as `deploy`,
> and a config in `/root/.config/rclone/` is invisible to it (the script fails with
> `ERROR no rclone config at …`).

### 10.5 Turn the off-site leg on

```bash
cd /opt/SmartERP
nano .env
```

```ini
# ---- Nightly backups (deploy/backup.sh) ----
# rclone remote + folder created in Step 10.4. Empty = keep backups on the server only.
BACKUP_RCLONE_REMOTE=onedrive:SmartERP-backups
BACKUP_KEEP_DAYS=14
BACKUP_REMOTE_KEEP_DAYS=30
```

Run the script by hand once — this is the run that proves the whole chain:

```bash
/opt/SmartERP/deploy/backup.sh
```

A good run ends with:

```
off-site: ok (onedrive:SmartERP-backups)
===== SmartERP backup OK =====
```

and `rclone lsf onedrive:SmartERP-backups/` now lists tonight's `db_<stamp>.dump`
plus an `uploads/` folder.

### 10.6 Schedule it at 03:00

```bash
crontab -e      # as the deploy user
```

```cron
# SmartERP: dump + uploads at 03:00 server time (Asia/Ho_Chi_Minh), then push to OneDrive
0 3 * * * /opt/SmartERP/deploy/backup.sh >> /opt/SmartERP/logs/backup.log 2>&1
```

Notes:

- Cron uses the **server's** timezone. Step 1.1 set `Asia/Ho_Chi_Minh`; confirm with
  `timedatectl`. For 03:00 in another zone, change the hour.
- One entry only: the script uploads *after* it has finished dumping, so a slow
  upload can never delay the next night's dump.
- `flock` inside the script makes overlapping runs impossible — if last night's
  upload is still going, the new run logs `skipping this run` and exits 0.
- Cron's `PATH` is minimal; the script only uses `/usr/bin` commands, so that is fine.

### 10.7 Check it the next morning

```bash
tail -40 /opt/SmartERP/logs/backup.log
cat /opt/SmartERP/backups/last_backup.txt     # want: status=ok and remote=ok (…)
rclone lsf onedrive:SmartERP-backups/ | tail -5
rclone size onedrive:SmartERP-backups         # total bytes + object count
```

Failures are loud, not silent: an `ERROR` or `Failed to copy` line means the
off-site half did not happen, `status=failed` is recorded even though the local dump
still exists, and the script exits non-zero (cron then mails you if
`MAILTO=you@example.com` is in the crontab).

| Message | Meaning |
| --- | --- |
| `skipped (BACKUP_RCLONE_REMOTE not set in .env)` | Step 10.5 not done, or a typo in the key |
| `ERROR no rclone config at …` | the token lives in `root`'s home — rerun 10.4 as `deploy` |
| `ERROR rclone is not installed` | `sudo apt install -y rclone` |
| `401 Unauthorized` / `directory not found` | token expired or revoked → redo 10.4 (a) |
| `quota exceeded` | OneDrive full: `rclone about onedrive:`, then lower `BACKUP_REMOTE_KEEP_DAYS` |

### 10.8 Restore drill: prove a backup is restorable

```bash
# create a scratch database, restore into it, count, drop it
sudo -u postgres createdb -O erp smart_erp_restoretest
pg_restore --no-owner --no-privileges --exit-on-error \
  -d "postgresql://erp:CHANGE_ME_long_random_password@127.0.0.1:5432/smart_erp_restoretest" \
  /opt/SmartERP/backups/db_YYYYMMDD.dump
psql "postgresql://erp:CHANGE_ME_long_random_password@127.0.0.1:5432/smart_erp_restoretest" \
  -c "select count(*) from invoices;"
sudo -u postgres dropdb smart_erp_restoretest
```

A backup you have never restored is a guess, not a backup.

### 10.9 Full disaster recovery from OneDrive

The VPS is gone (or the disk died) and OneDrive holds the only copy. On a fresh
Ubuntu server, redo Steps 1–6 of this guide (system, Node, Postgres role +
**empty** `smart_erp_prod`, code in `/opt/SmartERP`, `.env`, `npm ci`), reconnect
rclone as in 10.4 (same Microsoft account), then:

```bash
cd /opt/SmartERP
set -a; source ./.env; set +a

# 1. which dump do I want? (names sort chronologically)
rclone lsf onedrive:SmartERP-backups/ | grep '^db_' | sort | tail -5
STAMP=20261128_0300          # <- the one you picked

# 2. database: fetch, recreate the empty database, restore
rclone copy "onedrive:SmartERP-backups/db_${STAMP}.dump" /tmp/
sudo -u postgres dropdb --if-exists smart_erp_prod
sudo -u postgres createdb -O erp smart_erp_prod
pg_restore --no-owner --no-privileges --exit-on-error \
  -d "$DATABASE_URL" "/tmp/db_${STAMP}.dump"

# 3. files
rclone copy onedrive:SmartERP-backups/uploads /opt/SmartERP/uploads

# 4. no stale sessions, then go live
psql "$DATABASE_URL" -c 'DELETE FROM user_sessions;'
sudo systemctl start smart-erp
curl -s http://127.0.0.1:5001/api/health
```

The uploads mirror is never pruned, so it contains every file ever uploaded; after
restoring an older dump you simply have some files the database no longer refers
to. That is harmless — the reverse (a row pointing at a missing file) cannot happen.

### 10.10 Disk and quota watch

25 GB on the server and 5 GB on a personal OneDrive are both plenty for this
workload, but uploads only grow:

```bash
df -h /                                        # server disk
du -sh /opt/SmartERP/uploads /opt/SmartERP/backups
rclone about onedrive:                         # OneDrive quota
rclone size onedrive:SmartERP-backups
```

Alert yourself (`apt install -y monit`, or a cron `df` check) before `/` crosses
~80%. If OneDrive gets tight, lower `BACKUP_REMOTE_KEEP_DAYS` (30 → 14) — the
uploads mirror does not grow with retention, only the dumps do.

---

# Step 11 — Acceptance checks and go-live

Work through this list in order; each line has a command or a click.

### 11.1 Server-side

```bash
sudo systemctl is-enabled smart-erp        # enabled
sudo systemctl status smart-erp --no-pager # active (running)
curl -s https://erp.smartlife-vn.com/api/health
sudo journalctl -u smart-erp --since "10 min ago" --no-pager | tail -20
```

The boot log should show `serving on port 5001` and no `[fatal]` lines.

### 11.2 Reboot test (proves systemd + Postgres ordering)

```bash
sudo reboot
# wait ~30 s, then from your Mac
curl -s https://erp.smartlife-vn.com/api/health
```

### 11.3 Both partners log in — from their own machines

- You: `https://erp.smartlife-vn.com` on your MacBook (not `localhost:5002`).
- Your partner: same URL on their MacBook. **They install nothing** — no Node, no
  Postgres, no code. That is the whole point of option 1.

Check that the role you assign them (Administration → Roles) matches what they
should see; permissions come from `shared/permissions.ts`.

### 11.4 Security immediately after the first login

1. Change the default `admin` / `admin123` password (Administration → Users).
2. Create one user per person instead of sharing `admin` — the stock ledger and
   invoice actions record the acting user.
3. In DBeaver, connect over an SSH tunnel and confirm the data matches what the
   UI shows.

### 11.5 End-to-end business smoke test

Do one of each, then verify the *files* exist on the server, not just the rows:

| Action | Verify |
| --- | --- |
| Upload a product picture | `ls /opt/SmartERP/uploads/products/` shows the new file; the image renders in the grid |
| Create a sales order + delivery note | row in `sales_orders`; stock movement written (`select count(*) from stock_movements;`) |
| Issue an invoice | `ls /opt/SmartERP/uploads/invoices/` shows `<number>.html`; reprint from the UI is identical |
| Record a payment | invoice `amount_paid` / `balance_due` update; a second receipt over the balance is refused |
| Upload a signed delivery note | `ls /opt/SmartERP/uploads/delivery-notes/` |
| Import an inventory file | `ls /opt/SmartERP/uploads/inventory-imports/`; `select sum(delta) from stock_movements` matches `select sum(quantity) from inventory` |
| Run the WooCommerce sync once | Finance/Website screen returns success; check `docs/website-stock-sync.md` for the expected output |

### 11.6 Freeze the Mac instance

Stop the old `SmartERP-prod` instance on your Mac (`./stop_prod.sh` in that
checkout) so nobody enters business data that the server will never see.
Demote that checkout to "development only".

---

# Step 12 — Releases after go-live, and the two-development-machine workflow

## 12.1 Production release (one-way: Mac → git → server)

```bash
# on your Mac, in the development checkout
npm run check && npm run test:run        # optional but cheap
git add -A && git commit -m "…" && git push
```

```bash
# on the server
ssh deploy@103.126.162.131
cd /opt/SmartERP
./deploy-server.sh
```

`deploy-server.sh` does exactly what `deploy.sh` does for the Mac setup — fetch,
`npm ci` with `NODE_ENV=development`, `db:push`, `build` — but restarts the
**systemd service** instead of a `nohup` process and does not need `lsof`/pkill:

```bash
git fetch origin && git reset --hard origin/main
NODE_ENV=development npm ci
source ./.env && npm run db:push
NODE_ENV=development npm run build
sudo systemctl restart smart-erp
```

Notes:

- `.env` and `uploads/` are gitignored, so `git reset --hard` cannot destroy them.
- `db:push` prompts before destructive changes; run the script in an interactive
  SSH session, never from a cron job.
- Ordering rule from `PRODUCTION.md` still applies: additive schema changes are
  safe in either order, destructive ones must land in one release while the app
  is stopped.
- Rollback: `git reset --hard <previous-sha> && npm ci && npm run build &&
  sudo systemctl restart smart-erp`. The **database** rollback is the nightly dump
  from Step 10 — `db:push` does not undo a dropped column.

## 12.2 Development machine A (your MacBook)

Keep working exactly as before, against a **local** database:

```ini
# .env (development checkout only)
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/smart_erp_dev_mano
PORT=5001
NODE_ENV=development
SESSION_SECRET=dev-mano
COOKIE_SECURE=false
```

```bash
npm run db:push      # only ever touches smart_erp_dev_mano
npm run dev          # http://localhost:5001
```

## 12.3 Development machine B (your partner's MacBook)

Identical flow, different names so nothing collides:

```bash
createdb smart_erp_dev_partner
git clone <YOUR_GIT_REMOTE_URL> ~/Dev/SmartERP
cd ~/Dev/SmartERP
cp .env.example .env    # then set smart_erp_dev_partner, PORT=5001, dev secret
npm install
npm run db:push
npm run dev
```

From that point on: pull, code, test, push. They never touch the server, never
need the production password, and never run `db:push` against `smart_erp_prod`.

## 12.4 Looking at production data read-only

```bash
# in one terminal
ssh -N -L 5433:127.0.0.1:5432 deploy@103.126.162.131
```

Then point DBeaver at `localhost:5433`, database `smart_erp_prod`, user `erp`,
**read-only connection**. This is how you inspect real data without opening a
single port on the internet.

## 12.5 Housekeeping you will want monthly

```bash
# on the server
sudo apt update && sudo apt full-upgrade -y
sudo journalctl -u smart-erp --since "30 days ago" | grep -c "\[fatal\]"
df -h / && free -h
ls -1 /opt/SmartERP/backups | wc -l          # ~28 expected (14 dumps + 14 tars)
cat /opt/SmartERP/backups/last_backup.txt   # did 03:00 run, and did the upload succeed?
rclone size onedrive:SmartERP-backups       # off-site copy still growing as expected?
```

---

# Appendix A — Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| nginx returns **502 Bad Gateway** | the Node service is down or on another port | `sudo systemctl status smart-erp`, `sudo journalctl -u smart-erp -n 50`, `sudo ss -ltnp \| grep 5001` |
| `{"status":"error","db":"down"}` | wrong `DATABASE_URL`, Postgres down, or role/password mismatch | `psql "$DATABASE_URL" -c 'select 1'` as `deploy`; `sudo systemctl status postgresql` |
| Login succeeds but the session is immediately lost | `COOKIE_SECURE=true` while served over plain HTTP | use the HTTPS URL, or temporarily set `COOKIE_SECURE=false` and restart |
| Login form posts but nothing happens, `429` in the console | login limiter: 10 failures / 15 min per IP (`server/rate-limit.ts`) | wait 15 min, check `journalctl` for the offending IP |
| UI edits show up under the **wrong** database in DBeaver | a shell-exported `DATABASE_URL` won over `.env` (dotenv does not override) | `sudo systemctl show smart-erp -p Environment`, and restart only via systemd — never `node dist/index.js` by hand |
| `npm ci` / `vite build` killed → `Killed` | 1 GB RAM without swap | enable swap (Step 1.5), retry with `NODE_OPTIONS=--max-old-space-size=768` |
| `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory` + `Aborted (core dumped)` during `vite build` | V8 default heap ≈ half of RAM (~470 MB) on a 1 GB box | set `NODE_OPTIONS=--max-old-space-size=896` (Step 8.1); it is the documented default, not an optional tweak |
| `pg_restore: error: relation "users" already exists` | the database was not empty (e.g. `db:push` ran first) | drop/recreate the DB and restore again |
| `pg_restore: error: unsupported version (1.16) in file header` | the `-Fc` dump was made by a `pg_dump` newer than the server's `pg_restore` (e.g. Postgres.app 18 → server 16) | re-dump as plain SQL (`-Fp … \| gzip`) and restore with `psql -v ON_ERROR_STOP=1`, or dump with a 16 client |
| `NOTICE: empty string is not a valid password, clearing password` then `password authentication failed` | `ALTER ROLE … PASSWORD '$VAR'` ran with `$VAR` empty (the `.env` was not sourced in that shell, or a mangled multi-line paste dropped the assignment) | set a fresh password with a `${VAR:?}` guard (Step 3.2) and re-sync `.env`; the old password is gone, not recoverable |
| `psql` printed `ERROR:` lines but exited 0 during the restore | `ON_ERROR_STOP` not set | truncate and restore again with `-v ON_ERROR_STOP=1`; check `\dt` count before proceeding |
| `drizzle-kit: command not found` | `npm ci` ran with `NODE_ENV=production` and pruned devDependencies | `NODE_ENV=development npm ci` |
| Uploaded pictures 404 | `WorkingDirectory` is not `/opt/SmartERP`, so `uploads/` resolves elsewhere | fix the unit, `daemon-reload`, restart |
| `EACCES: permission denied, mkdir '/opt/SmartERP/uploads/products'` | `uploads/` created by root | `sudo chown -R deploy:deploy /opt/SmartERP/uploads` |
| `Error: SESSION_SECRET must be set in production` | `.env` missing the key or `EnvironmentFile` not loaded | fix Step 5, then `daemon-reload` + restart |
| App answers on 5002 instead of 5001 | something else holds 5001 and `server/index.ts` walks forward | `sudo ss -ltnp \| grep 500` and free the port |

Logs, always:

```bash
sudo journalctl -u smart-erp -f          # live application log
sudo tail -f /var/log/nginx/error.log    # proxy/TLS problems
sudo tail -f /var/log/postgresql/postgresql-16-main.log
```

---

# Appendix B — Command cheat sheet

```bash
sudo systemctl status  smart-erp          # is it running?
sudo systemctl restart smart-erp         # after a code/schema release
sudo journalctl -u smart-erp -f          # follow the log
curl -s http://127.0.0.1:5001/api/health # local health (bypasses nginx)
curl -s https://erp.smartlife-vn.com/api/health

cd /opt/SmartERP && ./deploy-server.sh   # release origin/main
/opt/SmartERP/deploy/backup.sh           # manual backup now (local + OneDrive)
ls -lh /opt/SmartERP/backups
cat /opt/SmartERP/backups/last_backup.txt
tail -40 /opt/SmartERP/logs/backup.log   # last nightly run, 03:00
rclone lsf onedrive:SmartERP-backups/    # what is in the cloud
rclone about onedrive:                   # OneDrive quota left

set -a; source /opt/SmartERP/.env; set +a   # then: psql "$DATABASE_URL"
du -sh /opt/SmartERP/uploads             # file storage used
df -h /                                  # disk headroom
free -h                                  # RAM + swap
```

---

# Appendix C — Why the app runs on the server, not on a laptop

Short version, with the parts of this codebase that make it decisive:

1. **Files live on the app machine.** `server/index.ts` serves
   `process.cwd()/uploads`; product images, signed delivery notes, archived
   invoices (`uploads/invoices/<number>.html`), attachments and inventory imports
   are files, and `db/schema.ts` stores only their URLs. Two laptops = two
   disconnected sets of business documents.
2. **One schema owner.** `drizzle-kit push` is the only schema mechanism and it is
   interactive and destructive-capable. One server means one place can change the
   schema.
3. **Latency and partial writes.** Every screen issues many queries; over a WAN
   that is seconds per page, and a dropped connection mid-invoice leaves a
   half-finished document. On the server those transactions are local and short
   (`SELECT ... FOR UPDATE` in `server/invoices.ts`, `server/payments.ts`,
   `server/finance.ts`).
4. **One config.** Sessions are DB-backed (`server/session-store.ts`), but
   `SESSION_SECRET` and `COOKIE_SECURE` must agree everywhere. One `.env` on one
   server cannot drift; two laptops can.
5. **Scheduled work belongs next to the data.** `npm run website:sync`
   (`scripts/woocommerce-sync.ts`), `stock:reconcile`, `supplier:reconcile` and
   the nightly dump all need the live database — on a server they are cron
   entries, on a laptop they are "whoever's machine happens to be open".

The laptops keep the one thing they are genuinely better at: `npm run dev`
against a throwaway local database, with instant reload.
