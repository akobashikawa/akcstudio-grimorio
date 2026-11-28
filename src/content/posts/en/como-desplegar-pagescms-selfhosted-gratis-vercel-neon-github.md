---
title: "How to deploy a self-hosted Pages CMS for free using Vercel, Neon, and GitHub"
description: "A step-by-step guide to setting up your own instance of Pages CMS, connected to a Postgres database on Neon and deployed on Vercel—while avoiding common permission errors related to GitHub Apps."
date: "2026-11-26"
updated: "2026-11-27"
lang: "en"
category: "guides"
tags:
  - "devops"
  - "github-apps"
  - "vercel"
  - "neon"
  - "pages-cms"
  - "jamstack"
featured: false
draft: false
---

Editing static sites (Astro, Hugo, Jekyll, or Eleventy) directly via Markdown files in Git is convenient when you’re at your code editor, but it becomes cumbersome when you simply want to fix a paragraph from your phone, or when you need someone else to publish content without having to interact with Git.

**Pages CMS** addresses this by providing a clean, visual interface on top of your repositories, saving every change as a standard Git commit. While a free public instance is available (`app.pagescms.org`), hosting your own instance gives you full control over repository permissions, keeps your tokens private, and allows you the freedom to maintain your own fork.

This runbook documents the complete deployment process using the free tiers of **Vercel** and **Neon**, along with a **GitHub App**—including the real-world challenges that may arise along the way and how to resolve them.


## Deployment Architecture

Unlike other Git-based CMS platforms that rely solely on browser-based OAuth, Pages CMS utilizes a Next.js backend—powered by **Better Auth** and a full-fledged **GitHub App**—to listen for *push* events via webhooks and keep the file tree synchronized.

```text
+-------------+       HTTPS / OAuth       +---------------------------+
| User    | ------------------------> | Vercel (Next.js App)      |
+-------------+                           | Better Auth + AES-256    | 
+-------------+-------------+
| 
+------------------------------+------------------------------+
| SQL (SSL Pooler)                                            | GitHub API + Webhooks
v                                                             v
+-----------------------------+                               +-----------------------------+
| Neon (Postgres) | | GitHub App |
| Encrypted sessions & tokens | | Repository-level permissions | 
+-----------------------------+                               +--------------+--------------+
| 
v
+-----------------------------+
| Your repositories (.md) | 
+-----------------------------+
```

```mermaid
flowchart LR
User(["Author / Editor<br/>(Browser)"])

subgraph Vercel["Vercel (Serverless)"]
UI["Pages CMS Frontend"]
Auth["Better Auth<br/>(Sessions + OAuth)"]
API["API Routes &<br/>Webhook Handler"]
end

subgraph Neon["Neon (PostgreSQL)"]
DB[("Tables: user, session,<br/>account, github_installation<br/>(Tokens encrypted with AES-256-GCM)")]
end

subgraph GitHub["GitHub"]
App["GitHub App<br/>(Contents: R/W, Email: R)"]
Repo[("Site Repository<br/>(.pages.yml + Markdown)")]
end

User -->|"1. HTTPS"| UI
UI <--> Auth
Auth <-->|"2. SQL Pooler (SSL)"| DB
API <-->|"3. Read/encrypt tokens"| DB
API -->|"4. GitHub REST API<br/>(Reads and creates commits)"| App
App <-->|"5. Reads and writes files"| Repo
App -.->|"6. Push event<br/>(/api/webhook/github)"| API
```

```mermaid
sequenceDiagram
autonumber
actor U as User
participant V as Vercel (Better Auth)
participant G as GitHub App / API
participant N as Neon (Postgres)

U->>V: Clicks "Sign in with GitHub"
V-->>U: 302 redirect to [github.com/login/oauth/authorize](https://github.com/login/oauth/authorize)<br/>(with GITHUB_APP_CLIENT_ID)
U->>G: Logs in and authorizes the GitHub App
G-->>U: Redirects to the Redirect URI<br/>(/api/auth/callback/github?code=...)
U->>V: Sends temporary code
V->>G: Exchanges code + CLIENT_SECRET for an access_token
G-->>V: Returns access_token
V->>G: Requests profile and email (GET /user/emails)
Note over G,V: Requires account permission:<br/>"Email addresses: Read-only"<br/>(if missing, fails with email_not_found)
G-->>V: Returns the user's verified email
V->>V: Encrypts tokens using CRYPTO_KEY (AES-256-GCM)
V->>N: Saves/updates user, account, and session
N-->>V: SQL confirmation
V-->>U: Sets session cookie (BETTER_AUTH_SECRET)<br/>and loads the repository dashboard
```

### Why Vercel instead of another free PaaS? Although you can deploy this project in any Node.js or Docker environment, **Vercel** is a better fit for the Pages CMS architecture than free alternatives like Render, for two practical reasons:

1. **No cold starts:** Other free-tier plans put the container to sleep after 15 minutes of inactivity, requiring 30 to 50 seconds to wake back up.
2. **Reliable webhooks:** GitHub terminates a webhook request if the server takes longer than 10 seconds to respond. On Vercel, serverless functions respond in milliseconds.

