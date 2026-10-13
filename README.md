# Solvaxon

The website of Solvaxon at https://solvaxon.com: the Home, Services, About, Contact, and Privacy Policy pages, a not-found page, `robots.txt`, a sitemap, and a contact form that sends each enquiry to a private mailbox through Mailgun. This README explains how to set up, deploy, run, and verify the site on its Linux server, and how to work on it locally. All commands are written for a POSIX shell on Linux; replace each `<...>` in a command with the value it names.

## How the site works

- Astro builds every page as static HTML. The only JavaScript is on the Contact page: the form's own script, and Cloudflare Turnstile, which loads only after the visitor ticks the consent box.
- `npm run build` writes the files that browsers receive to `dist/client/`, and a standalone Node.js server to `dist/server/`. The server, started from `dist/server/entry.mjs`, serves those files and the contact action at `/_actions/contact/`.
- PM2 runs that server as one process, listening on `127.0.0.1:4321`. A reverse proxy on the same machine passes it the requests that Cloudflare forwards; Cloudflare proxies all web traffic for `solvaxon.com` and provides HTTPS.
- The contact action refuses a submission while the server is shutting down, when its IP address has already made 5 attempts in the past 60 minutes, when its fields or values are invalid, when 20 attempts to send an email through Mailgun have been made or are under way in the past 60 minutes, or when its Turnstile token does not pass Cloudflare's check. A submission with the same email address and message as one delivered in the past 60 minutes is answered as sent, without a second email. Mailgun sends every other submission as one plain-text email to the private address, with the visitor's address as its Reply-To.
- There is no database, the site sets no cookie, and there are no analytics. The attempt counts, the send attempts, and the record of delivered enquiries exist only in the server's memory, so a restart clears them.

## Where things are

| Path                                       | Contents                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/pages/`                               | The pages, the not-found page, and `robots.txt`                                                         |
| `src/layouts/`, `src/components/`          | The page layout, the site header and footer, and the contact form                                       |
| `src/actions/index.ts`, `src/lib/contact/` | The contact action: field rules, Turnstile check, Mailgun delivery, abuse limits, and graceful shutdown |
| `src/scripts/contact-form.ts`              | The contact form's script in the browser                                                                |
| `src/lib/site.ts`                          | Site-wide constants, such as the page names and paths and the public email address                      |
| `src/styles/global.css`                    | Site-wide styles                                                                                        |
| `public/`, `src/assets/brand/`             | Icons, the sharing image, and the logo files, which are unchanged copies of the brand originals         |
| `astro.config.mjs`                         | Astro settings, including the site URL, the Content Security Policy, and the environment variables      |
| `ecosystem.config.js`                      | The PM2 process definition                                                                              |
| `.env.example`                             | Every environment variable, with a comment                                                              |

## Versions

| Software              | Version | Where                                                       |
| --------------------- | ------- | ----------------------------------------------------------- |
| Node.js               | 24.21.0 | Server (installed with nvm 0.40.8) and development machines |
| npm                   | 12.2.0  | Installed globally                                          |
| PM2                   | 7.0.4   | Server only, installed globally                             |
| astro                 | 7.3.8   | `dependencies`                                              |
| @astrojs/node         | 11.1.7  | `dependencies`                                              |
| @astrojs/sitemap      | 3.7.4   | `dependencies`                                              |
| @astrojs/check        | 0.9.10  | `devDependencies`                                           |
| typescript            | 6.0.3   | `devDependencies`                                           |
| prettier              | 3.9.10  | `devDependencies`                                           |
| prettier-plugin-astro | 1.1.1   | `devDependencies`                                           |

`package.json` lists exact versions, and `package-lock.json` pins every installed package. Every version here is chosen on purpose: an upgrade changes this table and, for the project's packages, `package.json` and `package-lock.json` too (see [Upgrades](#upgrades)).

## What the server environment must provide

The project does not configure the server, Cloudflare, the proxy, or DNS; the owner's environment must provide the following.

### Server

- A Linux server with an init system that PM2 supports, such as systemd, so that PM2 can start the site at boot.
- A normal user that owns the site (the deploy user), with `git`, `curl`, and `bash` available. The deploy user owns the project directory, `$HOME/.nvm`, and `$HOME/.pm2`; `.env` has mode 600. Of the commands in this README, only those that `pm2 startup` and `pm2 unstartup` print need root rights.
- Outbound HTTPS from the server to `challenges.cloudflare.com` (Turnstile's check) and `api.eu.mailgun.net` (Mailgun's API for an EU domain; `api.mailgun.net` for a US domain) while the site runs, and to `registry.npmjs.org`, `github.com`, `raw.githubusercontent.com`, and `nodejs.org` for installation and deployment.

### Cloudflare

- The DNS records that point `solvaxon.com` to the server are proxied, and the SSL/TLS encryption mode is Full (strict), so the origin must accept HTTPS on port 443 with a certificate that is unexpired, is issued by a publicly trusted certificate authority or by Cloudflare Origin CA, and names `solvaxon.com`; otherwise visitors may get error 526.
- Always Use HTTPS is on, so Cloudflare answers every `http://` request with a 301 redirect to `https://`. The origin performs no HTTPS or `www` redirect itself.
- `www.solvaxon.com` only redirects: its proxied A record points to `192.0.2.1`, which is never reached, and a Single Redirect sends `http*://www.solvaxon.com/*` to `https://solvaxon.com/${2}` with status 301 and the query string preserved.
- The edge certificate covers `solvaxon.com` and `www.solvaxon.com`, as Universal SSL does for the root domain and its first-level subdomains.
- Compression stays on: by default, Cloudflare compresses HTML, CSS, JavaScript, SVG, XML, and JSON responses for visitors whose browsers support compression.
- These stay off, because each one changes the pages or what reaches the server: Web Analytics (its automatic setup injects a script), Zaraz, Rocket Loader, Email Address Obfuscation, Bot Fight Mode, and the "Remove visitor IP headers" Managed Transform, which removes `CF-Connecting-IP`.

