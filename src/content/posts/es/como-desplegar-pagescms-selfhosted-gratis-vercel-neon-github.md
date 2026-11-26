---
title: Cómo desplegar Pages CMS self-hosted gratis con Vercel, Neon y GitHub
description: Guía paso a paso para levantar tu propia instancia de Pages CMS
  conectada a Postgres en Neon y Vercel, esquivando los errores típicos de
  permisos en GitHub Apps.
date: 2026-11-26
lang: es
category: guides
tags:
  - devops
  - github-apps
  - vercel
  - neon
  - pages-cms
  - jamstack
featured: false
draft: false
---
Editar sitios estáticos (Astro, Hugo, Jekyll o Eleventy) directamente desde archivos Markdown en Git es cómodo cuando estás frente a tu editor de código, pero se vuelve pesado cuando solo quieres corregir un párrafo desde el teléfono o dejar que otra persona publique contenido sin tocar Git.

**Pages CMS** resuelve esto poniendo una interfaz visual limpia encima de tus repositorios, guardando cada cambio como un *commit* estándar. Aunque existe una instancia pública gratuita (`app.pagescms.org`), levantar tu propia instancia *self-hosted* te da control total sobre los permisos de tus repositorios, privacidad sobre tus tokens y la libertad de mantener tu propio *fork*.

Este *runbook* documenta el despliegue completo usando el nivel gratuito de **Vercel**, **Neon** y una **GitHub App**, incluyendo las fricciones reales que aparecen en el camino y cómo resolverlas.


## Arquitectura del despliegue

A diferencia de otros CMS basados en Git que solo usan OAuth en el navegador, Pages CMS utiliza un backend en Next.js con **Better Auth** y una **GitHub App** completa para escuchar eventos *push* vía webhooks y mantener sincronizado el árbol de archivos.

```text
+-------------+       HTTPS / OAuth       +---------------------------+
| Usuario | ------------------------> | Vercel (Next.js App) |
+-------------+                           |  Better Auth + AES-256    |
                                          +-------------+-------------+
                                                        |
                         +------------------------------+------------------------------+
                         | SQL (Pooler SSL)                                            | GitHub API + Webhooks
                         v                                                             v
          +-----------------------------+                               +-----------------------------+
| Neon (Postgres) |  | GitHub App |
| Sesiones y tokens cifrados |  | Permisos por repositorio |
          +-----------------------------+                               +--------------+--------------+
                                                                                       |
                                                                                       v
                                                                        +-----------------------------+
| Tus repositorios (.md) |
                                                                        +-----------------------------+
```

```mermaid
flowchart LR
  User(["Autor / Editor<br/>(Navegador)"])

  subgraph Vercel["Vercel (Serverless)"]
    UI["Frontend Pages CMS"]
    Auth["Better Auth<br/>(Sesiones + OAuth)"]
    API["API Routes &<br/>Webhook Handler"]
  end

  subgraph Neon["Neon (PostgreSQL)"]
    DB[("Tablas: user, session,<br/>account, github_installation<br/>(Tokens cifrados AES-256-GCM)")]
  end

  subgraph GitHub["GitHub"]
    App["GitHub App<br/>(Contents: R/W, Email: R)"]
    Repo[("Repositorio del Sitio<br/>(.pages.yml + Markdown)")]
  end

  User -->|"1. HTTPS"| UI
  UI <--> Auth
  Auth <-->|"2. SQL Pooler (SSL)"| DB
  API <-->|"3. Lee/cifra tokens"| DB
  API -->|"4. GitHub REST API<br/>(Lee y crea commits)"| App
  App <-->|"5. Lee y escribe archivos"| Repo
  App -.->|"6. Evento Push<br/>(/api/webhook/github)"| API
```

