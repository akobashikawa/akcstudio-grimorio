---
title: "Pages CMS para editar posts Astro"
description: "Cómo editar tus posts aprovechando el backend de GitHub"
date: "2026-11-25"
updated: "2026-11-25"
lang: "es"
category: "guides"
tags:
  - "Astro"
  - "GitHub"
  - "CMS"
featured: false
draft: false
---

![](/covers/pages-cms-icon.png)

Astro permite crear un blog con páginas estáticas.

Una forma básica de editarlas es directamente en GitHub.

Otra manera muy conveniente es usar [Pages CMS]([https://pagescms.org/](https://pagescms.org/)), que usa un archivo de configuración para construir un ambiente externo que te permite administrar tus posts y también tus imágenes.

Pasos:

1. Suscribirse a Pages CMS usando la cuenta de GitHub
2. Seguir los pasos para instalar la App Pages CMS en GitHub
  - Hay que elegir si podrá acceder a algún repositorio en particular o a todos nuestros repositorios. Esto se puede cambiar luego.
3. Luego de autorizar el acceso a algun repositorio, acceder a [https://app.pagescms.org/](https://app.pagescms.org/) permite elegirlo. También permite elegir una rama en particular.
  - La primera vez, si no hay un archivo de configuración `.pages.yml`, dará la opción de crearlo.
  - Una vez inicializada la interfaz del CMS, se puede crear un nuevo post, editar los existentes, eliminarlos, subir archivos a media, etc.

## Configuración

[Overview | Pages CMS]([https://pagescms.org/docs/configuration/](https://pagescms.org/docs/configuration/)) describe las opciones de configuración.

Este es el archivo que yo he usando para mi proyecto de blog usando Astro con el theme [Grimorio]([https://astro.build/themes/details/grimorio/](https://astro.build/themes/details/grimorio/)):  

```yaml
media:
  input: public/covers
  output: /covers
  rename: safe
  extensions: [jpg, jpeg, png, webp, avif, gif, svg]

settings:
  commit:
    identity: user
    templates:
      create: "cms: add {path}"
      update: "cms: update {path}"
      delete: "cms: delete {path}"
      rename: "cms: rename {oldPath} -> {newPath}"

content:
  - name: posts
    label: Posts
    type: group
    items:
      - name: posts-en
        label: English
        type: collection
        path: src/content/posts/en
        format: yaml-frontmatter
        filename:
          template: "{primary}.md"
          field: create
        view:
          fields: [date, title, category, draft, featured]
          primary: title
          sort: [date, title]
          search: [title, description, tags]
          default:
            sort: date
            order: desc
        fields:
          - name: title
            type: string
            required: true
            options:
              maxlength: 120
          - name: description
            type: text
            required: true
            options:
              maxlength: 300
          - name: date
            type: date
            required: true
            options:
              format: yyyy-MM-dd
          - name: updated
            type: date
            default: ""
            options:
              format: yyyy-MM-dd
          - name: lang
            type: string
            hidden: true
            default: en
          - name: category
            type: select
            options:
              values: [guides, notes, stories]
          - name: tags
            type: string
            list: true
          - name: featured
            type: boolean
            default: false
          - name: draft
            type: boolean
            default: false
          - name: body
            type: rich-text
            options:
              format: markdown
              switcher: true
      - name: posts-es
        label: Español
        type: collection
        path: src/content/posts/es
        format: yaml-frontmatter
        filename:
          template: "{primary}.md"
          field: create
        view:
          fields: [date, title, category, draft, featured]
          primary: title
          sort: [date, title]
          search: [title, description, tags]
          default:
            sort: date
            order: desc
        fields:
          - name: title
            type: string
            required: true
            options:
              maxlength: 120
          - name: description
            type: text
            required: true
            options:
              maxlength: 300
          - name: date
            type: date
            required: true
            options:
              format: yyyy-MM-dd
          - name: updated
            type: date
            default: ""
            options:
              format: yyyy-MM-dd
          - name: lang
            type: string
            hidden: true
            default: es
          - name: category
            type: select
            options:
              values: [guides, notes, stories]
          - name: tags
            type: string
            list: true
          - name: featured
            type: boolean
            default: false
          - name: draft
            type: boolean
            default: false
          - name: body
            type: rich-text
            options:
              format: markdown
              switcher: true

```