### Firewall

- Ports 80 and 443 accept connections only from Cloudflare's IP ranges (https://www.cloudflare.com/ips/), kept up to date as Cloudflare changes them, so that nobody can connect to the server's web ports without going through Cloudflare.

### Reverse proxy on the server

- It accepts HTTPS on port 443 with the certificate described above and forwards each request to `http://127.0.0.1:4321` (the `PORT` in `.env`).
- It sends `Host: solvaxon.com` and `X-Forwarded-Proto: https` with every request. The server trusts forwarded headers only for `https://solvaxon.com`; without both headers it refuses every form submission as cross-site (403).
- It replaces `X-Forwarded-For` with exactly one value, the visitor's IP address, taken from `CF-Connecting-IP`, which it trusts only on connections from Cloudflare's IP ranges. The server uses the first `X-Forwarded-For` value as the visitor's address for the attempt limit, and Cloudflare appends to an `X-Forwarded-For` header that a client sends, so a value from the client must never be kept.
- It adds these response headers: `Strict-Transport-Security: max-age=31536000` (one year, without `includeSubDomains`, so that other subdomains are not affected), `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: frame-ancestors 'none'`. Each page carries the rest of its Content Security Policy in a `meta` element, and a `meta` element cannot set `frame-ancestors`.
- It accepts request bodies of at least 65536 bytes for `/_actions/` (the server refuses larger ones itself with 413), waits at least 30 seconds for the server's response (for one submission, two Turnstile attempts of up to 4 seconds each, 1 second apart, and one Mailgun attempt of up to 10 seconds add up to 19 seconds), caches neither HTML nor `/_actions/` responses, and passes status codes and response headers through unchanged.
- Logs that contain visitors' IP addresses, such as the proxy's access and error logs, are deleted after at most 14 days, as the Privacy Policy states.

### DNS records