```mermaid
sequenceDiagram
  autonumber
  actor U as Usuario
  participant V as Vercel (Better Auth)
  participant G as GitHub App / API
  participant N as Neon (Postgres)

  U->>V: Clic en "Sign in with GitHub"
  V-->>U: Redirección 302 a [github.com/login/oauth/authorize](https://github.com/login/oauth/authorize)<br/>(con GITHUB_APP_CLIENT_ID)
  U->>G: Inicia sesión y autoriza la GitHub App
  G-->>U: Redirección al Redirect URI<br/>(/api/auth/callback/github?code=...)
  U->>V: Envía código temporal (code)
  V->>G: Intercambia code + CLIENT_SECRET por access_token
  G-->>V: Devuelve access_token
  V->>G: Solicita perfil y correo (GET /user/emails)
  Note over G,V: Requiere Account permission:<br/>"Email addresses: Read-only"<br/>(si falta, falla con email_not_found)
  G-->>V: Devuelve email verificado del usuario
  V->>V: Cifra tokens con CRYPTO_KEY (AES-256-GCM)
  V->>N: Guarda/actualiza user, account y session
  N-->>V: Confirmación SQL
  V-->>U: Cookie de sesión (BETTER_AUTH_SECRET)<br/>y carga panel de repositorios
```

### ¿Por qué Vercel y no otro PaaS gratuito?

Aunque puedes desplegar este proyecto en cualquier entorno Node.js o Docker, **Vercel** encaja mejor con la arquitectura de Pages CMS que alternativas gratuitas como Render por dos razones prácticas:

1. **Sin arranque en frío (*cold starts*):** Otros planes gratuitos duermen el contenedor tras 15 minutos de inactividad y tardan entre 30 y 50 segundos en despertar.
2. **Webhooks confiables:** GitHub corta la petición de un webhook si el servidor tarda más de 10 segundos en responder. En Vercel, las funciones *serverless* responden en milisegundos.

---

## Prerrequisitos

- Una cuenta en **GitHub**, **Vercel** y **Neon**.
- Una terminal con `openssl` y Node.js disponible (Linux, macOS, WSL2 o Git Bash en Windows) para generar claves criptográficas y correr la migración inicial de tablas.

---

## Fase 1: Preparar el repositorio (Fork vs. Clone privado)

Si usas el botón *Deploy* de la plantilla oficial en Vercel, la plataforma clona el código en un repositorio privado nuevo llamado `pages-cms` que queda desconectado del historial original. Si más adelante quieres traer mejoras o correcciones de seguridad del proyecto oficial, ese clon privado te obligará a hacerlo a mano.

Para mantener un flujo limpio:

1. Entra al repositorio oficial de `pages-cms/pages-cms` en GitHub y haz clic en **Fork** para crear tu propia copia (por ejemplo, `tu-usuario/pagescms`).
2. Importa ese *fork* desde el dashboard de Vercel (**Add New → Project**). Si ya habías desplegado la plantilla antes, entra a **Settings → Git**, haz clic en **Disconnect** y vuelve a conectarlo apuntando a tu *fork*.

> **Verificación:** En la pestaña **Deployments** de tu proyecto en Vercel debe figurar el último *commit* de tu repositorio *fork* (`tu-usuario/pagescms`).

---

## Fase 2: Base de datos y migraciones en Neon

Pages CMS almacena usuarios, sesiones y tokens de instalación cifrados en PostgreSQL.