---

## Prerequisites

- An account on **GitHub**, **Vercel**, and **Neon**.
- A terminal with `openssl` and Node.js installed (Linux, macOS, WSL2, or Git Bash on Windows) to generate cryptographic keys and run the initial table migration.

---

## Phase 1: Preparing the repository (Fork vs. Private Clone)

If you use the *Deploy* button for the official template on Vercel, the platform clones the code into a new private repository named `pages-cms`, which remains disconnected from the original project's history. If you later wish to incorporate improvements or security fixes from the official project, this private clone will require you to do so manually.

To maintain a clean workflow:

1. Go to the official `pages-cms/pages-cms` repository on GitHub and click **Fork** to create your own copy (e.g., `your-username/pagescms`).
2. Import that *fork* via the Vercel dashboard (**Add New → Project**). If you have previously deployed the template, go to **Settings → Git**, click **Disconnect**, and then reconnect it by pointing to your *fork*.

> **Verification:** The **Deployments** tab for your project in Vercel should display the latest *commit* from your *forked* repository (`your-username/pagescms`).

---

## Phase 2: Database and migrations in Neon

Pages CMS stores users, sessions, and encrypted installation tokens in PostgreSQL.

1. Create a new project on [Neon](https://neon.tech).
2. From the project dashboard, copy the **Pooled connection** string (`DATABASE_URL`). It will look something like this:
```text
postgresql://neondb_owner:YOUR_PASSWORD@ep-cool-frog-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
```
3. Before logging in for the first time, create the table schema in Neon using a local copy of your *fork*:
```bash
git clone [https://github.com/your-username/pagescms.git](https://github.com/your-username/pagescms.git)
cd pagescms
npm install
```
4. Create a temporary `.env` file containing only the `DATABASE_URL` and run the migration:
```bash
echo 'DATABASE_URL="postgresql://neondb_owner:YOUR_PASSWORD@ep-cool-frog-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"' > .env
npm run db:migrate
```

*(If the script fails or does not exist in your version of the fork, run `npx drizzle-kit migrate` instead.)*

> **Verification:** Open the **Tables** panel or the **SQL Editor** in the Neon console and confirm that the `user`, `session`, `account`, and `github_installation` tables exist. Delete the local `.env` file when you are finished.

---

## Phase 3: Generating actual cryptographic secrets

Do not use manually invented passwords for encryption variables. Pages CMS encrypts GitHub tokens in Neon using **AES-256-GCM**, an algorithm that requires a key of exactly **32 bytes** (64 hexadecimal characters) and will throw a runtime error if the length does not match.

Generate both keys from your terminal:

```bash
# 1. For BETTER_AUTH_SECRET (for signing Better Auth sessions)
openssl rand -base64 32

# 2. For CRYPTO_KEY (64 hex characters = exactly 32 bytes)
openssl rand -hex 32
```

> **Verification:** Ensure that the output of the second command contains exactly **64 alphanumeric characters**, with no spaces or line breaks.

---

## Phase 4: Configuring the GitHub App

Instead of a classic OAuth App, Pages CMS requires the creation of a **GitHub App**. GitHub has recently updated the names of several fields in this form; here are the exact values ​​you should use (replacing `mi-pagescms.vercel.app` with the production domain that Vercel assigned to your project):

1. In GitHub, go to **Settings** (in your profile) → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Fill in the basic details:
- **GitHub App name:** a name that is unique across all of GitHub (e.g., `mi-pagescms`). 
- **Homepage URL:** `https://mi-pagescms.vercel.app`
3. In the **Identifying and authorizing users** section:
- **Redirect URI** *(formerly called Callback URL)*:
- **Request user authorization (OAuth) during installation:** leave this **unchecked**. 4. Under **Post installation**:
- **Setup URL (optional):** leave it **blank** (or enter `https://mi-pagescms.vercel.app` and check *Redirect on update* if you want to be automatically redirected to the dashboard each time you authorize a new repository).
5. Under **Webhook**:
- Check **Active**. 
- **Webhook URL:** `https://mi-pagescms.vercel.app/api/webhook/github`
- **Webhook secret:** generate a new 64-character secret using `openssl rand -hex 32` and paste it here.
6. Under **Permissions & events**, configure three key items:
- **Repository permissions → Contents:** select **Read and write** (`Metadata` will automatically be set to *Read-only*). 
- **Account permissions → Email addresses:** select **Read-only**. *(Critical step: without this permission, GitHub hides your email address, and the login process will fail).*
- **Subscribe to events:** check **Push**.
7. Under **Where can this GitHub App be installed?**, select **Only on this account** and click **Create GitHub App**.

Once the application has been created, go to its **General** tab:

- Click **Generate a new client secret** and save the resulting value.
- Scroll down to **Private keys**, click **Generate a private key**, and save the `.pem` file that is downloaded.

> **Verification:** In the **Permissions & events** menu of your GitHub App, you should see `Contents: Read and write` under repository permissions and `Email addresses: Read-only` under account permissions.

---

## Phase 5: Environment Variables and Deployment on Vercel

### Understanding the 3 Vercel URLs

When deploying a project on Vercel, you will see three distinct domains under the **Deployments** tab:

- `https://mi-pagescms.vercel.app`: **Production Domain**. This is fixed and always points to the latest stable deployment of your `main` branch.
- `https://pagescms-git-main-usuario.vercel.app`: **Branch Domain**. This updates with every *push* to the `main` branch.
- `https://pagescms-abc123xyz-usuario.vercel.app`: **Deployment URL**. This is immutable and remains frozen for that specific build.

**Always** use the Production Domain (`https://mi-pagescms.vercel.app`)—without a trailing slash (`/`)—when configuring `BASE_URL`.

### Setting Up Environment Variables

In Vercel, go to **Settings → Environment Variables** and add the following 10 variables, ensuring they are marked for **Production**:


| Variable | Value / Source |
| --------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL` | Your Neon *pooler* connection string. |
| `BASE_URL` | `https://mi-pagescms.vercel.app` (without a trailing `/`). |
| `BETTER_AUTH_SECRET` | The Base64-encoded key generated in Phase 3. |
| `CRYPTO_KEY` | The 64-character hexadecimal key from Phase 3. |
| `GITHUB_APP_ID` ​​| The **App ID** number visible in the header of your GitHub App. |
| `GITHUB_APP_NAME` | The *slug* of your app (`https://github.com/apps/<this-name>`). |
| `GITHUB_APP_CLIENT_ID` | The **Client ID** (`Iv1...` or `Iv23...`) found on the app's General page. |
| `GITHUB_APP_CLIENT_SECRET` | The *client secret* you generated in Phase 4. |
| `GITHUB_APP_PRIVATE_KEY` | The entire content of the `.pem` file (including the `BEGIN` and `END` lines). |
| `GITHUB_APP_WEBHOOK_SECRET` | The hexadecimal secret you entered in the Webhook secret field. |


### Redeploying and Installing the App

1. In Vercel, go to **Deployments**, open the three-dot menu (`...`) for the latest deployment, and select **Redeploy** so that the application picks up the new variables.
2. Go to `https://github.com/apps/<your-github-app-name>/installations/new`, select your account, and choose the repositories you want to manage with Pages CMS.
3. Visit `https://mi-pagescms.vercel.app` and click **Sign in with GitHub**.

> **Verification:** After authorizing the application on GitHub, you will be taken to the main Pages CMS dashboard, where you will see a list of the repositories you selected during installation.

---

## Phase 6: Creating an Initial Test `.pages.yml` File

For Pages CMS to recognize the content structure of a repository, add a `.pages.yml` file to the root of the project you intend to edit. Below is a minimal template for a Markdown-based blog with image support:

```yaml
media:
  input: public/images/posts
  output: /images/posts

content:
  - name: posts
    label: Artículos del Blog
    type: collection
    path: src/content/posts
    view:
      fields: [title, pubDate, draft]
      primary: title
      sort: [pubDate]
      default:
        sort: pubDate
        order: desc
    fields:
      - name: title
        label: Título
        type: string
        required: true
      - name: description
        label: Descripción corta
        type: text
      - name: pubDate
        label: Fecha de publicación
        type: date
        required: true
      - name: draft
        label: Borrador
        type: boolean
        default: false
      - name: body
        label: Contenido
        type: rich-text
```

Once you save this file to the main branch of your site, Pages CMS will immediately enable the visual editor and media manager.

---

## Common Pitfalls and How to Resolve Them

### 1. `email_not_found` error toast when clicking "Sign in with GitHub"

- **Cause:** Unlike traditional OAuth Apps, GitHub Apps block access to the user's email address by default. When Better Auth attempts to create your account in Postgres and does not receive an email address, it aborts the login process.
- **Solution:** Ensure that under **Developer settings → GitHub Apps → Permissions & events → Account permissions**, you have set **Email addresses** to **Read-only**. If you added this permission *after* installing the app, go to **Settings → Applications → Installed GitHub Apps → Configure** and accept the pending request for new permissions (*Accept new permissions*).

### 2. The 6-digit email verification code never arrives

- **Cause:** The login screen includes a field for logging in via an email-based OTP (one-time password), but Pages CMS uses **Resend** (`RESEND_API_KEY`) to send these messages. If you have not configured this variable, the sending functionality remains disabled.
- **Solution:** You do not need to set up transactional email if you are using GitHub; simply ignore the email field and always log in using the **Sign in with GitHub** button.

### 3. 500 error or invalid session after configuring environment variables

- **Cause:** This is usually due to one of three issues: forgetting to trigger a **Redeploy** in Vercel after saving the variables, including a trailing slash `/` at the end of the `BASE_URL`, or providing a `CRYPTO_KEY` that is not exactly 64 hexadecimal characters long.
- **Solution:** Check your `BASE_URL` and `CRYPTO_KEY` settings in Vercel, then trigger a new **Redeploy**.