- For the Mailgun sending domain `mg.solvaxon.com`: every record that Mailgun shows for the domain, with the values Mailgun shows (the SPF and DKIM records, which authenticate the emails; the MX records; and the tracking CNAME), each set to DNS only, as Cloudflare advises for email records.
- The MX records that the mailbox provider gives for `solvaxon.com`, so that `hello@solvaxon.com` receives mail.
- The TXT record for Google Search Console (see [Search Console](#search-console)).

## Mailgun and Turnstile

### Mailgun

- The sending domain `mg.solvaxon.com` is verified in Mailgun's EU region, so `MAILGUN_DOMAIN` is `mg.solvaxon.com` and `MAILGUN_REGION` is `eu`.
- `MAILGUN_SENDING_KEY` is a Domain Sending Key of `mg.solvaxon.com`, which Mailgun recommends for production because it only allows sending email for its domain. To create one in the Mailgun dashboard, open Sending, then Domains, then `mg.solvaxon.com`, then the domain's sending keys tab, and select Add Sending Key. Mailgun shows a new key only once.
- The domain's message retention stays at 0, which disables Mailgun's storage of sent emails; the Privacy Policy states that Mailgun keeps no copy of the emails once it has sent them.
- Click and open tracking need no setting: the server turns both off in every email.
- `CONTACT_TO_ADDRESS` is the private mailbox that receives the enquiries. It is set only in `.env`, never in the repository.

### Turnstile

- The widget's mode is Managed, the mode Cloudflare recommends, and its only hostname is `solvaxon.com`. Cloudflare recommends that a production widget does not allow local hostnames such as `localhost`; local development uses Cloudflare's test keys instead (see [Local development](#local-development)).
- `TURNSTILE_SITE_KEY` is the widget's site key and `TURNSTILE_SECRET_KEY` its secret key.

## Environment variables

The server and the build read their settings from `.env` in the project directory. `.env.example` lists every variable with a comment.

| Variable               | Meaning                                                                                                               | Read by                                          | Secret |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| `HOST`                 | Address the server listens on: `127.0.0.1`, so that only programs on the same machine, such as the proxy, can connect | The server, when it starts                       | No     |
| `PORT`                 | Port the server listens on: `4321`                                                                                    | The server, when it starts                       | No     |
| `TURNSTILE_SITE_KEY`   | Site key of the Turnstile widget                                                                                      | The build, which writes it into the Contact page | No     |
| `TURNSTILE_SECRET_KEY` | Secret key of the Turnstile widget                                                                                    | The server, at runtime                           | Yes    |
| `MAILGUN_SENDING_KEY`  | Domain Sending Key of `mg.solvaxon.com`                                                                               | The server, at runtime                           | Yes    |
| `MAILGUN_DOMAIN`       | Mailgun sending domain: `mg.solvaxon.com`                                                                             | The build, which writes it into the server       | No     |
| `MAILGUN_REGION`       | Region of the sending domain, `us` or `eu`: `eu`                                                                      | The build, which writes it into the server       | No     |
| `CONTACT_TO_ADDRESS`   | Private address that receives the enquiries                                                                           | The server, at runtime                           | Yes    |

- `npm run build` checks the six variables other than `HOST` and `PORT` and fails if one is missing or empty, or if `MAILGUN_REGION` is not `us` or `eu`; so the build needs the secrets too, although it writes none of them into its output.
- At runtime, Node.js loads `.env` because PM2 starts it with `--env-file=.env` (`ecosystem.config.js`); Astro and its Node.js adapter load nothing themselves. Node.js stops with an error if `.env` is missing.
- A variable that is already set in the environment takes precedence over `.env`, both for the build and for the server, and PM2 passes the environment of the shell that runs `pm2 start` to the server. So run every build and every `pm2 start` from a shell in which this check prints nothing:

```sh
env | grep -E '^(HOST|PORT|TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|MAILGUN_SENDING_KEY|MAILGUN_DOMAIN|MAILGUN_REGION|CONTACT_TO_ADDRESS)='
```

- If the check prints a line, run `unset <name>` for each name it shows, and remove the export where it comes from, for example the shell's startup file, so that new shells do not set it again.
- If a shell variable has reached PM2 anyway, PM2 keeps it for the app across restarts: remove the app with `pm2 delete solvaxon`, then, from a shell in which the check prints nothing, run `pm2 start ecosystem.config.js` in the project directory and `pm2 save`.
- In `.env`, everything after a `#` is a comment, so put a value that contains `#` in quotes.
- Keep all values in `.env` only: the build also reads `.env.local`, `.env.production`, and `.env.production.local` if they exist, while the server reads only `.env`.
- Public values are written into the build, so after any change to `.env`, rebuild and restart (see [Changing .env](#changing-env)).

To create `.env`, copy the example, restrict it to the deploy user, and then fill in the empty values with a text editor:

```sh
cp .env.example .env
chmod 600 .env
```

`.env.example` already holds `HOST=127.0.0.1`, `PORT=4321`, `MAILGUN_DOMAIN=mg.solvaxon.com`, and `MAILGUN_REGION=eu`. Git ignores `.env`, so it stays out of the repository.

## Setting up the server

Run every command in this README as the deploy user, not as root, unless a step says otherwise.

Install nvm 0.40.8, the Node.js version manager that nodejs.org lists among its recommended installation methods for Linux, load it into the current shell, and check it (the last command prints `nvm`). The installer adds the lines that load nvm to the shell's startup file, so new shells load it too; if it finds no startup file, it prints those lines for you to add. If `$HOME/.npmrc` exists, it must not set `prefix`, which nvm does not support.

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
command -v nvm
```

Install Node.js 24.21.0. The first version that nvm installs becomes its default, which new shells use; if nvm already had another version, also run `nvm alias default 24.21.0`. `node --version` prints `v24.21.0`.

```sh
nvm install 24.21.0
node --version
```

Install npm 12.2.0 and PM2 7.0.4. With nvm, global packages need no `sudo`. The last two commands print `12.2.0` and a line with `pm2@7.0.4`.

```sh
npm install -g npm@12.2.0
npm install -g pm2@7.0.4
npm --version
npm ls -g pm2
```

npm 12 does not run the install scripts of a dependency that is not approved; it skips them and lists the skipped packages at the end of the install. These two installs need no install script. If npm lists a skipped package, stop and review it before continuing.

## First deployment

1. Clone the repository into `$HOME/solvaxon`, the project directory that the rest of this README uses, and check out the commit to deploy:

```sh
git clone https://github.com/solvaxon/solvaxon.com.git "$HOME/solvaxon"
cd "$HOME/solvaxon"
git checkout --detach <commit>
```

2. Create `.env` as described in [Environment variables](#environment-variables).

3. Install the dependencies and turn off Astro's telemetry for the deploy user:

```sh
npm ci --include=dev
npx astro telemetry disable
```

`npm ci` installs exactly the versions in `package-lock.json`, removes an existing `node_modules` first, and never changes `package.json` or the lockfile. `--include=dev` installs the devDependencies, which the build needs, even when `NODE_ENV` is `production`. `npx` runs the `astro` that `npm ci` installed, so it must come after it.

4. Check the shell and build the site:

```sh
env | grep -E '^(HOST|PORT|TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|MAILGUN_SENDING_KEY|MAILGUN_DOMAIN|MAILGUN_REGION|CONTACT_TO_ADDRESS)='
npm run build
```

The `env` check prints nothing. `npm run build` runs `astro check --minimumFailingSeverity warning`, then `astro build`. `astro check` reports 0 errors, 0 warnings, and 1 hint: TypeScript's suggestion to convert `ecosystem.config.js` to an ES module, which the output labels "warning" but counts as a hint. The file stays as it is, because PM2's documentation defines the ecosystem file with `module.exports`. Any error or warning stops the build.

5. Start the site with PM2 and check it:

```sh
pm2 start ecosystem.config.js
pm2 status
pm2 logs solvaxon --lines 20 --nostream
```

`pm2 status` shows `solvaxon` as `online`, and the log shows `Server listening on http://127.0.0.1:4321`.

6. Make PM2 start the site at boot. `pm2 startup` prints one command that starts with `sudo env PATH=`; run that command once, as a user with root rights. On systemd it creates and enables the service `pm2-<user>`. Then save the process list, which that service restores at boot:

```sh
pm2 startup
pm2 save
```

Run `pm2 save` only while `solvaxon` is online: an app that was stopped when the list was saved stays stopped after a reboot.

7. Verify the site as described in [Verifying production](#verifying-production).

## Running the site

| Task                                                             | Command                                    |
| ---------------------------------------------------------------- | ------------------------------------------ |
| Show the status                                                  | `pm2 status`                               |
| Show the details, including the log paths and the Node.js binary | `pm2 describe solvaxon`                    |
| Show the last 200 log lines and follow new ones (Ctrl+C stops)   | `pm2 logs solvaxon --lines 200`            |
| Print the last 200 log lines without following                   | `pm2 logs solvaxon --lines 200 --nostream` |
| Empty the log files                                              | `pm2 flush solvaxon`                       |
| Stop the site                                                    | `pm2 stop solvaxon`                        |
| Restart the site, or start it after a stop                       | `pm2 restart solvaxon`                     |
| Save the process list for boot                                   | `pm2 save`                                 |

To stop or restart the site, PM2 sends it SIGINT, and SIGKILL if it is still running after 25 seconds. Once the site has handled a form submission since it started, SIGINT makes it refuse new submissions, let the submissions in progress finish, wait 5 more seconds, and exit; before that, it exits at once. A restart reads `.env` again but does not rebuild the site.

### Logs

- `$HOME/.pm2/logs/solvaxon-out-0.log` holds the info and warning lines, and `$HOME/.pm2/logs/solvaxon-error-0.log` the error lines. The `0` is the app's id in PM2, which is `0` when `solvaxon` is the first app that PM2 starts; `pm2 describe solvaxon` shows the exact paths. PM2's own log is `$HOME/.pm2/pm2.log`.
- PM2 starts each line with the date and time, for example `2026-10-13T14:02:11:`. Astro then adds its own time and, for warnings and errors, `[WARN]` or `[ERROR]`.
- The site's log lines contain no visitor's IP address, name, email address, message, token, or secret.
- PM2 does not rotate the log files. Check their size from time to time with `ls -l "$HOME/.pm2/logs"`, and empty them with `pm2 flush solvaxon` when needed.
- If `pm2 status` shows `errored`, read `pm2 logs solvaxon --err --lines 50 --nostream`. For example, without `.env`, Node.js stops before the site starts, and PM2 marks the app `errored` after 16 such restarts in a row.

### Log lines of the contact form

The contact action writes a line for each submission it handles, and one when the server starts to shut down, each starting with `contact`. A submission refused while the server shuts down writes no line, and the attempt limit and the send limit each write a line only for their first refusal.

- `contact sent "<id>"` (info): Mailgun accepted the email; `<id>` is Mailgun's message id.
- `contact duplicate` (info): the same email address and message were delivered in the past 60 minutes, so the submission was answered as sent without a second email.
- `contact shutdown_started <n>` (info): PM2 stopped or restarted the server while `<n>` submissions were in progress.
- `contact invalid_input <category>` (warn): the submission did not hold exactly the five form fields as text (`missing_field`, `unexpected_field`, `repeated_field`, or `non_text_value`), or a value broke the form rules (`rule_failed`). Frequent lines can mean misuse of the form.
- `contact verification_failed <detail>` (warn): Turnstile rejected the token; `<detail>` is Cloudflare's list of error codes, for example `["timeout-or-duplicate"]`, or `hostname_mismatch`. `hostname_mismatch` on every submission means that the Turnstile keys or the site URL of the build are wrong.
- `contact rate_limited` (warn): an IP address made more than 5 attempts within 60 minutes; written for its first refused attempt since its last allowed one.
- `contact capacity_reached` (warn): the send limit was reached, because 20 attempts to send an email through Mailgun were made or are under way in the past 60 minutes, so further submissions are refused until fewer than 20 remain; written for the first refusal since the last allowed submission. Check whether someone is misusing the form.
- `contact verification_unavailable` (error): Turnstile's check failed twice, through no answer in time, a network error, an HTTP 5xx status, or Cloudflare's `internal-error` code. Check outbound HTTPS to `challenges.cloudflare.com`.
- `contact configuration_error <code>` (error): Turnstile reported `missing-input-secret`, `invalid-input-secret`, or `bad-request`. Check `TURNSTILE_SECRET_KEY`.
- `contact delivery_rejected <status>` (error): Mailgun refused the email with this HTTP status, for example `401` for a wrong sending key. Check `MAILGUN_SENDING_KEY`, `MAILGUN_DOMAIN`, and `MAILGUN_REGION`.
- `contact delivery_unavailable <detail>` (error): Mailgun answered with HTTP status 429 or 5xx (`<detail>` is the status), did not answer within 10 seconds (`timeout`), or could not be reached (`network`). After a timeout, the email may still have been sent. Check outbound HTTPS to Mailgun's API.
- `contact unexpected_error <name>` (error): an unexpected error, given by its name only.

## Releasing a new version

The site is unavailable from `pm2 stop` until `pm2 start`. Stopping first keeps the running server from serving a half-written `dist/`.

```sh
cd "$HOME/solvaxon"
git log -1 --format=%H
pm2 stop solvaxon
git fetch origin
git checkout --detach <commit>
npm ci --include=dev
env | grep -E '^(HOST|PORT|TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|MAILGUN_SENDING_KEY|MAILGUN_DOMAIN|MAILGUN_REGION|CONTACT_TO_ADDRESS)='
npm run build
pm2 start ecosystem.config.js
pm2 save
```

`git log -1 --format=%H` prints the commit that is running before the change; note it for a rollback. If the new commit's `.env.example` lists a variable that `.env` lacks, add it to `.env` before building. After the release, verify the site as described in [Verifying production](#verifying-production).

To roll back, follow the same steps with the commit that ran before. If a step fails, the site stays stopped until it is fixed or the previous commit is deployed the same way.

## Changing .env

After any change to `.env`, rebuild and restart:

```sh
cd "$HOME/solvaxon"
pm2 stop solvaxon
```

Edit `.env`, then:

```sh
env | grep -E '^(HOST|PORT|TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|MAILGUN_SENDING_KEY|MAILGUN_DOMAIN|MAILGUN_REGION|CONTACT_TO_ADDRESS)='
npm run build
pm2 restart solvaxon
```

## Rotating secrets

Mailgun recommends rotating API keys at least quarterly, and at once if a key may have been exposed.

- Mailgun sending key: create a new Domain Sending Key for `mg.solvaxon.com`, put it in `.env` as `MAILGUN_SENDING_KEY` (see [Changing .env](#changing-env)), send an enquiry through the form and check that it arrives, and then revoke the old key in Mailgun. If the old key may have been exposed, revoke it first; the form then fails with `delivery_rejected 401` until the new key is in place.
- Turnstile secret key: on the Turnstile page of the Cloudflare dashboard, open the widget's Settings and select Rotate Secret Key, then put the new secret in `.env` as `TURNSTILE_SECRET_KEY` (see [Changing .env](#changing-env)). For two hours after the rotation, both the old and the new secret are valid, so the form keeps working during the change.

## Upgrades

Upgrade only to versions that have been chosen and recorded in [Versions](#versions).

### PM2

```sh
npm install -g pm2@<version>
pm2 update
```

Run `pm2 update` while `solvaxon` is online: it saves the process list, restarts PM2's daemon with the new version, and restores the site, which is briefly unavailable.

### npm

```sh
npm install -g npm@<version>
```

### Node.js

PM2's daemon and the site keep using the Node.js binary with which they were started, the site even across its restarts, and `pm2 save` stores that binary's path for the boot service. So after installing a new version, stop PM2 completely, replace the boot service, and start the site again from a shell that uses the new version:

```sh
nvm install <version>
nvm alias default <version>
npm install -g npm@12.2.0
npm install -g pm2@7.0.4
cd "$HOME/solvaxon"
pm2 kill
pm2 unstartup
```

Run the command that `pm2 unstartup` prints, as a user with root rights. Then:

```sh
pm2 startup
```

Run the command that `pm2 startup` prints, as a user with root rights. Then:

```sh
env | grep -E '^(HOST|PORT|TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|MAILGUN_SENDING_KEY|MAILGUN_DOMAIN|MAILGUN_REGION|CONTACT_TO_ADDRESS)='
pm2 start ecosystem.config.js
pm2 save
pm2 describe solvaxon
nvm uninstall <old version>
```

The site is unavailable from `pm2 kill` until `pm2 start`. `pm2 describe solvaxon` shows the new version's `node` binary as the interpreter and the new version as the Node.js version. With nvm, global packages belong to one Node.js version, which is why npm and PM2 are installed again; use the versions named in [Versions](#versions). Uninstall the old version only after the boot service has been replaced, because the old service runs PM2 from it.

### Dependencies

Dependencies change on a development machine, as described in [Changing dependencies](#changing-dependencies); the server receives them with the next release.

## Verifying production

Run these checks after the first deployment and after each release. Unless a check says otherwise, run it on any machine with `curl`.

The pages and files answer 200 over HTTPS; each line shows `200` and the address:

```sh
for page in / /services/ /about/ /contact/ /privacy/ /robots.txt /sitemap-index.xml /sitemap-0.xml; do
	curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' "https://solvaxon.com$page"
done
```

An address without its final slash, an `http://` address, and a `www.` address each answer 301; the lines show `301` and the redirect targets `https://solvaxon.com/services/`, `https://solvaxon.com/about/`, and `https://solvaxon.com/about/?x=1`:

```sh
for address in https://solvaxon.com/services http://solvaxon.com/about/ "https://www.solvaxon.com/about/?x=1"; do
	curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$address"
done
```

An unknown address answers 404 with the site's own not-found page; the commands print `404` and `not-found page`:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://solvaxon.com/nope/
curl -sS https://solvaxon.com/nope/ | grep -q '<title>Page not found - Solvaxon</title>' && echo 'not-found page'
```

Every page has the proxy's security headers and sets no cookie. For each page, the commands print `strict-transport-security: max-age=31536000`, `x-content-type-options: nosniff`, and `content-security-policy: frame-ancestors 'none'`, and no `set-cookie` line:

```sh
for page in / /services/ /about/ /contact/ /privacy/; do
	echo "$page"
	curl -sS -D - -o /dev/null "https://solvaxon.com$page" | grep -i -E '^(strict-transport-security|x-content-type-options|content-security-policy|set-cookie):'
done
```

Text responses arrive compressed; the command prints a `content-encoding:` line, for example with `br` or `gzip`:

```sh
curl -sS --compressed -D - -o /dev/null https://solvaxon.com/ | grep -i '^content-encoding:'
```

On the server, in the project directory: a built asset carries `cache-control: public, max-age=31536000, immutable`. This check needs a GET request, as here, because the server adds the header only when it sends the file; a HEAD request, such as `curl -I`, shows `max-age=0`.

```sh
cd "$HOME/solvaxon"
asset=$(ls dist/client/_astro | head -n 1)
curl -sS -D - -o /dev/null "https://solvaxon.com/_astro/$asset" | grep -i '^cache-control:'
```

On the server, in the project directory: each page reaches visitors exactly as built, so nothing on the way changed it or added a script. The commands print one `unchanged:` line for each page:

```sh
cd "$HOME/solvaxon"
for page in "" services/ about/ contact/ privacy/; do
	curl -sS --compressed "https://solvaxon.com/$page" | cmp - "dist/client/${page}index.html" && echo "unchanged: /$page"
done
curl -sS --compressed https://solvaxon.com/nope/ | cmp - dist/client/404.html && echo "unchanged: not-found page"
```

On a machine outside the server's network on which the checks above succeed, so that its network allows ports 80 and 443: the server refuses connections that bypass Cloudflare. Run this for each public IP address of the server, an IPv6 address in square brackets; each line must end with exit code 7 (failed to connect) or 28 (timed out):

```sh
for port in 80 443; do
	curl -sS -o /dev/null --connect-timeout 10 "http://<server address>:$port/"
	echo "port $port: exit code $?"
done
```

The contact form, in this order, because the attempt limit in step 5 blocks the address it is run from:

1. In a browser, send an enquiry on https://solvaxon.com/contact/. The page shows "Thank you. Your message has been sent.", the email reaches `CONTACT_TO_ADDRESS` from `Solvaxon website <contact-form@mg.solvaxon.com>` with the subject `Website enquiry from <name>`, Reply in the mail program addresses the visitor's email address, and the log shows `contact sent`.
2. On the server, type `pm2 stop solvaxon` without pressing Enter. In a browser, send an enquiry, and press Enter while the button reads "Sending...". The browser shows the success message, the email arrives, the log shows `contact shutdown_started 1` and then `contact sent`, and `$HOME/.pm2/pm2.log` shows `App [solvaxon:0] exited with code [0] via signal [SIGINT]` and no line with `sending SIGKILL`. Then run `pm2 restart solvaxon`. If the log shows `contact shutdown_started 0`, or no such line, the stop did not come while the enquiry was in progress: restart the site and try again.
3. A cross-site submission is refused with 403:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://example.com' -F name=test https://solvaxon.com/_actions/contact/
```

4. A body larger than 65536 bytes is refused with 413:

```sh
printf '%70000s' x | curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://solvaxon.com' -F 'message=<-' https://solvaxon.com/_actions/contact/
```

5. The sixth attempt from one IP address within 60 minutes is refused with 429. These attempts lack the form fields, so the earlier ones answer 400; if the address made attempts in the past 60 minutes, 429 comes sooner. Refused attempts count too, so the address stays limited until fewer than 5 of its attempts are from the past 60 minutes, or until the site restarts.

```sh
for attempt in 1 2 3 4 5 6; do
	curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: https://solvaxon.com' -F name=test https://solvaxon.com/_actions/contact/
done
```

6. From another network, for example a phone on mobile data, send an enquiry through the form: it succeeds, which shows that the proxy passes each visitor's own IP address.
7. Search the site's log files for the name, email address, and message of the test enquiries; nothing is found:

```sh
grep -F -e '<name>' -e '<email address>' -e '<message>' "$HOME"/.pm2/logs/solvaxon-*.log
```

PM2: after `pm2 restart solvaxon`, and after a reboot of the server, `pm2 status` shows `solvaxon` as `online` without further steps, and the pages answer 200 again.

Validators and audits, against the production pages:

- W3C Nu HTML Checker (https://validator.w3.org/nu/), with each page's address: no errors.
- Lighthouse in Chrome DevTools, mobile and desktop, each page: Performance at least 90, Largest Contentful Paint at most 2.5 seconds, Cumulative Layout Shift at most 0.1, and Total Blocking Time at most 200 milliseconds; SEO 100 and Best Practices 100 on the five pages, apart from findings caused by Turnstile on the Contact page. The not-found page is not indexed, so its SEO score is lower, and its Best Practices score counts the console error that Chrome logs for its own 404 status.
- Rich Results Test (https://search.google.com/test/rich-results) with https://solvaxon.com/: one valid Organization item. Schema Markup Validator (https://validator.schema.org/) with the same address: WebSite and OnlineBusiness, with no errors or warnings.
- Google's CSP Evaluator (https://csp-evaluator.withgoogle.com/), with the policy in each page's `meta` element (on the Contact page it also allows Turnstile): no high-severity finding.

## Search Console

The owner sets up Google Search Console after launch:

1. In Search Console, add a property of the Domain type for `solvaxon.com`. A Domain property covers `https://` and `http://`, and every subdomain.
2. Verify ownership with the TXT record that Search Console shows: add it to the DNS records of `solvaxon.com` in Cloudflare, then select Verify. If verification fails at first, try again a day or two later: Google notes that a new DNS record can take up to two or three days to be served. Keep the record afterwards, or the property stops being verified.
3. In the Sitemaps report, submit `https://solvaxon.com/sitemap-index.xml`.
4. With URL Inspection, inspect `https://solvaxon.com/` and select Request Indexing.
5. Check the Page indexing, Security issues, and Manual actions reports, and later the Core Web Vitals report.

## Local development

Development needs Node.js 24.21.0 and npm 12.2.0, installed as in [Setting up the server](#setting-up-the-server) or in another way that gives these versions; PM2 is not needed.

```sh
git clone https://github.com/solvaxon/solvaxon.com.git
cd solvaxon.com
npm ci
npx astro telemetry disable
cp .env.example .env
chmod 600 .env
```

In `.env`, use Cloudflare's Turnstile test keys, which always pass and work on any hostname, including `localhost`: `TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`. The build and the development server need values for all six Astro variables; with a real Mailgun sending key, each successful local submission sends a real email to `CONTACT_TO_ADDRESS`.

| Task                                                 | Command                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| Run the development server at http://localhost:4321/ | `npm run dev`                               |
| Run it so that the contact form can be sent          | `npm run dev -- --site https://example.com` |
| Check and build the site into `dist/`                | `npm run build`                             |
| Serve the build at http://localhost:4321/            | `npx astro preview`                         |
| Check the formatting                                 | `npm run format:check`                      |
| Rewrite the files in the project's format            | `npm run format`                            |

- With the test keys, Cloudflare's check reports the hostname `example.com`, while the server accepts only the hostname of the site URL, `solvaxon.com`. Overriding the site URL lets local submissions pass; without it they fail with `hostname_mismatch`.
- Astro adds the Content Security Policy only when it builds the site, so `npm run dev` serves the pages without it.
- `npx astro preview` does not load `.env`, so the contact form does not work there. To try the form on a build, run `npx astro build --site https://example.com` and then `node --env-file=.env ./dist/server/entry.mjs`, which serves the site at http://127.0.0.1:4321/; afterwards, build normally again.
- `npm run format:check` and `npm run build` must both pass before a change is committed.

## Changing dependencies

Change dependencies only on a development machine, one deliberate exact version at a time:

```sh
npm install <package>@<version>
npm install --save-dev <package>@<version>
```

The first command is for a runtime dependency and the second for a development tool. `.npmrc` sets `save-exact=true`, so npm writes the exact version into `package.json`, and the install updates `package-lock.json`. npm 12 does not run the install scripts of a dependency unless `allowScripts` in `package.json` approves them. Approve one only if the package's official sources show that it needs its script on Linux, with `npm approve-scripts <package>`, which approves the installed version only. Then check:

```sh
npm approve-scripts --allow-scripts-pending
npm ls --all
npm audit
npm run format:check
npm run build
```

`npm approve-scripts --allow-scripts-pending` lists no package, `npm ls --all` reports no missing, invalid, or extraneous package, and `npm audit` finds no vulnerability. Commit `package.json` and `package-lock.json` together, update [Versions](#versions), and deploy the change as a release.
