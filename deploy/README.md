# Production Deployment

This bundle deploys the GitHub repository to one Linux VPS.

~~~text
Your browser
        |
        | SSH tunnel to localhost
        v
Next.js app on 127.0.0.1:3107
        |
        +-- Neon PostgreSQL
        +-- OpenAI API
        +-- Firecrawl API
~~~

The app has no built-in user authentication. Keep port 3107 bound to localhost and reach it through an SSH tunnel.

## Assumptions

- Ubuntu or another systemd-based Linux distribution
- Git
- Node.js 22.16.0 or newer (Node.js 24 recommended)
- a GitHub repository containing this project
- a Neon pooled connection string
- an OpenAI API key
- a Firecrawl API key

The fixed production paths are:

- repository: **/opt/flusso**
- service account: **flusso**
- protected environment: **/etc/flusso/flusso.env**

## 1. Prepare GitHub

Before the first push, verify that local secrets and generated files are ignored:

~~~bash
git check-ignore -v .env.local
git status --short
~~~

The staged set must not include **.env.local**, **.next**, **node_modules**, logs, extracted video frames, the raw chat export, or downloaded HubSpot files.

Use a private repository or a public repository with no credentials or private customer material. For a private repository, configure a read-only GitHub deploy key on the VPS.

## 2. Install on the VPS

~~~bash
sudo git clone https://github.com/KAMEVETRICS/Flusso.git /opt/flusso
sudo bash /opt/flusso/deploy/install-vps.sh
~~~

The first installer run creates the protected environment file and stops. Edit it:

~~~bash
sudo editor /etc/flusso/flusso.env
~~~

Set **OPENAI_API_KEY**, **FIRECRAWL_API_KEY**, and **DATABASE_URL**. Quote the database URL if it contains **&** or other shell-sensitive characters. Then run the installer again:

~~~bash
sudo bash /opt/flusso/deploy/install-vps.sh
~~~

It creates the service account, installs locked npm dependencies, builds the app, starts **flusso-engine.service** on localhost, and runs a smoke test. It does not generate content or spend model or crawl credits.

## 3. Verify

~~~bash
sudo bash /opt/flusso/deploy/smoke-test.sh
sudo ss -ltnp | grep 3107
sudo systemctl status flusso-engine.service
sudo journalctl -u flusso-engine.service -n 100 --no-pager
~~~

The smoke test calls **/api/health**, which checks that the OpenAI and Firecrawl keys are set and that Neon is reachable. The listener must be **127.0.0.1:3107**, not **0.0.0.0:3107** or **[::]:3107**.

## 4. Open the app

From your own machine:

~~~bash
ssh -L 3107:127.0.0.1:3107 your-user@your-vps
~~~

Then open http://localhost:3107.

## 5. Deploy later GitHub updates

Push reviewed changes to the current upstream branch, then run:

~~~bash
sudo bash /opt/flusso/deploy/update-vps.sh
~~~

The updater refuses to run over local VPS changes, pulls only with fast-forward semantics, rebuilds, reinstalls the engine unit, restarts the engine, and reruns the smoke test.

## Retiring the OKX marketplace setup

Earlier versions ran an OKX.AI marketplace agent next to the engine. Before the first update after this change, add **FIRECRAWL_API_KEY** to **/etc/flusso/flusso.env**; the smoke test fails without it.

That first **update-vps.sh** run disables and removes the old systemd units (**flusso-a2a**, **flusso-a2a-health**, **flusso-recovery**). Finish the cleanup once by hand:

1. Stop the OKX communication daemon: `sudo -iu flusso okx-a2a daemon stop`
2. Disable or uninstall the **flusso-a2a-guard** plugin in OpenClaw. Its linked source directory no longer exists in the repository.
3. Delete **/home/flusso/.config/systemd/user/openclaw-gateway.service.d/flusso.conf**, which loaded the Flusso secrets into the OpenClaw gateway.
4. Delete the old skill copies: **/home/flusso/.agents/skills/flusso-content-engineering** and **/home/flusso/.openclaw/workspace/skills/flusso-content-engineering**.
5. Remove the **A2A_*** and **CONTENT_ENGINE_URL** entries from **/etc/flusso/flusso.env**.

The Neon tables **a2a_content_jobs** and **a2a_inbox_turns** are no longer used. They are left in place; drop them manually once you no longer need their history.