1. Crea un proyecto nuevo en [Neon](https://neon.tech).
2. En el dashboard del proyecto, copia la cadena de conexión **Pooled connection** (`DATABASE_URL`). Tendrá una forma similar a esta:
  ```text
   postgresql://neondb_owner:TU_PASSWORD@ep-cool-frog-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
  ```
3. Antes del primer inicio de sesión, crea el esquema de tablas en Neon desde una copia local de tu *fork*:
  ```bash
   git clone [https://github.com/tu-usuario/pagescms.git](https://github.com/tu-usuario/pagescms.git)
   cd pagescms
   npm install
  ```
4. Crea un archivo `.env` temporal solo con `DATABASE_URL` y ejecuta la migración:
  ```bash
   echo 'DATABASE_URL="postgresql://neondb_owner:TU_PASSWORD@ep-cool-frog-123456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"' > .env
   npm run db:migrate
  ```

   *(Si el script falla o no existe en tu versión del fork, ejecuta `npx drizzle-kit migrate`).*

> **Verificación:** Abre el panel **Tables** o el **SQL Editor** en la consola de Neon y comprueba que existan las tablas `user`, `session`, `account` y `github_installation`. Borra el archivo `.env` local cuando termines.

---

## Fase 3: Generar secretos criptográficos reales

No uses contraseñas inventadas a mano para las variables de cifrado. Pages CMS cifra los tokens de GitHub en Neon utilizando **AES-256-GCM**, un algoritmo que exige una clave de exactamente **32 bytes** (64 caracteres hexadecimales) y lanza un error en tiempo de ejecución si la longitud no coincide.

Genera ambas claves desde tu terminal:

```bash
# 1. Para BETTER_AUTH_SECRET (firma de sesiones de Better Auth)
openssl rand -base64 32

# 2. Para CRYPTO_KEY (64 caracteres hex = 32 bytes exactos)
openssl rand -hex 32
```

> **Verificación:** Asegúrate de que la salida del segundo comando tenga exactamente **64 caracteres** alfanuméricos, sin espacios ni saltos de línea.

---

## Fase 4: Configurar la GitHub App

En lugar de una OAuth App clásica, Pages CMS requiere crear una **GitHub App**. GitHub actualizó recientemente los nombres de varios campos en este formulario; aquí tienes los valores exactos que debes usar (reemplazando `mi-pagescms.vercel.app` por el dominio de producción que Vercel asignó a tu proyecto):

1. En GitHub, ve a **Settings** (de tu perfil) → **Developer settings** → **GitHub Apps** → **New GitHub App**.
2. Completa los datos básicos:
  - **GitHub App name:** un nombre único en todo GitHub (ejemplo: `mi-pagescms`).
  - **Homepage URL:** `https://mi-pagescms.vercel.app`
3. En la sección **Identifying and authorizing users**:
  - **Redirect URI** *(antes llamado Callback URL)*:
  - **Request user authorization (OAuth) during installation:** déjalo **desmarcado**.
4. En **Post installation**:
  - **Setup URL (optional):** déjalo **en blanco** (o pon `https://mi-pagescms.vercel.app` y marca *Redirect on update* si quieres volver automático al panel cada vez que autorices un repositorio nuevo).
5. En **Webhook**:
  - Marca **Active**.
  - **Webhook URL:** `https://mi-pagescms.vercel.app/api/webhook/github`
  - **Webhook secret:** genera otro secreto de 64 caracteres con `openssl rand -hex 32` y pégalo aquí.
6. En **Permissions & events** configura tres puntos clave:
  - **Repository permissions → Contents:** selecciona **Read and write** (`Metadata` pasará a *Read-only* automáticamente).
  - **Account permissions → Email addresses:** selecciona **Read-only**. *(Paso crítico: sin este permiso, GitHub oculta tu correo y el inicio de sesión fallará).*
  - **Subscribe to events:** marca **Push**.
7. En **Where can this GitHub App be installed?**, marca **Only on this account** y pulsa **Create GitHub App**.

Una vez creada la aplicación, en su pestaña **General**:

- Pulsa **Generate a new client secret** y guarda el valor resultante.
- Baja hasta **Private keys**, pulsa **Generate a private key** y guarda el archivo `.pem` que se descarga.

> **Verificación:** En el menú **Permissions & events** de tu GitHub App deben aparecer `Contents: Read and write` en permisos de repositorio y `Email addresses: Read-only` en permisos de cuenta.

---

## Fase 5: Variables de entorno y despliegue en Vercel

### Entendiendo las 3 URLs de Vercel

Al desplegar un proyecto en Vercel verás tres dominios distintos en la pestaña **Deployments**:

- `https://mi-pagescms.vercel.app`: **Dominio de Producción**. Es fijo y siempre apunta al último despliegue estable de tu rama `main`.
- `https://pagescms-git-main-usuario.vercel.app`: **Dominio de Rama**. Se actualiza con cada *push* a `main`.
- `https://pagescms-abc123xyz-usuario.vercel.app`: **URL del Deployment**. Es inmutable y queda congelada en esa compilación específica.

Usa **siempre** el Dominio de Producción (`https://mi-pagescms.vercel.app`) y **sin barra diagonal (`/`) al final** para configurar `BASE_URL`.

### Cargar las variables

Ve en Vercel a **Settings → Environment Variables** y agrega las 10 variables siguientes marcadas para **Production**:


| Variable | Valor / Origen |
| --------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL` | Tu cadena de conexión *pooler* de Neon. |
| `BASE_URL` | `https://mi-pagescms.vercel.app` (sin `/` al final). |
| `BETTER_AUTH_SECRET` | La clave en Base64 generada en la Fase 3. |
| `CRYPTO_KEY` | La clave hexadecimal de 64 caracteres de la Fase 3. |
| `GITHUB_APP_ID` | El número **App ID** visible en la cabecera de tu GitHub App. |
| `GITHUB_APP_NAME` | El *slug* de tu app (`https://github.com/apps/<este-nombre>`). |
| `GITHUB_APP_CLIENT_ID` | El **Client ID** (`Iv1...` o `Iv23...`) en la página General de la App. |
| `GITHUB_APP_CLIENT_SECRET` | El *client secret* que generaste en la Fase 4. |
| `GITHUB_APP_PRIVATE_KEY` | Todo el contenido del archivo `.pem` (incluyendo `BEGIN` y `END`). |
| `GITHUB_APP_WEBHOOK_SECRET` | El secreto hexadecimal que pusiste en el campo Webhook secret. |


### Redesplegar e instalar la App

1. En Vercel, ve a **Deployments**, abre el menú de tres puntos (`...`) del último despliegue y pulsa **Redeploy** para que la aplicación tome las nuevas variables.
2. Abre `https://github.com/apps/<tu-github-app-name>/installations/new`, selecciona tu cuenta y elige los repositorios que quieres administrar con Pages CMS.
3. Entra a `https://mi-pagescms.vercel.app` y haz clic en **Sign in with GitHub**.

> **Verificación:** Tras autorizar la aplicación en GitHub, entrarás al panel principal de Pages CMS y verás listados los repositorios que seleccionaste durante la instalación.

---

## Fase 6: Primer archivo `.pages.yml` de prueba

Para que Pages CMS reconozca la estructura de contenido de un repositorio, añade un archivo `.pages.yml` en la raíz del proyecto que vas a editar. Aquí tienes una plantilla mínima para un blog en Markdown con soporte de imágenes:

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

Al guardar este archivo en la rama principal de tu sitio, Pages CMS habilitará inmediatamente el editor visual y el gestor de medios.

---

## Trampas reales y cómo resolverlas

### 1. Toast de error `email_not_found` al pulsar "Sign in with GitHub"

- **Causa:** A diferencia de las OAuth Apps tradicionales, las GitHub Apps bloquean el acceso al correo del usuario por defecto. Cuando Better Auth intenta crear tu cuenta en Postgres y no recibe un email, aborta el inicio de sesión.
- **Solución:** Verifica que en **Developer settings → GitHub Apps → Permissions & events → Account permissions** hayas puesto **Email addresses** en **Read-only**. Si agregaste ese permiso *después* de haber instalado la app, ve a **Settings → Applications → Installed GitHub Apps → Configure** y acepta la solicitud pendiente de nuevos permisos (*Accept new permissions*).

### 2. El código de 6 dígitos por correo nunca llega

- **Causa:** La pantalla de login incluye un campo para entrar con código OTP por email, pero Pages CMS utiliza **Resend** (`RESEND_API_KEY`) para enviar esos mensajes. Si no configuraste esa variable, el envío queda deshabilitado.
- **Solución:** No necesitas configurar correo transaccional si usas GitHub; ignora el campo de email y entra siempre mediante el botón **Sign in with GitHub**.

### 3. Error 500 o sesión inválida tras configurar las variables

- **Causa:** Suele deberse a tres detalles: olvidar hacer **Redeploy** en Vercel después de guardar las variables, dejar una barra diagonal `/` al final de `BASE_URL`, o pegar un `CRYPTO_KEY` que no mide exactamente 64 caracteres hexadecimales.
- **Solución:** Revisa `BASE_URL` y `CRYPTO_KEY` en Vercel y lanza un nuevo **Redeploy**.

